import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { parseSync, type Plugin, type ResolvedConfig, type Rollup } from "vite";
import { normalizeArchivePath, type Manifest } from "@ai-switch/tauri-plugin-runtime/protocol";
import { inspectPath } from "../project/files.js";
import { readBoundedFile, decodeUtf8, parseStrictJson } from "../project/read.js";
import { validateWebManifest } from "../project/manifest.js";
import { ProjectError, errorCode } from "../project/errors.js";
import { readPublicAssets } from "./public-assets.js";
import { entryPath, createPathRegistry } from "../archive/paths.js";
import { scanHtmlText, resolveResource } from "./resource-policy.js";
import { inspectArtifactSnapshot, inspectBuildFiles, type BuildRecord, type ArtifactSnapshot } from "./artifacts.js";

const virtualPublic = "/@aplg/bootstrap.js";
const virtualId = "\0aplg:bootstrap";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail=(message:string):never=>{throw new ProjectError("E_BUILD_CONFIG",`E_BUILD_CONFIG: ${message}`);};
const forward=(value:string)=>value.replaceAll("\\","/");
const diagnosticError=(code:string,message:string)=>new Error(`${code}: ${message}`);

export function bootstrapPlugin(options: {manifestPath?:string; preview?:boolean}): Plugin {
  let projectRoot="";let publicAssets:{fileName:string;bytes:Uint8Array}[]=[];
  let config:ResolvedConfig; let manifest:Manifest; let manifestBytes:Uint8Array;
  let manifestPath=options.manifestPath??"aplg.json"; let htmlPath=""; let businessEntry:string|null=null; let businessAbsolute=""; let active=false; let building=false; let transformed=false;
  async function manifestCurrent() {
    const now=await readBoundedFile(join(config.root,manifestPath),256*1024);
    if(!Buffer.from(now).equals(Buffer.from(manifestBytes))) throw diagnosticError("E_BUILD_MANIFEST_CHANGED","The source manifest changed during the build.");
  }
  async function guardOutput() {
    if(config.root!==projectRoot || config.base!=="./" || resolve(projectRoot,config.build.outDir)!==join(projectRoot,"dist") || config.build.target!=="es2022" || config.build.sourcemap || config.build.copyPublicDir) fail("Resolved output settings changed outside the plugin layout.");
    const output=await inspectPath(join(projectRoot,"dist")).catch((error)=>{if(errorCode(error)!=="ENOENT")throw error;});
    if(output && !output.stat.isDirectory())fail("dist must be a real directory.");
  }
  return {
    name:"aplg:bootstrap", enforce:"pre",
    config(input) {
      if(input.build?.ssr) return;
      if(input.base!==undefined && input.base!=="./") fail("Plugin assets require base ./.");
      if(input.build?.outDir!==undefined && input.build.outDir!=="dist") fail("Plugin output must be the project dist directory.");
      if(input.build?.target!==undefined && input.build.target!=="es2022") fail("Plugin target must be ES2022.");
      if(input.build?.copyPublicDir===true)fail("Public assets must use the checked asset pipeline, not blind directory copying.");
      if(input.build?.sourcemap) fail("Plugin artifacts must not contain source maps.");
      if(input.build?.lib || input.build?.watch) fail("Library/watch output is not a plugin view build.");
      for(const settings of [input.build?.rollupOptions,input.build?.rolldownOptions]) {
        if(!settings) continue;
        const outputs=Array.isArray(settings.output)?settings.output:[settings.output];
        for(const output of outputs) if(output && (output.dir || output.file || output.format && output.format!=="es" || output.sourcemap || output.codeSplitting===false)) fail("Output paths, format and dynamic chunking cannot override the plugin layout.");
      }
      try{normalizeArchivePath(manifestPath);}catch{fail("Manifest path must be a portable project-relative file.");}
      if(manifestPath.startsWith("dist/")) fail("The source manifest cannot live in generated dist.");
      return {base:"./",build:{outDir:"dist",target:"es2022",sourcemap:false,modulePreload:false,copyPublicDir:false}};
    },
    async configResolved(resolved) {
      config=resolved;projectRoot=config.root; building=config.command==="build"; active=!config.build.ssr && (building || options.preview===true && config.command==="serve");
      if(!active) return;
      if(building) {
        if(config.plugins.filter((plugin)=>plugin.name==="aplg:bootstrap").length!==1) fail("Use aplgVite exactly once in a plugin build.");
        if(config.base!=="./" || resolve(config.root,config.build.outDir)!==join(config.root,"dist") || config.build.target!=="es2022" || config.build.sourcemap) fail("Resolved plugin output settings violate the safe layout.");
        try {const output=await inspectPath(join(config.root,"dist"));if(!output.stat.isDirectory())fail("dist must be a real directory.");}
        catch(error){if(errorCode(error)!=="ENOENT")throw error;}
      }
      const root=await inspectPath(config.root); if(!root.stat.isDirectory()) fail("Plugin root must be a real directory.");
      manifestBytes=await readBoundedFile(join(config.root,manifestPath),256*1024);
      const parsed=validateWebManifest(parseStrictJson(decodeUtf8(manifestBytes)));
      if(!parsed.ok) throw diagnosticError(parsed.diagnostics[0].code,parsed.diagnostics[0].message);
      manifest=parsed.value; htmlPath=manifest.entry.slice("dist/".length);
      const expected=resolve(config.root,htmlPath);
      if(building) {
        const input=config.build.rolldownOptions.input;
        const paths=typeof input==="string"?[input]:Array.isArray(input)?input:input?Object.values(input):[join(config.root,"index.html")];
        if(paths.length!==1 || resolve(config.root,paths[0])!==expected) fail("Build exactly the HTML entry declared by the manifest.");
      }
      await readBoundedFile(expected,2*1024*1024);
      businessEntry=null;businessAbsolute="";transformed=false;
    },
    buildStart: {
      order:"post",sequential:true,
      async handler() {if(!active || !building)return;await guardOutput();try {publicAssets=await readPublicAssets(projectRoot,config.publicDir);} catch(error) {if(error instanceof ProjectError)throw diagnosticError(error.code,error.message);throw error;}},
    },
    renderStart: {
      order:"pre",sequential:true,
      async handler(output) {if(!active || !building)return;await guardOutput();if(output.file || output.dir && resolve(projectRoot,output.dir)!==join(projectRoot,"dist"))fail("Output hooks cannot redirect plugin files.");},
    },
    transformIndexHtml: {
      order:"pre",
      async handler(html,context) {
        if(!active) return;
        if(resolve(context.filename)!==resolve(config.root,htmlPath)) fail("Unexpected additional HTML entry.");
        if(transformed && building) fail("Bootstrap was already injected for this build."); transformed=true;
        const scan=scanHtmlText(htmlPath,html,true);
        if(scan.diagnostics.length) throw diagnosticError(scan.diagnostics[0].code,scan.diagnostics[0].message);
        if(!scan.scripts.length) return html+`<script type="module" src="${virtualPublic}"></script>`;
        const script=scan.scripts[0]; businessEntry=resolveResource(htmlPath,script.source,"module",true,true);
        if(!businessEntry || businessEntry===virtualPublic.slice(1) || !/\.[cm]?[jt]sx?$/.test(businessEntry) || businessEntry.startsWith("dist/") || /[?#]/.test(script.source)) fail("The business entry must be a local JS/TS module without URL modifiers.");
        businessAbsolute=resolve(config.root,businessEntry!);
        await readBoundedFile(businessAbsolute,16*1024*1024);
        return html.slice(0,script.start)+`<script type="module" src="${virtualPublic}"></script>`+html.slice(script.end);
      },
    },
    resolveId(source) {if(active && source===virtualPublic)return virtualId;},
    load(id) {
      if(!active || id!==virtualId) return;
      return `import {connectPlugin} from "@ai-switch/tauri-plugin-runtime/plugin";
let connected=false;
try { await connectPlugin(); connected=true; }
catch { const e=document.createElement("p"); e.setAttribute("role","alert"); e.dataset.aplgError="connection"; e.textContent="Plugin connection failed."; document.body.append(e); }
${businessEntry ? `if(connected) { try { await import(${JSON.stringify(building ? forward(businessAbsolute) : "/" + forward(businessEntry).replace(/^\/+/, "") )}); }
catch { const e=document.createElement("p"); e.setAttribute("role","alert"); e.dataset.aplgError="business"; e.textContent="Plugin startup failed."; document.body.append(e); } }` : ""}
`;
    },
    renderChunk(code) {
      if(!active || !building) return;
      // Remove only parsed bundler provenance comments. Do not regex-rewrite code
      // or string literals; otherwise a non-minified build leaks local paths.
      const comments=parseSync("output.js",code).comments;
      const remove=comments.filter((comment)=>comment.value.includes(config.root) || comment.value.includes(forward(config.root)));
      if(!remove.length) return;
      for(const comment of [...remove].sort((a,b)=>b.start-a.start)) code=code.slice(0,comment.start)+code.slice(comment.end);
      return {code,map:null};
    },
    generateBundle: {
      order:"post",
      async handler(_output,bundle) {
        if(!active || !building)return; await manifestCurrent();
        if(bundle["aplg-build.json"]) fail("A build record cannot be supplied by author output.");
        const registry=createPathRegistry();
        for(const asset of publicAssets) {
          if(bundle[asset.fileName] || asset.fileName==="aplg-build.json")fail("Public assets collide with generated build output.");
          this.emitFile({type:"asset",fileName:asset.fileName,source:asset.bytes});
        }
        const snapshot:ArtifactSnapshot={files:[],texts:new Map(),diagnostics:[]};
        for(const asset of publicAssets) {
          const path=`dist/${asset.fileName}`;registry.add(path,false);
          snapshot.files.push({path,size:asset.bytes.length,sha256:digest(asset.bytes)});
          if(/\.(?:html?|css|[cm]?js|json|svg)$/i.test(path))snapshot.texts.set(path,decodeUtf8(asset.bytes));
        }
        for(const item of Object.values(bundle)) {
          const path=`dist/${item.fileName}`; const policy=entryPath(path);registry.add(path,false);
          const bytes=Buffer.from(item.type==="chunk"?item.code:item.source);
          if(bytes.length>policy.limit) throw diagnosticError("E_LIMIT_EXCEEDED","Generated artifact exceeds its file budget.");
          snapshot.files.push({path,size:bytes.length,sha256:digest(bytes)});
          if(/\.(?:html?|css|[cm]?js|json|svg)$/i.test(path)) snapshot.texts.set(path,decodeUtf8(bytes));
        }
        snapshot.files.sort((a,b)=>a.path<b.path?-1:1);
        const scanned=await inspectArtifactSnapshot(snapshot,manifest,config.root);
        if(scanned.diagnostics.length)throw diagnosticError(scanned.diagnostics[0].code,scanned.diagnostics[0].message);
        const chunks=Object.values(bundle).filter((item):item is Rollup.OutputChunk=>item.type==="chunk");
        const boot=chunks.find((chunk)=>Object.keys(chunk.modules).includes(virtualId));
        if(!boot)throw diagnosticError("E_BOOTSTRAP_ORDER","Every plugin view needs a handshake bootstrap, including static HTML.");
        const business=businessEntry?chunks.find((chunk)=>Object.keys(chunk.modules).some((id)=>forward(id)===forward(businessAbsolute))):undefined;
        if(businessEntry && (!boot || !business || boot===business || !boot.dynamicImports.includes(business.fileName))) throw diagnosticError("E_BOOTSTRAP_ORDER","Business module must remain a dynamic dependency after the handshake.");
        const record:BuildRecord={formatVersion:1,devkitVersion:"0.1.1",manifestPath,manifestSha256:digest(manifestBytes),entry:manifest.entry,bootstrap:`dist/${boot.fileName}`,businessEntry,businessChunk:business?`dist/${business.fileName}`:null,files:snapshot.files};
        const recordText=JSON.stringify(record,null,2)+"\n";
        if(Buffer.byteLength(recordText)>1024*1024)throw diagnosticError("E_LIMIT_EXCEEDED","Build record exceeds 1 MiB.");
        this.emitFile({type:"asset",fileName:"aplg-build.json",source:recordText});
      },
    },
    writeBundle: {
      order:"post", sequential:true,
      async handler() {
        if(!active || !building)return;await manifestCurrent();
        const checked=await inspectBuildFiles(config.root,manifest);
        if(checked.diagnostics.length)throw diagnosticError(checked.diagnostics[0].code,checked.diagnostics[0].message);
      },
    },
  };
}

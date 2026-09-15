import http from "node:http";
import {build as bundle} from "esbuild";
import {readFile, readdir, lstat, realpath} from "node:fs/promises";
import {dirname,join,relative} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createVerificationWorkspace} from "../../../tauri-plugin-runtime/scripts/verification-workspace.mjs";
import {runNodeCommand} from "../../../tauri-plugin-runtime/scripts/verification-process.mjs";
import {aplgVite} from "../../dist/vite/index.js";
import {build} from "vite";

const repo=fileURLToPath(new URL("../../../../",import.meta.url));const runtime=join(repo,"packages/tauri-plugin-runtime");
const owned=await createVerificationWorkspace(repo);const root=join(owned.root,"plugin");
const executable=await realpath(process.execPath);
const candidates=[process.env.npm_execpath,join(dirname(executable),"node_modules/npm/bin/npm-cli.js"),join(dirname(executable),"../lib/node_modules/npm/bin/npm-cli.js"),"/usr/share/nodejs/npm/bin/npm-cli.js"];
const npm=(await Promise.all(candidates.map(async(path)=>path && /npm(?:-cli)?\.js$/.test(path) && await lstat(path).then(s=>s.isFile()).catch(()=>false)?path:undefined))).find(Boolean);
const resources=new Map();const servers=[];
const env={...process.env};for(const key of Object.keys(env))if(["node_path","node_options","force_color","clicolor_force"].includes(key.toLowerCase()))delete env[key];
const run=(args,cwd)=>runNodeCommand(args,{cwd,env,capture:true,timeout:120000});
try {
  if(!npm)throw new Error("npm CLI not found for browser fixture setup.");
  const {mkdir,writeFile}=await import("node:fs/promises");await mkdir(root);
  const [pack]=JSON.parse(await run([npm,"pack","--json","--ignore-scripts","--workspaces=false","--pack-destination",owned.root,"--loglevel=error"],runtime));
  if(!/^ai-switch-tauri-plugin-runtime-[a-zA-Z0-9.-]+\.tgz$/.test(pack.filename))throw new Error("Unexpected runtime tarball name.");
  await writeFile(join(root,"package.json"),JSON.stringify({name:"d4-browser-fixture",version:"0.1.0",private:true,type:"module",dependencies:{"@ai-switch/tauri-plugin-runtime":pathToFileURL(join(owned.root,pack.filename)).href}}));
  await run([npm,"install","--ignore-scripts","--no-audit","--no-fund","--workspaces=false"],root);
  await run([npm,"ci","--ignore-scripts","--no-audit","--no-fund","--workspaces=false"],root);
  const input=JSON.parse(await readFile(join(repo,"fixtures/aplg/protocol-v1/manifest.valid.json"),"utf8"));input.requires={"aplg.storage":"^1.0.0"};
  await writeFile(join(root,"aplg.json"),JSON.stringify(input));await mkdir(join(root,"src"));
  for(const variant of ["normal","throws","static"]) {
    await writeFile(join(root,"index.html"),variant==="static"?'<!doctype html><p>Static plugin</p>':'<!doctype html><html><head><title>Plugin fixture</title></head><body><div id="result"></div><script type="module" src="/src/main.ts"></script></body></html>');
    await writeFile(join(root,"src/main.ts"),variant==="throws"?'throw new Error("PRIVATE_EXCEPTION /host/private");':'import {aplg} from "@ai-switch/tauri-plugin-runtime/plugin"; await aplg.storage.set("started",true); document.getElementById("result")!.textContent="business-started";');
    await build({root,configFile:false,logLevel:"silent",plugins:aplgVite({preview:false})});
    for(const item of await readdir(join(root,"dist"),{recursive:true,withFileTypes:true}))if(item.isFile()){
      const path=join(item.parentPath,item.name);const name=relative(join(root,"dist"),path).replaceAll("\\","/");
      resources.set(`/${variant}/${name}`,await readFile(path));
    }
  }
  const hostResult=await bundle({entryPoints:[fileURLToPath(new URL("./fixtures/bootstrap-host.ts",import.meta.url))],bundle:true,write:false,platform:"browser",format:"esm",target:"es2022",logLevel:"silent"});
  const hostCode=hostResult.outputFiles[0].contents;
  // All browser assets now live in memory. Clean before declaring readiness:
  // Windows Playwright may terminate its webServer without running JS finally.
  await owned.cleanup();
  const hostHtml='<!doctype html><button id="connect">Connect plugin</button><button id="reject">Reject connection</button><button id="dispose">Dispose</button><p id="waiting">waiting</p><p id="status">mounting</p><p id="calls">0</p><p id="sessions">0</p><div id="slot"></div><script type="module" src="/host.js"></script>';
  function handler(asset){return (req,res)=>{
    if(req.headers.host!==`127.0.0.1:${asset?43272:43271}` || req.method!=="GET"){res.writeHead(403).end();return;}
    const path=new URL(req.url,"http://127.0.0.1").pathname;
    res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Content-Security-Policy",asset?"default-src 'none'; script-src http://127.0.0.1:43272; style-src http://127.0.0.1:43272; connect-src 'none'; frame-ancestors http://127.0.0.1:43271":"default-src 'none'; script-src 'self'; frame-src http://127.0.0.1:43272; connect-src 'none'");
    if(asset){res.setHeader("Access-Control-Allow-Origin","*");const bytes=resources.get(path);if(!bytes){res.writeHead(404).end();return;}res.writeHead(200,{"Content-Type":path.endsWith(".html")?"text/html; charset=utf-8":path.endsWith(".js")?"application/javascript; charset=utf-8":"text/plain"}).end(bytes);return;}
    if(path==="/health"){res.writeHead(200).end("ok");return;}
    if(path==="/host.js"){res.writeHead(200,{"Content-Type":"application/javascript"}).end(hostCode);return;}
    if(path==="/bootstrap-fixture"){res.writeHead(200,{"Content-Type":"text/html"}).end(hostHtml);return;}
    res.writeHead(404).end();
  };}
  for(const [port,asset] of [[43271,false],[43272,true]]){const server=http.createServer(handler(asset));servers.push(server);await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});}
  console.log("Bootstrap fixtures ready.");
  await new Promise((resolve)=>{process.once("SIGINT",resolve);process.once("SIGTERM",resolve);});
} finally {
  await Promise.all(servers.map((server)=>new Promise((resolve)=>{server.close(resolve);server.closeAllConnections();})));
  await owned.cleanup();
}

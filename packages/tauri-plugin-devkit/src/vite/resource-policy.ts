import { posix } from "node:path";
import { isBuiltin } from "node:module";
import { parse as parseHtml, type DefaultTreeAdapterTypes as H } from "parse5";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import { init, parse as parseModules } from "es-module-lexer";
import { normalizeArchivePath, type Diagnostic } from "@ai-switch/tauri-plugin-runtime/protocol";
import { ProjectError } from "../project/errors.js";
import {scanJavaScriptSyntax} from "./javascript-policy.js";

export interface ResourceReference { path: string; kind: "module" | "dynamic" | "asset" }
export interface ResourceScan { references: ResourceReference[]; diagnostics: Diagnostic[] }
export interface HtmlScript { source: string; start: number; end: number }
export const htmlElements = (document: H.Node): H.Element[] => {
  const elements: H.Element[] = []; const pending: H.Node[] = [document];
  while (pending.length) {
    const item = pending.pop()!;
    if ("tagName" in item) elements.push(item);
    if ("childNodes" in item) pending.push(...[...item.childNodes].reverse());
    if ("content" in item && item.tagName === "template") pending.push(item.content);
  }
  return elements;
};
export function resolveResource(from: string, raw: string, kind: ResourceReference["kind"], source = false, htmlUrl = false): string | null {
  const url = raw.trim();
  const fail = (code: string, message: string): never => { throw new ProjectError(code, message, from); };
  if (!url || /[\u0000-\u0020\u007f\\]/.test(url)) fail("E_RESOURCE_PATH", "Resource URLs must be nonempty portable paths.");
  if (kind !== "asset" && (/^@tauri-apps\//.test(url) || /^@ai-switch\/tauri-plugin-(?:devkit|runtime\/host)(?:[/?#]|$)/.test(url))) fail("E_HOST_IMPORT", "Host-only imports cannot enter plugin artifacts.");
  if (kind !== "asset" && (url.startsWith("node:") || isBuiltin(url))) fail("E_NODE_IMPORT", "Node imports must be bundled through their supported adapters.");
  if (url.startsWith("#") && kind === "asset") return null;
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);(?:base64,|charset=utf-8,)/i.test(url) && kind === "asset") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) fail("E_EXTERNAL_RESOURCE", "External or executable URL schemes are not offline plugin resources.");
  if (!source && url.startsWith("/")) fail("E_RESOURCE_PATH", "Artifact resource paths must be relative.");
  if (!htmlUrl && kind !== "asset" && !url.startsWith(".") && !(source && url.startsWith("/"))) fail("E_RESOURCE_PATH", "Bundled module imports must use relative paths.");
  const path = url.split(/[?#]/, 1)[0];
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return fail("E_RESOURCE_PATH", "Invalid resource URL encoding."); }
  if (/%(?:2f|5c|00|25)/i.test(path) || decoded.includes("\\")) fail("E_RESOURCE_PATH", "Ambiguous encoded path separators are forbidden.");
  const target = source && decoded.startsWith("/") ? decoded.slice(1) : posix.normalize(posix.join(posix.dirname(from), decoded));
  try { normalizeArchivePath(target); } catch { return fail("E_RESOURCE_PATH", "Resource path escapes the package or is not portable."); }
  if (!source && !target.startsWith("dist/")) fail("E_RESOURCE_PATH", "Resource path escapes dist.");
  return target;
}

export function scanHtmlText(path: string, text: string, source = false): ResourceScan & { scripts: HtmlScript[] } {
  const references: ResourceReference[] = []; const diagnostics: Diagnostic[] = []; const scripts: HtmlScript[] = [];
  const document = parseHtml(text, { sourceCodeLocationInfo: true, onParseError(error) {
    if (["duplicate-attribute", "unexpected-null-character"].includes(error.code)) diagnostics.push({code:"E_HTML_POLICY",path,message:"Ambiguous HTML attributes or characters are forbidden."});
  } });
  function error(message: string) { diagnostics.push({ code: "E_HTML_POLICY", path, message }); }
  function ref(url: string, kind: ResourceReference["kind"]) {
    try { const target = resolveResource(path, url, kind, source, true); if (target) references.push({path:target,kind}); }
    catch (e) { if (e instanceof ProjectError) diagnostics.push(e.diagnostic()); else throw e; }
  }
  for (const element of htmlElements(document)) {
    const attrs = new Map(element.attrs.map((a)=>[a.prefix ? `${a.prefix}:${a.name}` : a.name,a.value]));
    if (["base", "iframe", "object", "embed"].includes(element.tagName)) error("Active embedded documents and base URL overrides are forbidden.");
    if (element.tagName === "meta" && /^(?:refresh|content-security-policy)$/i.test(attrs.get("http-equiv") ?? "")) error("Document redirects and CSP overrides are forbidden.");
    for (const [name,value] of attrs) {
      if (/^on/i.test(name) || name === "srcdoc" || name === "style") error("Inline executable handlers/styles/documents are forbidden.");
      if (["src","href","xlink:href","poster","action","formaction","data","background"].includes(name)) {
        ref(value, element.tagName === "script" ? "module" : "asset");
      }
      if (name === "srcset" || name === "imagesrcset") {
        // Conservative candidate parser. A data image is allowed as a single
        // src value; a comma-bearing data URL in srcset is deliberately rejected.
        if (/data:/i.test(value)) { diagnostics.push({code:"E_RESOURCE_PATH",path,message:"Use src for embedded data images, not ambiguous srcset URLs."}); continue; }
        for (const candidate of value.split(",")) {
          const parts = candidate.trim().split(/\s+/);
          if (!parts[0] || parts.length > 2 || parts[1] && !/^\d+(?:\.\d+)?[wx]$/.test(parts[1])) error("Invalid srcset candidate.");
          else ref(parts[0], "asset");
        }
      }
    }
    if (element.tagName === "script") {
      const location = element.sourceCodeLocation;
      const content = element.childNodes.filter((n): n is H.TextNode => n.nodeName === "#text").map(n=>n.value).join("");
      if (attrs.get("type") !== "module" || !attrs.get("src") || content.trim() || attrs.has("async") || attrs.has("nomodule")) error("Only one local external type=module entry is supported, without inline content or async flags.");
      if (location && attrs.get("src")) scripts.push({source:attrs.get("src")!,start:location.startOffset,end:location.endOffset});
    }
    if (element.tagName === "style") error("Use a local stylesheet instead of inline style elements.");
  }
  if (source && scripts.length > 1) error("The source HTML must have at most one module business entry.");
  return {references,diagnostics,scripts};
}

function cssUnescape(value: string): string {
  return value.replace(/\\([a-fA-F0-9]{1,6})(?:\s)?|\\([^\r\n])/g, (_all, hex: string, char: string) => hex ? String.fromCodePoint(Math.min(parseInt(hex,16),0x10ffff)) : char);
}
export async function scanArtifactText(path: string, text: string): Promise<ResourceScan> {
  if (/\.(?:html?|svg)$/i.test(path)) return scanHtmlText(path,text);
  const references: ResourceReference[] = []; const diagnostics: Diagnostic[] = [];
  const ref = (url: string, kind: ResourceReference["kind"]) => {
    try { const target = resolveResource(path,url,kind); if(target) references.push({path:target,kind}); }
    catch(error) { if(error instanceof ProjectError) diagnostics.push(error.diagnostic()); else throw error; }
  };
  if (/(?:["'\s])(?:[A-Za-z]:[\\/]|\/(?:home|Users|workspace|build|runner)\/)[^\r\n"']*\/(?:src|node_modules)\//.test(text)) diagnostics.push({code:"E_SOURCE_PATH",path,message:"Absolute build/source paths must not enter artifacts."});
  if (/\.css$/i.test(path)) {
    try {
      const css = postcss.parse(text, {from:undefined});
      css.walkComments((comment)=>{if(/sourceMappingURL\s*=/.test(comment.text))diagnostics.push({code:"E_SOURCE_MAP",path,message:"Source maps are not part of the offline artifact profile."});});
      function cssReferences(value:string) {
        valueParser(value).walk((part)=> {
          if("unclosed" in part && part.unclosed) throw new Error("Unclosed CSS value.");
          if(part.type!=="function")return;
          const name=cssUnescape(part.value).toLowerCase();
          if(name==="url") {
            const tokens=part.nodes.filter((n)=>n.type!=="space" && n.type!=="comment");
            if(tokens.length!==1 || !["string","word"].includes(tokens[0].type))throw new Error("Invalid CSS URL.");
            ref(cssUnescape(tokens[0].value),"asset");return false;
          }
          if(name==="image-set" || name==="-webkit-image-set") {
            // Bare strings are URLs in image-set, but not in arbitrary functions.
            for(const value of part.nodes)if(value.type==="string")ref(cssUnescape(value.value),"asset");
          }
        });
      }
      css.walkDecls((decl)=>cssReferences(decl.value));
      css.walkAtRules((rule)=> {
        cssReferences(rule.params);
        if(cssUnescape(rule.name).toLowerCase()!=="import")return;
        const part=valueParser(rule.params).nodes.find((n)=>n.type!=="space" && n.type!=="comment");
        if(part?.type==="string")ref(cssUnescape(part.value),"asset");
        else if(!(part?.type==="function" && cssUnescape(part.value).toLowerCase()==="url"))diagnostics.push({code:"E_RESOURCE_PATH",path,message:"Stylesheet imports must contain a literal local URL."});
      });
    } catch { diagnostics.push({code:"E_CSS_PARSE",path,message:"Stylesheet could not be parsed."}); }
  } else if (/\.[cm]?js$/i.test(path)) {
    diagnostics.push(...scanJavaScriptSyntax(path,text,(url)=>ref(url,"asset")));
    try {
      await init(); const [imports]=parseModules(text);
      for(const item of imports) {
        if(item.type === "import-meta") continue;
        if(item.type === "dynamic" && (!item.specifier || item.glob)) { diagnostics.push({code:"E_RESOURCE_PATH",path,message:"Dynamic module references must resolve to literal bundled paths."}); continue; }
        if(item.specifier) ref(item.specifier,item.type === "dynamic" ? "dynamic":"module");
      }
    } catch { diagnostics.push({code:"E_JS_PARSE",path,message:"JavaScript module references could not be parsed."}); }
  }
  return {references,diagnostics};
}

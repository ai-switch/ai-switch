import { constants, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { limits, normalizeArchivePath, type Manifest, type Diagnostic } from "@ai-switch/tauri-plugin-runtime/protocol";
import { createPathRegistry, entryPath } from "../archive/paths.js";
import { inspectPath, sameFile, samePath } from "../project/files.js";
import { ProjectError, errorCode } from "../project/errors.js";
import { readBoundedFile, decodeUtf8, parseStrictJson } from "../project/read.js";
import type { PackFile } from "../project/types.js";
import { scanArtifactText, scanHtmlText, type ResourceReference } from "./resource-policy.js";

export const buildRecordPath = "dist/aplg-build.json";
export interface BuildRecord {
  formatVersion: 1; devkitVersion: "0.1.1"; manifestPath: string; manifestSha256: string;
  entry: string; bootstrap: string; businessEntry: string | null; businessChunk: string | null;
  files: PackFile[];
}
export interface ArtifactSnapshot { files: PackFile[]; texts: Map<string,string>; diagnostics: Diagnostic[] }
const textFile = (path: string) => /\.(?:html?|[cm]?js|css|json|svg)$/i.test(path);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Stream large opaque assets; retain only the bounded text files scanners need. */
async function snapshotFile(file: string, path: string, limit: number): Promise<{file:PackFile;text?:string}> {
  const before = await inspectPath(file);
  if(!before.stat.isFile()) throw new ProjectError("E_FILE_TYPE","Build artifacts must be regular files.",path);
  if(before.stat.size > BigInt(limit)) throw new ProjectError("E_LIMIT_EXCEEDED","Build artifact exceeds its byte budget.",path);
  if(textFile(path)) {
    const bytes = await readBoundedFile(file,Math.min(limit,16*1024*1024));
    return {file:{path,size:bytes.length,sha256:hash(bytes)},text:decodeUtf8(bytes)};
  }
  const handle = await fs.open(file,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat({bigint:true});
    if(!sameFile(before.stat,opened)) throw new ProjectError("E_FILE_CHANGED","Artifact changed before reading.",path);
    const digest=createHash("sha256"); const buffer=Buffer.alloc(65536); let size=0;
    while(true) {
      const read=await handle.read(buffer,0,buffer.length,size); if(!read.bytesRead) break;
      size+=read.bytesRead; if(size > limit || size > Number(opened.size)) throw new ProjectError("E_FILE_CHANGED","Artifact grew during reading.",path);
      digest.update(buffer.subarray(0,read.bytesRead));
    }
    const after=await inspectPath(file);
    if(size !== Number(opened.size) || !samePath(before,after) || !sameFile(opened,after.stat) || !sameFile(opened,await handle.stat({bigint:true}))) throw new ProjectError("E_FILE_CHANGED","Artifact changed during reading.",path);
    return {file:{path,size,sha256:digest.digest("hex")}};
  } finally { await handle.close(); }
}
export async function snapshotBuildFiles(root: string): Promise<ArtifactSnapshot> {
  const files:PackFile[]=[]; const texts=new Map<string,string>(); const diagnostics:Diagnostic[]=[]; const registry=createPathRegistry();
  let entries=0; let bytes=0;
  async function visit(path:string) {
    if(++entries > limits.archiveEntries) throw new ProjectError("E_LIMIT_EXCEEDED","Too many build artifacts.","dist");
    const info=await inspectPath(join(root,path)); const policy=entryPath(path+(info.stat.isDirectory()?"/":""));
    registry.add(path,info.stat.isDirectory());
    if(info.stat.isDirectory()) {
      for(const name of (await fs.readdir(info.absolute)).sort()) await visit(`${path}/${name}`);
    } else {
      bytes+=Number(info.stat.size); if(bytes > limits.archiveExtractedBytes) throw new ProjectError("E_LIMIT_EXCEEDED","Build artifacts exceed their total byte budget.","dist");
      const result=await snapshotFile(info.absolute,path,path===buildRecordPath ? 1024*1024 : policy.limit);
      files.push(result.file); if(result.text !== undefined) texts.set(path,result.text);
    }
  }
  try { await visit("dist"); }
  catch(error) {
    if(error instanceof ProjectError) diagnostics.push(error.diagnostic());
    else if(["ENOENT","ENOTDIR"].includes(errorCode(error)??"")) diagnostics.push({code:"E_BUILD_MISSING",path:"dist",message:"The build output or one of its files is missing."});
    else throw new ProjectError("E_IO","Build artifacts could not be read.","dist","io");
  }
  return {files:files.sort((a,b)=>a.path<b.path?-1:1),texts,diagnostics};
}
export async function inspectArtifactSnapshot(snapshot: ArtifactSnapshot, manifest: Manifest, sourceRoot?:string) {
  const diagnostics=[...snapshot.diagnostics]; const paths=new Set(snapshot.files.map((file)=>file.path)); const references=new Map<string,ResourceReference[]>();
  if(snapshot.files.length>limits.archiveEntries || snapshot.files.reduce((sum,file)=>sum+file.size,0)>limits.archiveExtractedBytes) {
    diagnostics.push({code:"E_LIMIT_EXCEEDED",path:"dist",message:"Artifact set exceeds its count or aggregate byte budget."});
    return {diagnostics,references};
  }
  if(!paths.has(manifest.entry)) diagnostics.push({code:"E_ARCHIVE_ENTRY",path:manifest.entry,message:"The manifest HTML entry is absent from dist."});
  for(const [path,text] of snapshot.texts) {
    if(path===buildRecordPath) continue;
    if(sourceRoot && (text.includes(sourceRoot) || text.includes(sourceRoot.replaceAll("\\","/")))) diagnostics.push({code:"E_SOURCE_PATH",path,message:"Build output contains an absolute project source path."});
    const scan=await scanArtifactText(path,text); diagnostics.push(...scan.diagnostics); references.set(path,scan.references);
    for(const ref of scan.references) if(!paths.has(ref.path)) diagnostics.push({code:"E_RESOURCE_MISSING",path,message:"A local resource reference is not present in the artifact set."});
  }
  return {diagnostics,references};
}
function checkedRecord(value:unknown): BuildRecord {
  const record=value as BuildRecord;
  const fail=():never=>{throw new ProjectError("E_BUILD_RECORD","Invalid or unsupported build record.",buildRecordPath);};
  if(!record || typeof record!=="object" || Array.isArray(record) || Object.keys(record).sort().join()!==["formatVersion","devkitVersion","manifestPath","manifestSha256","entry","bootstrap","businessEntry","businessChunk","files"].sort().join()) fail();
  if(record.formatVersion!==1 || record.devkitVersion!=="0.1.1" || !/^[a-f0-9]{64}$/.test(record.manifestSha256) || !Array.isArray(record.files) || record.files.length>limits.archiveEntries) fail();
  for(const path of [record.manifestPath,record.entry,...[record.bootstrap,record.businessEntry,record.businessChunk].filter((p)=>p!==null)]) { try {normalizeArchivePath(path);} catch{fail();} }
  if(record.manifestPath.startsWith("dist/") || !record.entry.startsWith("dist/")) fail();
  if((record.businessEntry===null)!==(record.businessChunk===null)) fail();
  if(typeof record.bootstrap!=="string" || !record.bootstrap.startsWith("dist/") || record.businessChunk!==null && (!record.businessChunk.startsWith("dist/") || record.bootstrap===record.businessChunk)) fail();
  for(const file of record.files) if(!file || Object.keys(file).sort().join()!=="path,sha256,size" || typeof file.path!=="string" || !file.path.startsWith("dist/") || file.path===buildRecordPath || !Number.isSafeInteger(file.size) || file.size<0 || !/^[a-f0-9]{64}$/.test(file.sha256)) fail();
  return record;
}
export async function inspectBuildFiles(root: string, manifest: Manifest): Promise<{files:PackFile[];diagnostics:Diagnostic[]}> {
  const snapshot=await snapshotBuildFiles(root); const inspected=await inspectArtifactSnapshot(snapshot,manifest,root); const diagnostics=inspected.diagnostics;
  try {
    const text=snapshot.texts.get(buildRecordPath); if(text===undefined) throw new ProjectError("E_BUILD_RECORD","A build record is required; rebuild with aplgVite.",buildRecordPath);
    const record=checkedRecord(parseStrictJson(text));
    const sourceBytes=await readBoundedFile(join(root,record.manifestPath),256*1024);
    if(record.manifestSha256!==hash(sourceBytes) || record.entry!==manifest.entry || JSON.stringify(parseStrictJson(decodeUtf8(sourceBytes)))!==JSON.stringify(manifest)) diagnostics.push({code:"E_BUILD_MANIFEST_CHANGED",path:buildRecordPath,message:"The source manifest differs from the build record."});
    const actual=snapshot.files.filter((file)=>file.path!==buildRecordPath);
    if(JSON.stringify(record.files)!==JSON.stringify(actual)) diagnostics.push({code:"E_BUILD_RECORD",path:buildRecordPath,message:"Artifact paths, sizes or byte hashes differ from the build record."});
    const scripts=scanHtmlText(manifest.entry,snapshot.texts.get(manifest.entry)??"").scripts;
    if(record.bootstrap) {
      const loaded=(inspected.references.get(manifest.entry)??[]).filter((ref)=>ref.kind==="module").map((ref)=>ref.path);
      if(loaded.length!==1 || loaded[0]!==record.bootstrap || record.businessChunk!==null && !actual.some((file)=>file.path===record.businessChunk)) diagnostics.push({code:"E_BUILD_RECORD",path:buildRecordPath,message:"The entry does not load its recorded bootstrap/business modules."});
      const staticReach=new Set<string>(); const visit=(path:string)=>{if(staticReach.has(path))return;staticReach.add(path);for(const ref of inspected.references.get(path)??[])if(ref.kind==="module")visit(ref.path);};
      visit(record.bootstrap);
      if(record.businessChunk!==null && staticReach.has(record.businessChunk)) diagnostics.push({code:"E_BOOTSTRAP_ORDER",path:record.bootstrap,message:"Business code must not be a static dependency of bootstrap."});
      if(record.businessChunk!==null && !(inspected.references.get(record.bootstrap)??[]).some((ref)=>ref.kind==="dynamic" && ref.path===record.businessChunk)) diagnostics.push({code:"E_BUILD_RECORD",path:record.bootstrap,message:"The recorded bootstrap must dynamically import the business chunk."});
    } else if(scripts.length) diagnostics.push({code:"E_BUILD_RECORD",path:manifest.entry,message:"Static HTML cannot load unrecorded scripts."});
  } catch(error) {
    if(error instanceof ProjectError) diagnostics.push(error.diagnostic());
    else if(["ENOENT","ENOTDIR"].includes(errorCode(error)??"")) diagnostics.push({code:"E_BUILD_RECORD",path:buildRecordPath,message:"The recorded manifest is missing."});
    else throw new ProjectError("E_IO","Build record could not be checked.",buildRecordPath,"io");
  }
  return {files:snapshot.files,diagnostics};
}

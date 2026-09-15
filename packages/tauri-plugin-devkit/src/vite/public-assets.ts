import { promises as fs } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { limits } from "@ai-switch/tauri-plugin-runtime/protocol";
import { entryPath, createPathRegistry } from "../archive/paths.js";
import { inspectPath } from "../project/files.js";
import { readBoundedFile } from "../project/read.js";
import { ProjectError, errorCode } from "../project/errors.js";

/** Validate public files before Vite writes anything. We emit explicit assets,
 * rather than let Vite blindly copy secrets, links or unrecorded extra files.
 */
export async function readPublicAssets(root:string, publicDir:string|false):Promise<{fileName:string;bytes:Uint8Array}[]> {
  if(!publicDir)return [];
  const within=relative(root,publicDir);
  if(!within || within.startsWith("..") || isAbsolute(within)) throw new ProjectError("E_BUILD_CONFIG","E_BUILD_CONFIG: publicDir must stay inside the plugin root.");
  const assets:{fileName:string;bytes:Uint8Array}[]=[];const names=createPathRegistry();let count=0;let total=0;
  async function visit(directory:string,prefix:string) {
    const info=await inspectPath(directory);if(!info.stat.isDirectory())throw new ProjectError("E_FILE_TYPE","publicDir must be a real directory.");
    for(const name of (await fs.readdir(directory)).sort()) {
      if(++count>limits.archiveEntries)throw new ProjectError("E_LIMIT_EXCEEDED","Too many public assets.");
      const fileName=prefix+name;const info=await inspectPath(join(directory,name));
      const policy=entryPath(`dist/${fileName}${info.stat.isDirectory()?"/":""}`);names.add(policy.path,info.stat.isDirectory());
      if(info.stat.isDirectory())await visit(info.absolute,`${fileName}/`);
      else {
        total+=Number(info.stat.size);if(total>limits.archiveBytes)throw new ProjectError("E_LIMIT_EXCEEDED","Public input buffers exceed 128 MiB.");
        assets.push({fileName,bytes:await readBoundedFile(info.absolute,Math.min(policy.limit,limits.archiveBytes))});
      }
    }
  }
  try {await fs.lstat(publicDir);}catch(error){if(errorCode(error)==="ENOENT")return [];throw error;}
  await visit(publicDir,"");
  return assets;
}

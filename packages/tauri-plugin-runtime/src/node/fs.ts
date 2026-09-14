import promises from "./fs/promises.js";
import { createCallbackFs } from "./fs/callbacks.js";

const fs = createCallbackFs(promises);
export { promises };
export const { readFile, writeFile, appendFile, readdir, stat, mkdir, rename, copyFile, rm,
  readFileSync, writeFileSync, appendFileSync, readdirSync, statSync, mkdirSync, renameSync, copyFileSync, rmSync } = fs;
export default fs;
export type { CallbackFs, ValueCallback, VoidCallback } from "./fs/callback-types.js";
export type { FsPromises, FsError, DirectoryEntry, FileStats } from "./fs/types.js";

import { aplg } from "../../plugin/index.js";
import { createFsClient } from "./client.js";
import type { FsPromises } from "./types.js";

let client: FsPromises | undefined;
function getClient() {
  client ??= createFsClient(aplg.call, aplg.ready, { onConnectionChange: aplg.onConnectionChange });
  return client;
}
function lazy<M extends keyof FsPromises>(method: M): FsPromises[M] {
  return ((...args: unknown[]) => { const current = getClient(); return Reflect.apply(current[method], current, args); }) as FsPromises[M];
}

export const readFile = lazy("readFile");
export const writeFile = lazy("writeFile");
export const appendFile = lazy("appendFile");
export const readdir = lazy("readdir");
export const stat = lazy("stat");
export const mkdir = lazy("mkdir");
export const rename = lazy("rename");
export const copyFile = lazy("copyFile");
export const rm = lazy("rm");
const promises: FsPromises = Object.freeze({ readFile, writeFile, appendFile, readdir, stat, mkdir, rename, copyFile, rm });
export default promises;
export type { FsPromises, FsError, FileStats, DirectoryEntry, ReadFileOptions, ReadBufferOptions, ReadTextOptions, WriteFileOptions, AppendFileOptions, ReaddirOptions, MkdirOptions, RemoveOptions } from "./types.js";

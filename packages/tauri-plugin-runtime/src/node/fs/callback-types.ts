import type { Buffer } from "../buffer.js";
import type { AppendFileOptions, DirectoryEntry, FileStats, FsError, FsPromises, MkdirOptions, ReadBufferOptions, ReadFileOptions, ReadTextOptions, ReaddirOptions, RemoveOptions, WriteFileOptions } from "./types.js";

export type VoidCallback = (error: FsError | null) => void;
export type ValueCallback<T> = (...args: [error: FsError, data: undefined] | [error: null, data: T]) => void;
export type UnsupportedSync = (...args: unknown[]) => never;
export interface CallbackFs {
  readonly promises: FsPromises;
  readFile(path: string, callback: ValueCallback<Buffer>): void;
  readFile(path: string, options: ReadBufferOptions | undefined, callback: ValueCallback<Buffer>): void;
  readFile(path: string, options: ReadTextOptions, callback: ValueCallback<string>): void;
  readFile(path: string, options: ReadFileOptions | undefined, callback: ValueCallback<Buffer | string>): void;
  writeFile(path: string, data: string | Uint8Array, callback: VoidCallback): void;
  writeFile(path: string, data: string | Uint8Array, options: WriteFileOptions | undefined, callback: VoidCallback): void;
  appendFile(path: string, data: string | Uint8Array, callback: VoidCallback): void;
  appendFile(path: string, data: string | Uint8Array, options: AppendFileOptions | undefined, callback: VoidCallback): void;
  readdir(path: string, callback: ValueCallback<string[]>): void;
  readdir(path: string, options: { withFileTypes?: false } | undefined, callback: ValueCallback<string[]>): void;
  readdir(path: string, options: { withFileTypes: true }, callback: ValueCallback<DirectoryEntry[]>): void;
  readdir(path: string, options: ReaddirOptions | undefined, callback: ValueCallback<string[] | DirectoryEntry[]>): void;
  stat(path: string, callback: ValueCallback<FileStats>): void;
  mkdir(path: string, callback: VoidCallback): void;
  mkdir(path: string, options: { recursive?: false } | undefined, callback: VoidCallback): void;
  mkdir(path: string, options: MkdirOptions, callback: ValueCallback<string | undefined>): void;
  rename(from: string, to: string, callback: VoidCallback): void;
  copyFile(from: string, to: string, callback: VoidCallback): void;
  rm(path: string, callback: VoidCallback): void;
  rm(path: string, options: RemoveOptions | undefined, callback: VoidCallback): void;
  readFileSync: UnsupportedSync;
  writeFileSync: UnsupportedSync;
  appendFileSync: UnsupportedSync;
  readdirSync: UnsupportedSync;
  statSync: UnsupportedSync;
  mkdirSync: UnsupportedSync;
  renameSync: UnsupportedSync;
  copyFileSync: UnsupportedSync;
  rmSync: UnsupportedSync;
}

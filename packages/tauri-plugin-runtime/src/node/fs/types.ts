import type { Buffer } from "../buffer.js";
import type { PluginApi, ConnectionState } from "../../plugin/types.js";
import type { Unsubscribe } from "../../protocol/wire.js";
import type { FsCapabilityMessage } from "../../protocol/generated/types.generated.js";

export type CapabilityCall = PluginApi["call"];
export type FsMethod = Extract<FsCapabilityMessage, { direction: "request" }>["method"];
export type FsRequest<M extends FsMethod> = Extract<FsCapabilityMessage, { direction: "request"; method: M }>["value"];
export type FsResult<M extends FsMethod> = Extract<FsCapabilityMessage, { direction: "result"; method: M }>["value"];
export type ReadBufferOptions = null | { encoding?: null };
export type ReadTextOptions = "utf8" | { encoding: "utf8" };
export type ReadFileOptions = ReadBufferOptions | ReadTextOptions;
export type WriteFileOptions = "utf8" | null | { encoding?: "utf8"; flag?: "w" | "wx" };
export type AppendFileOptions = "utf8" | null | { encoding?: "utf8"; flag?: "a" | "ax" };
export interface DirectoryEntry { readonly name: string; isFile(): boolean; isDirectory(): boolean }
export interface FileStats { readonly size: number; readonly mtimeMs: number; isFile(): boolean; isDirectory(): boolean }
export interface MkdirOptions { recursive?: boolean }
export interface RemoveOptions { recursive?: boolean; force?: boolean }
export interface ReaddirOptions { withFileTypes?: boolean }
export interface FsError extends Error { code: string; syscall: string; path?: string; dest?: string }
export interface FsClientOptions { onConnectionChange?: (listener: (state: ConnectionState) => void) => Unsubscribe }

export interface FsPromises {
  readFile(path: string, options?: ReadBufferOptions): Promise<Buffer>;
  readFile(path: string, options: ReadTextOptions): Promise<string>;
  readFile(path: string, options?: ReadFileOptions): Promise<Buffer | string>;
  writeFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
  appendFile(path: string, data: string | Uint8Array, options?: AppendFileOptions): Promise<void>;
  readdir(path: string, options?: { withFileTypes?: false }): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirectoryEntry[]>;
  readdir(path: string, options?: ReaddirOptions): Promise<string[] | DirectoryEntry[]>;
  stat(path: string): Promise<FileStats>;
  mkdir(path: string, options?: { recursive?: false }): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  mkdir(path: string, options?: MkdirOptions): Promise<string | undefined>;
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  rm(path: string, options?: RemoveOptions): Promise<void>;
}

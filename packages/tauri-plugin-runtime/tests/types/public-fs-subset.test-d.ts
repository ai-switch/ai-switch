import fs, { promises } from "@ai-switch/tauri-plugin-runtime/node/fs";
import direct from "@ai-switch/tauri-plugin-runtime/node/fs/promises";
import type { Buffer } from "@ai-switch/tauri-plugin-runtime/node/buffer";
import type { DirectoryEntry, FileStats } from "@ai-switch/tauri-plugin-runtime/node/fs/promises";

const binary: Promise<Buffer> = direct.readFile("/data/a");
const text: Promise<string> = direct.readFile("/data/a", "utf8");
const names: Promise<string[]> = direct.readdir("/data");
const entries: Promise<DirectoryEntry[]> = direct.readdir("/data", { withFileTypes: true });
const metadata: Promise<FileStats> = direct.stat("/data/a");
const created: Promise<string | undefined> = direct.mkdir("/data/nested", { recursive: true });
const empty: Promise<void> = direct.mkdir("/data/a");
fs.readFile("/data/a", (error, data) => { if (!error) { const b: Buffer = data; void b; } });
fs.readFile("/data/a", "utf8", (error, data) => { if (!error) { const s: string = data; void s; } });
fs.mkdir("/data/nested", { recursive: true }, (error, path) => { if (!error) { const s: string | undefined = path; void s; } });
void [binary, text, names, entries, metadata, created, empty, promises];
// @ts-expect-error arbitrary encodings are not part of the supported API.
direct.readFile("/data/a", "base64");
// @ts-expect-error file descriptors and URLs are not virtual string paths.
direct.readFile(new URL("file:///data/a"));
// @ts-expect-error writeFile does not accept append flags.
direct.writeFile("/data/a", "text", { flag: "a" });
// @ts-expect-error recursive readdir is not supported.
direct.readdir("/data", { recursive: true });
// @ts-expect-error callback form requires an actual callback.
fs.writeFile("/data/a", "text");
// @ts-expect-error no unimplemented stream APIs are exported.
fs.createReadStream("/data/a");

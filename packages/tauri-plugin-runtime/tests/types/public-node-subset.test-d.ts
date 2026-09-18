import path, { join, relative, resolve } from "@ai-switch/tauri-plugin-runtime/node/path";
import { Buffer } from "@ai-switch/tauri-plugin-runtime/node/buffer";
import EventEmitter, { EventEmitter as NamedEventEmitter } from "@ai-switch/tauri-plugin-runtime/node/events";

const value: string = join("/data", "file");
const resolved: string = resolve(value);
const from: string = relative("/data", resolved);
const binary: Buffer = Buffer.from("hello", "utf8");
const slice: Buffer = binary.subarray(1);
const text: string = slice.toString("utf8");
const bytes: Uint8Array = binary;
const emitter: NamedEventEmitter = new EventEmitter();
emitter.once("event", function (this: EventEmitter, input: unknown) { this.emit("copy", input); });
const emitted: boolean = emitter.emit(Symbol("event"), bytes, text, from);
void emitted;
// @ts-expect-error no unrelated path APIs are exposed by the package entry.
path.parse(value);
// @ts-expect-error the listener API is intentionally a subset.
emitter.prependListener("event", () => {});
// @ts-expect-error public declarations do not install Node globals.
process.cwd();

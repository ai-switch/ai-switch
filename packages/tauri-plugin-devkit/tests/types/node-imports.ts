import path, { join } from "node:path";
import barePath from "path";
import fs, { promises as named } from "node:fs";
import bareFs from "fs";
import promises, { readFile } from "fs/promises";
import prefixed from "node:fs/promises";
import { Buffer } from "node:buffer";
import { Buffer as BareBuffer } from "buffer";
import EventEmitter from "node:events";
import BareEventEmitter from "events";

const value: string = path.resolve(join("/data", "note"));
const binary: Promise<Buffer> = promises.readFile(value);
const text: Promise<string> = prefixed.readFile(value, "utf8");
const copy: Buffer = BareBuffer.from("hello");
const sliced: Buffer = copy.subarray(1);
const emitted: boolean = new EventEmitter().emit("hello");
const emitter: EventEmitter = new BareEventEmitter();
fs.readFile(value, (error, data) => { if (!error) { const b: Buffer = data; void b; } });
void [binary, text, sliced, emitted, emitter, barePath, bareFs, named, readFile];
// @ts-expect-error unsupported stream API is not added by ambient aliases.
fs.createReadStream(value);
// @ts-expect-error no file descriptors in the virtual string-path API.
promises.readFile(42);
// @ts-expect-error no watch API.
fs.watch(value);
// @ts-expect-error no undeclared flags.
promises.writeFile(value, "text", { flag: "a" });
// @ts-expect-error path alias exposes only the documented subset.
path.parse(value);
// @ts-expect-error no global process polyfill or Node declarations.
process.cwd();
// @ts-expect-error buffer has a named Buffer export, no fabricated default.
import BufferDefault from "buffer";
// @ts-expect-error unsupported native process creation stays unavailable.
import { spawn } from "node:child_process";

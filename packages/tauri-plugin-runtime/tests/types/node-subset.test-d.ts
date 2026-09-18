import path, { join, relative, resolve } from "../../src/node/path.js";
import { Buffer } from "../../src/node/buffer.js";
import EventEmitter, { EventEmitter as NamedEventEmitter } from "../../src/node/events.js";

const text: string = path.join("/data", "note.txt");
const absolute: string = resolve(text);
const diff: string = relative("/data", absolute);
const bytes: Uint8Array = Buffer.from("你好", "utf8");
const decoded: string = Buffer.from(bytes).toString("utf8");
const buffer: Buffer = Buffer.alloc(4);
const subset: Buffer = buffer.subarray(1, 3);
const subsetText: string = subset.subarray(0).toString("utf8");
const emitter: NamedEventEmitter = new EventEmitter();
emitter.on("value", function (this: EventEmitter, value: unknown) { this.emit("next", value); });
emitter.once(Symbol("event"), () => {});
const emitted: boolean = emitter.emit("value", decoded, diff);
const same: EventEmitter = emitter.removeAllListeners();
void [text, absolute, diff, buffer, subset, subsetText, emitted, same];

// @ts-expect-error the public path subset does not expose Windows or native parsers.
path.win32;
// @ts-expect-error parsers are not included in the promised path subset.
path.parse(text);
// @ts-expect-error paths are strings; numbers must not be accepted.
join(1);
// @ts-expect-error listener must be a function.
emitter.on("value", 1);
// @ts-expect-error the supported EventEmitter subset does not expose this method.
emitter.setMaxListeners(100);
// @ts-expect-error importing runtime types must not install the Node process global.
process.cwd();

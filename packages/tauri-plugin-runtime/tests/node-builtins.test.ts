import { Buffer as NodeBuffer } from "node:buffer";
import { posix as nodePath } from "node:path";
import { describe, expect, test } from "vitest";
import path, { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "../src/node/path.js";
import { Buffer } from "../src/node/buffer.js";
import EventEmitter, { EventEmitter as NamedEventEmitter } from "../src/node/events.js";

describe("POSIX paths in the plugin namespace", () => {
  test.each([
    [[], "/data"],
    [["notes", "../note.txt"], "/data/note.txt"],
    [["/app", "./assets", "icon.svg"], "/app/assets/icon.svg"],
    [["ignored", "/mounts/g/a", "../b"], "/mounts/g/b"],
    [["..", "etc"], "/etc"],
  ] as const)("resolve uses /data rather than the machine cwd: %j", (parts, expected) => {
    expect(resolve(...parts)).toBe(expected);
    expect(path.resolve(...parts)).toBe(expected);
  });

  test.each([
    [], [""], ["/app", "assets", "../icon.svg"], ["/", "//a//", "./b"], ["a", "..", "b/"], ["你好", "🙂.txt"],
  ].map((parts) => ({ parts })))("join matches POSIX Node behavior: $parts", ({ parts }) => {
    expect(join(...parts)).toBe(nodePath.join(...parts));
  });

  test.each(["", ".", "..", "/", "/a/../b//", "a//b/./c/", "C:\\Users\\me\\file.txt", "../笔记.md", "///a//b"]) (
    "path transforms match Node POSIX behavior for %j", (value) => {
      expect(normalize(value)).toBe(nodePath.normalize(value));
      expect(dirname(value)).toBe(nodePath.dirname(value));
      expect(basename(value)).toBe(nodePath.basename(value));
      expect(extname(value)).toBe(nodePath.extname(value));
      expect(isAbsolute(value)).toBe(nodePath.isAbsolute(value));
    },
  );

  test.each([["/a/file.txt", ".txt"], ["file.txt.txt", ".txt"], [".hidden", ".hidden"], ["/", "/"], ["abc", "bc"], ["/a/hello", ""]])(
    "basename suffix matches Node for %s / %s", (value, suffix) => {
      expect(basename(value, suffix)).toBe(nodePath.basename(value, suffix));
    },
  );

  test.each([["", "notes"], ["notes/a", "notes/b"], ["/app/a", "/data/b"], ["/data/a", "/data/a"], ["a/..", "./"], ["/", "/mounts/g"]])(
    "relative resolves both arguments in the same virtual cwd: %s -> %s", (from, to) => {
      expect(relative(from, to)).toBe(nodePath.relative(nodePath.resolve("/data", from), nodePath.resolve("/data", to)));
    },
  );

  test("relative input cannot cause the shim to read process.cwd", () => {
    expect(relative("a", "b")).toBe("../b");
    expect(relative("", "")).toBe("");
  });

  test.each([null, undefined, 42, {}, ["a"]].map((value) => ({ value })))("invalid path arguments fail rather than coercing $value", ({ value }) => {
    expect(() => join(value as never)).toThrow(TypeError);
    expect(() => normalize(value as never)).toThrow(TypeError);
    expect(() => relative(value as never, "/data")).toThrow(TypeError);
  });
});

describe("browser Buffer", () => {
  test("uses the browser implementation rather than Node's global Buffer", () => {
    expect(Buffer).not.toBe(NodeBuffer);
    expect(Buffer.from("你好", "utf8").toString("base64")).toBe("5L2g5aW9");
    expect(Buffer.from("5L2g5aW9", "base64").toString("utf8")).toBe("你好");
    expect(Buffer.byteLength("你好🙂", "utf8")).toBe(10);
  });

  test("supports byte arrays, ArrayBuffer views and Uint8Array semantics", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const copied = Buffer.from(bytes);
    const shared = Buffer.from(bytes.buffer, 1, 2);
    expect(copied).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(copied)).toBe(true);
    bytes[1] = 9;
    expect(Array.from(copied)).toEqual([1, 2, 3, 4]);
    expect(Array.from(shared)).toEqual([9, 3]);
  });

  test("concat and slices preserve exact binary content", () => {
    const data = Buffer.concat([Buffer.from([0, 255]), Buffer.from("hi", "utf8")]);
    expect(Array.from(data)).toEqual([0, 255, 104, 105]);
    expect(data.subarray(2).toString("utf8")).toBe("hi");
    expect(data.equals(Buffer.from([0, 255, 104, 105]))).toBe(true);
  });

  test.each(["", "ASCII", "é", "你好", "🙂", "e\u0301", "\ud800"])("UTF-8 conversions match real Node for %j", (value) => {
    expect(Array.from(Buffer.from(value, "utf8"))).toEqual(Array.from(NodeBuffer.from(value, "utf8")));
    expect(Buffer.from(value, "utf8").toString("base64")).toBe(NodeBuffer.from(value, "utf8").toString("base64"));
  });
});

describe("bounded EventEmitter public API", () => {
  test("default and named constructors are the same and emit is synchronous", () => {
    expect(EventEmitter).toBe(NamedEventEmitter);
    const emitter = new EventEmitter(); const values: unknown[] = [];
    const listener = function (this: EventEmitter, value: unknown) { values.push(this === emitter, value); };
    expect(emitter.on("value", listener)).toBe(emitter);
    expect(emitter.emit("value", 42)).toBe(true);
    expect(values).toEqual([true, 42]);
    expect(emitter.off("value", listener)).toBe(emitter);
    expect(emitter.emit("value", 99)).toBe(false);
  });

  test("once removes itself before recursive emit", () => {
    const emitter = new EventEmitter(); let count = 0;
    emitter.once("changed", () => { count++; emitter.emit("changed"); });
    emitter.emit("changed"); emitter.emit("changed");
    expect(count).toBe(1);
  });

  test("off can remove an original once listener before it runs", () => {
    const emitter = new EventEmitter(); let count = 0; const listener = () => count++;
    emitter.once("event", listener); emitter.off("event", listener);
    expect(emitter.emit("event")).toBe(false); expect(count).toBe(0);
  });

  test("symbol events and selective removeAllListeners work independently", () => {
    const emitter = new EventEmitter(); const event = Symbol("event"); const values: number[] = [];
    emitter.on(event, () => values.push(1)); emitter.on("other", () => values.push(2));
    expect(emitter.removeAllListeners(event)).toBe(emitter);
    expect(emitter.emit(event)).toBe(false); emitter.emit("other");
    expect(values).toEqual([2]);
    emitter.removeAllListeners(); expect(emitter.emit("other")).toBe(false);
  });

  test("listener exceptions retain Node's synchronous failure behavior", () => {
    const emitter = new EventEmitter(); const failure = new Error("listener failed");
    emitter.on("event", () => { throw failure; });
    expect(() => emitter.emit("event")).toThrow(failure);
    expect(() => emitter.emit("error", new Error("unhandled"))).toThrow("unhandled");
  });

  test("unsupported APIs are not made available accidentally", () => {
    const emitter = new EventEmitter();
    expect("setMaxListeners" in emitter).toBe(false);
    expect("prependListener" in emitter).toBe(false);
  });
});

test("duplicate listener removal follows Node's last-registration semantics", () => {
  const emitter = new EventEmitter(); const values: string[] = [];
  const shared = () => values.push("shared");
  emitter.on("event", shared); emitter.on("event", () => values.push("middle")); emitter.on("event", shared);
  emitter.off("event", shared); emitter.emit("event");
  expect(values).toEqual(["shared", "middle"]);
});

test("removing a listener during emission does not skip its current snapshot invocation", () => {
  const emitter = new EventEmitter(); const values: string[] = [];
  const second = () => values.push("second");
  emitter.on("event", () => { values.push("first"); emitter.off("event", second); });
  emitter.on("event", second);
  emitter.emit("event"); emitter.emit("event");
  expect(values).toEqual(["first", "second", "first"]);
});

test("subclasses retain their own listener receiver and fluent return type", () => {
  class Child extends EventEmitter { value = 1; }
  const emitter = new Child();
  const chain = emitter.on("event", function () { expect(this).toBe(emitter); });
  expect(chain).toBe(emitter);
  emitter.emit("event");
});

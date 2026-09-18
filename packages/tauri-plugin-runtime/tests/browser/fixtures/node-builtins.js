// Test the actual ESM entry files produced by scripts/build.mjs, not source aliases.
const status = document.getElementById("status");
const write = (id, value) => { document.getElementById(id).textContent = value; };
const injectedGlobals = ["process", "Buffer", "require"];
let accesses = 0;
for (const name of injectedGlobals) Object.defineProperty(globalThis, name, {
  configurable: true,
  get() { accesses++; throw new Error(`Unexpected access to global ${name}`); },
  set() { accesses++; throw new Error(`Unexpected write to global ${name}`); },
});

try {
  const [{ default: path }, { Buffer }, { default: EventEmitter, EventEmitter: NamedEmitter }] = await Promise.all([
    import("/runtime/node/path.js"), import("/runtime/node/buffer.js"), import("/runtime/node/events.js"),
  ]);
  write("path", path.resolve("notes", "a.txt"));
  write("relative", path.relative("a", "b"));
  write("buffer", Buffer.from("5L2g5aW9", "base64").subarray(0).toString("utf8"));
  if (Buffer.from([1, 2]).constructor !== Buffer || EventEmitter !== NamedEmitter) throw new Error("Mismatched exports");
  const emitter = new EventEmitter(); let once = 0; let symbol = 0; let correctThis = false;
  emitter.once("value", function () { once++; correctThis = this === emitter; emitter.emit("value"); });
  emitter.emit("value"); emitter.emit("value");
  const symbolEvent = Symbol("event"); emitter.on(symbolEvent, () => symbol++); emitter.emit(symbolEvent); emitter.removeAllListeners(symbolEvent); emitter.emit(symbolEvent);
  write("events", `once:${once},this:${correctThis},symbol:${symbol}`);
  write("globals", accesses === 0 ? "absent" : `accessed:${accesses}`);
  write("unsupported", "setMaxListeners" in emitter || "win32" in path || "parse" in path ? "present" : "absent");
  status.textContent = "ready";
} catch (error) {
  status.textContent = `error:${error.message}`;
} finally {
  for (const name of injectedGlobals) delete globalThis[name];
}

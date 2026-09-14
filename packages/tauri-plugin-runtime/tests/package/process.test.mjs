import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createVerificationWorkspace } from "../../scripts/verification-workspace.mjs";
import { runNodeCommand, signalVerificationChild } from "../../scripts/verification-process.mjs";

test("runs an owned Node process without a shell and captures successful output", async () => {
  assert.equal(await runNodeCommand(["-e", 'process.stdout.write("ok")'], { capture: true }), "ok");
});

test("nonzero commands report diagnostics instead of being treated as success", async () => {
  await assert.rejects(runNodeCommand(["-e", 'console.error("bad fixture"); process.exitCode=7;'], { capture: true }), /7.*bad fixture/s);
});

test("timeout terminates the owned process and waits for it to exit", async () => {
  await assert.rejects(runNodeCommand(["-e", 'setInterval(() => {}, 1000)'], { capture: true, timeout: 150 }), /timeout/);
});

test("an abort request prevents a new command from starting", async () => {
  const controller = new AbortController(); controller.abort(new Error("verification interrupted"));
  await assert.rejects(runNodeCommand(["-e", 'process.stdout.write("should-not-run")'], { capture: true, signal: controller.signal }), /interrupted/);
});

test("aborting a running command terminates it and rejects after cleanup", async () => {
  const controller = new AbortController();
  const command = runNodeCommand(["-e", 'setInterval(() => {}, 1000)'], { capture: true, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(new Error("verification interrupted")), 150);
  try { await assert.rejects(command, /interrupted/); } finally { clearTimeout(timer); }
});

test("timing out a command also reaps its own descendant processes", async () => {
  const workspace = await createVerificationWorkspace(new URL("../../../../", import.meta.url));
  const pidFile = join(workspace.root, "descendant.pid");
  let pid;
  try {
    const script = `const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",windowsHide:true}); require("node:fs").writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); setInterval(()=>{},1000);`;
    await assert.rejects(runNodeCommand(["-e", script], { capture: true, timeout: 1500 }), /timeout/);
    pid = Number(await readFile(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    // Before the implementation is fixed, never leave the regression fixture alive.
    if (pid) { try { process.kill(pid); } catch {} }
    await workspace.cleanup();
  }
});
test("POSIX cancellation targets only the new owned process group", () => {
  const signals = [];
  signalVerificationChild({ pid: 42, kill() { throw new Error("wrong signal target"); } }, "SIGINT", { platform: "linux", kill(pid, signal) { signals.push([pid, signal]); } });
  assert.deepEqual(signals, [[-42, "SIGINT"]]);
});

test("process-group cleanup never uses pid zero or an uninitialized pid", () => {
  for (const pid of [undefined, 0, -1, 1]) {
    assert.equal(signalVerificationChild({ pid }, "SIGINT", { platform: "linux", kill() { throw new Error("unsafe signal"); } }), false);
  }
});
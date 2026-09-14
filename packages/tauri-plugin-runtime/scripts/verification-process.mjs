import { spawn } from "node:child_process";

/** POSIX children run in an owned session; Windows child.kill uses Node/libuv. */
export function signalVerificationChild(child, signal, { platform = process.platform, kill = process.kill } = {}) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 1) return false;
  try {
    if (platform === "win32") return child.kill(signal);
    kill(-child.pid, signal);
    return true;
  } catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

/** A bounded, shell-free child; interrupt first so Playwright can reap its browsers. */
export async function runNodeCommand(args, { cwd, env = process.env, capture = false, timeout = 180_000, signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let errors = ""; let failure; let force;
    const limit = 2 * 1024 * 1024;
    function interrupt(error) {
      if (failure) return;
      failure = error;
      signalVerificationChild(child, "SIGINT");
      force = setTimeout(() => signalVerificationChild(child, "SIGKILL"), 5000);
    }
    const timer = setTimeout(() => interrupt(new Error("Verification command timeout")), timeout);
    const abort = () => interrupt(signal.reason ?? new Error("Verification interrupted"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (data) => { output += data; if (!capture) process.stdout.write(data); if (output.length > limit) interrupt(new Error("Verification output limit exceeded")); });
    child.stderr.on("data", (data) => { errors += data; if (!capture) process.stderr.write(data); if (errors.length > limit) interrupt(new Error("Verification output limit exceeded")); });
    function cleanup() { clearTimeout(timer); clearTimeout(force); signal?.removeEventListener("abort", abort); }
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code, stopSignal) => {
      if (failure) signalVerificationChild(child, "SIGKILL");
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Verification command failed (${code ?? stopSignal}): ${args.slice(0, 3).join(" ")}${capture ? `\n${output}\n${errors}` : " (diagnostics above)"}`));
      else resolve(output);
    });
  });
}

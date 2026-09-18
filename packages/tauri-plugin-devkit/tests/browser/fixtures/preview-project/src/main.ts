import { aplg } from "@ai-switch/tauri-plugin-runtime/plugin";

const result = document.getElementById("preview-result");
const connection = document.getElementById("preview-connection");
const fsResult = document.getElementById("preview-fs-result");
const checkFs = document.getElementById("preview-check-fs");
const checkMemory = document.getElementById("preview-check-memory");
const memoryRead = document.getElementById("preview-memory-read");
const memoryWrite = document.getElementById("preview-memory-write");

aplg.onConnectionChange((state) => {
  connection.textContent = state;
});

await aplg.ready();
connection.textContent = "connected";
await aplg.storage.set("preview-started", true);
result.textContent = "preview-business-started";

checkFs?.addEventListener("click", async () => {
  try {
    await aplg.call("aplg.fs", "stat", { path: "/data/missing" });
    fsResult!.textContent = "unexpected-success";
  } catch (error) {
    fsResult!.textContent = typeof error === "object" && error && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown-error";
  }
});

checkMemory?.addEventListener("click", async () => {
  try {
    const opened = await aplg.call<{ handle: string; size: number }>("aplg.fs", "transfer.openRead", { path: "/data/note.txt" });
    const chunk = await aplg.call<{ dataBase64: string }>("aplg.fs", "transfer.pull", { handle: opened.handle, offset: 0, length: opened.size });
    await aplg.call("aplg.fs", "transfer.finish", { handle: opened.handle });
    memoryRead!.textContent = atob(chunk.dataBase64);
    const write = await aplg.call<{ handle: string }>("aplg.fs", "transfer.openWrite", { path: "/data/written.txt", size: 7, mode: "w" });
    await aplg.call("aplg.fs", "transfer.push", { handle: write.handle, offset: 0, dataBase64: btoa("written") });
    await aplg.call("aplg.fs", "transfer.finish", { handle: write.handle });
    const stat = await aplg.call<{ size: number }>("aplg.fs", "stat", { path: "/data/written.txt" });
    memoryWrite!.textContent = String(stat.size);
  } catch (error) {
    memoryRead!.textContent = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "unknown-error";
  }
});

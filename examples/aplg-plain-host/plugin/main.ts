import { aplg } from "@ai-switch/tauri-plugin-runtime/plugin";
import "../src/style.css";

const input = document.querySelector<HTMLTextAreaElement>("#note")!;
const result = document.querySelector<HTMLElement>("#result")!;
const connection = document.querySelector<HTMLElement>("#connection")!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
let connected = false; let busy = false;
function availability() { input.disabled = !connected || busy; for (const button of buttons) button.disabled = !connected || busy; }
function showError(error: unknown) { result.textContent = error instanceof Error ? error.message : "操作未完成。"; }
function action(id: string, operation: () => Promise<void>) {
  document.getElementById(id)!.addEventListener("click", async () => {
    if (!connected || busy) return;
    busy = true; availability();
    try { await operation(); } catch (error) { showError(error); }
    finally { busy = false; availability(); }
  });
}
action("save", async () => { await aplg.storage.set("note", input.value); result.textContent = "已保存到本次会话"; });
action("read", async () => { const value = await aplg.storage.get("note"); result.textContent = typeof value === "string" ? value : "尚未保存"; });
action("remove", async () => { await aplg.storage.remove("note"); input.value = ""; result.textContent = "已清除"; });

aplg.onConnectionChange((state) => {
  connected = state === "connected";
  connection.textContent = connected ? "已连接" : state === "closed" ? "已关闭" : "连接中断";
  availability();
});
void aplg.ready().then(() => {
  connected = true; connection.textContent = "已连接"; availability();
  document.getElementById("fs-capability")!.textContent = aplg.capabilities.supports("aplg.fs") ? "可用" : "不可用（未声明、未授权）";
}, (error) => { connection.textContent = "连接失败"; showError(error); });

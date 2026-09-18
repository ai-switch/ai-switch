import { aplg } from "../../../src/plugin/index.js";

const result = (value: string) => { document.getElementById("result")!.textContent = value; };
const error = (value: unknown) => result(`error:${(value as { code?: string }).code ?? "UNKNOWN"}`);
let unsubscribe: (() => void) | undefined; let eventCount = 0; let waiting: AbortController | undefined;
aplg.onConnectionChange((state) => { document.getElementById("connection")!.textContent = state; });
void aplg.ready().then(() => { result("ready"); document.getElementById("connection")!.textContent = "connected"; }, error);
document.getElementById("save")!.addEventListener("click", () => { void aplg.storage.set("value", (document.getElementById("value") as HTMLInputElement).value).then(() => result("saved"), error); });
document.getElementById("read")!.addEventListener("click", () => { void aplg.storage.get("value").then((value) => result(value === null ? "empty" : String(value)), error); });
document.getElementById("subscribe")!.addEventListener("click", () => {
  void aplg.subscribe("example.feed", "changed", () => { document.getElementById("events")!.textContent = String(++eventCount); }).then((remove) => { unsubscribe = remove; result("subscribed"); }, error);
});
document.getElementById("unsubscribe")!.addEventListener("click", () => { unsubscribe?.(); result("unsubscribed"); });
document.getElementById("wait")!.addEventListener("click", () => { waiting = new AbortController(); void aplg.call("example.wait", "wait", null, { signal: waiting.signal }).then(() => result("finished"), error); });
document.getElementById("cancel")!.addEventListener("click", () => waiting?.abort());
document.getElementById("reload")!.addEventListener("click", () => location.reload());

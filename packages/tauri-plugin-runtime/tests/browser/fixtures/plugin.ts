import { aplg, connectPlugin } from "../../../src/plugin/index.js";

const write = (id: string, text: string) => { document.getElementById(id)!.textContent = text; };
const label = (error: unknown) => `error:${(error as { code?: string }).code ?? "UNKNOWN"}`;

aplg.onConnectionChange((state) => write("state", state));
document.getElementById("echo")!.addEventListener("click", () => {
  void aplg.call<string>("example.echo", "echo", "again").then((value) => write("result", value), (error) => write("result", label(error)));
});

const first = connectPlugin();
const second = aplg.ready();
if (first !== second) write("status", "error:DUPLICATE_PROMISE");
void Promise.all([first, second]).then(async ([info]) => {
  write("hash", location.hash);
  write("private-info", Object.hasOwn(info, "sessionId") ? "leaked" : "none");
  write("status", "ready");
  write("state", "connected");
  write("result", await aplg.call<string>("example.echo", "echo", "hello"));
}).catch((error) => write("status", label(error)));

document.getElementById("probe-csp")!.addEventListener("click", () => {
  try { new Function("return 1")(); write("csp-result", "allowed"); } catch { write("csp-result", "blocked"); }
  try { write("dom-result", parent.document.body.tagName); } catch { write("dom-result", "blocked"); }
});

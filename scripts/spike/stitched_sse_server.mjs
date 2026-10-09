// scripts/spike/stitched_sse_server.mjs   (node 18+, 无依赖)
import http from "node:http";
const rid = "resp_stitch_spike";
const ev = (o) => `data: ${JSON.stringify(o)}\n\n`;
http.createServer((req, res) => {
  if (!req.url.startsWith("/v1/responses")) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let n = 0;
  const send = (type, extra) => res.write(ev({ type, sequence_number: n++, ...extra }));
  send("response.created", { response: { id: rid, status: "in_progress", object: "response" } });
  send("response.output_item.added", { output_index: 0, item: { id: "msg_1", type: "message", role: "assistant", status: "in_progress", content: [] } });
  send("response.output_text.delta", { output_index: 0, item_id: "msg_1", content_index: 0, delta: "第一段（断流前）。" });
  // ---- 模拟断流后网关续写：新 item，但沿用同一个 response.id 与连续序号 ----
  send("response.output_item.done", { output_index: 0, item: { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "第一段（断流前）。" }] } });
  send("response.output_item.added", { output_index: 1, item: { id: "msg_2", type: "message", role: "assistant", status: "in_progress", content: [] } });
  send("response.output_text.delta", { output_index: 1, item_id: "msg_2", content_index: 0, delta: "第二段（续写内容）。" });
  send("response.output_item.done", { output_index: 1, item: { id: "msg_2", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "第二段（续写内容）。" }] } });
  send("response.completed", { response: { id: rid, status: "completed", object: "response", output: [], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } });
  res.end();
}).listen(8799, "127.0.0.1", () => console.log("stitched sse on 8799"));

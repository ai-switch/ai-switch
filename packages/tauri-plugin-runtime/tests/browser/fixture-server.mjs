import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const fixture = new URL("./fixtures/", import.meta.url);
const scripts = new Map();
for (const entry of ["host", "plugin"]) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`${entry}.ts`, fixture))], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", logLevel: "silent" });
  scripts.set(`/${entry}.js`, result.outputFiles[0].text);
}
scripts.set("/rogue.js", await readFile(new URL("rogue.js", fixture), "utf8"));
const hostHtml = await readFile(new URL("host.html", fixture));
const pluginHtml = await readFile(new URL("plugin.html", fixture));
const rogueHtml = '<!doctype html><html><body><script src="/rogue.js"></script></body></html>';
const cspHost = "default-src 'none'; script-src 'self'; frame-src http://127.0.0.1:43172 'self'; style-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
const cspPlugin = "default-src 'none'; script-src http://127.0.0.1:43172; connect-src 'none'; frame-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'";

function handler(asset) {
  return (request, response) => {
    const expected = asset ? ["127.0.0.1:43172"] : ["127.0.0.1:43171", "localhost:43171"];
    if (request.method !== "GET" || !expected.includes(request.headers.host)) { response.writeHead(403).end(); return; }
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", asset ? cspPlugin : cspHost);
    if (asset) response.setHeader("Access-Control-Allow-Origin", "*");
    if (pathname === "/health") { response.writeHead(200, { "Content-Type": "text/plain" }).end("ok"); return; }
    if (scripts.has(pathname) && (asset ? pathname === "/plugin.js" : pathname !== "/plugin.js")) {
      response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" }).end(scripts.get(pathname)); return;
    }
    if (asset && pathname === "/plugin.html") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(pluginHtml); return; }
    if (!asset && pathname === "/rogue.html") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(rogueHtml); return; }
    if (!asset && pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(hostHtml); return; }
    response.writeHead(404).end();
  };
}
const servers = [http.createServer(handler(false)), http.createServer(handler(true))];
await Promise.all(servers.map((server, index) => new Promise((resolve, reject) => {
  server.once("error", reject); server.listen(43171 + index, "127.0.0.1", resolve);
})));
console.log("Handshake fixtures ready on loopback ports 43171 and 43172.");
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { servers.forEach((server) => server.close()); });

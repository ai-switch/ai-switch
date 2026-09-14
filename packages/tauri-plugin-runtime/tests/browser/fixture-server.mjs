import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const fixture = new URL("./fixtures/", import.meta.url);
const scripts = new Map();
for (const entry of ["host", "plugin", "managed-host", "managed-plugin", "hostile-plugin", "fs-host"]) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`${entry}.ts`, fixture))], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", logLevel: "silent" });
  scripts.set(`/${entry}.js`, result.outputFiles[0].text);
}
scripts.set("/rogue.js", await readFile(new URL("rogue.js", fixture), "utf8"));
const runtimeAssets = new Map();
const dist = new URL("../../dist/", import.meta.url);
for (const name of await readdir(dist).catch(() => [])) {
  if (/^chunk-[A-Za-z0-9-]+\.js$/.test(name)) runtimeAssets.set(`/runtime/${name}`, await readFile(new URL(name, dist), "utf8"));
}
for (const name of ["node/path", "node/buffer", "node/events", "node/fs", "node/fs/promises", "plugin/index"]) {
  const code = await readFile(new URL(`${name}.js`, dist), "utf8").catch(() => null);
  if (code !== null) runtimeAssets.set(`/runtime/${name}.js`, code);
}
const nodeBuiltinsScript = await readFile(new URL("node-builtins.js", fixture), "utf8");
const nodeContainerScript = await readFile(new URL("node-builtins-container.js", fixture), "utf8");
const nodeHtml = '<!doctype html><meta charset="utf-8"><div id="status">loading</div><div id="path"></div><div id="relative"></div><div id="buffer"></div><div id="events"></div><div id="globals"></div><div id="unsupported"></div><script type="module" src="/node-builtins.js"></script>';
const containerHtml = '<!doctype html><meta charset="utf-8"><div id="messages">0</div><iframe sandbox="allow-scripts" src="http://127.0.0.1:43172/node-builtins"></iframe><script src="/node-builtins-container.js"></script>';
const fsPluginScript = await readFile(new URL("fs-plugin.js", fixture), "utf8");
const fsPluginHtml = '<!doctype html><div id="status">loading</div><div id="shared"></div><div id="result"></div><button id="roundtrip">Roundtrip</button><button id="concurrent">Concurrent</button><script type="module" src="/fs-plugin.js"></script>';
const fsHostHtml = '<!doctype html><div id="active">0</div><div id="peak">0</div><div id="calls">0</div><button id="release">Release writes</button><button id="close">Close session</button><button id="disconnect">Disconnect</button><button id="reconnect">Reconnect</button><div id="container"></div><script type="module" src="/fs-host.js"></script>';
const hostHtml = await readFile(new URL("host.html", fixture));
const pluginHtml = await readFile(new URL("plugin.html", fixture));
const managedHostHtml = await readFile(new URL("managed-host.html", fixture));
const managedPluginHtml = await readFile(new URL("managed-plugin.html", fixture));
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
    if (runtimeAssets.has(pathname)) { response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" }).end(runtimeAssets.get(pathname)); return; }
    if (pathname === "/node-builtins.js") { response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" }).end(nodeBuiltinsScript); return; }
    if (pathname === "/node-builtins") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(nodeHtml); return; }
    if (!asset && pathname === "/node-builtins-container.js") { response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" }).end(nodeContainerScript); return; }
    if (!asset && pathname === "/node-builtins-container") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(containerHtml); return; }
    if (asset && pathname === "/fs-plugin.js") { response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" }).end(fsPluginScript); return; }
    if (asset && pathname === "/fs-plugin.html") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fsPluginHtml); return; }
    if (!asset && pathname === "/fs-host") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fsHostHtml); return; }
    if (pathname === "/health") { response.writeHead(200, { "Content-Type": "text/plain" }).end("ok"); return; }
    if (scripts.has(pathname) && (asset ? ["/plugin.js", "/managed-plugin.js", "/hostile-plugin.js"].includes(pathname) : !["/plugin.js", "/managed-plugin.js", "/hostile-plugin.js"].includes(pathname))) {
      response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" }).end(scripts.get(pathname)); return;
    }
    if (asset && pathname === "/plugin.html") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(pluginHtml); return; }
    if (asset && pathname === "/managed-plugin.html") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(managedPluginHtml); return; }
    if (asset && pathname === "/hostile-plugin.html") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end('<!doctype html><script type="module" src="/hostile-plugin.js"></script>'); return; }
    if (asset && pathname === "/silent-plugin.html") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<!doctype html><p>No handshake</p>"); return; }
    if (!asset && pathname === "/runtime-host") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(managedHostHtml); return; }
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

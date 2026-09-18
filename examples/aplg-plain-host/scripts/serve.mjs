import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Static loopback-only demo server, not a production asset-authorizing backend. */
export async function startExampleServers({ distRoot = fileURLToPath(new URL("../dist/", import.meta.url)), hostPort = 0, assetPort = 0 } = {}) {
  const root = await realpath(distRoot);
  const manifest = JSON.parse(await readFile(join(root, ".vite/manifest.json"), "utf8"));
  async function pageAssets(entry) {
    const paths = new Set([entry]); const seen = new Set();
    function visit(name) {
      if (seen.has(name)) return; seen.add(name);
      const item = manifest[name];
      if (!item) throw new Error(`Missing Vite entry: ${name}`);
      paths.add(item.file);
      for (const file of [...item.css ?? [], ...item.assets ?? []]) paths.add(file);
      for (const imported of [...item.imports ?? [], ...item.dynamicImports ?? []]) visit(imported);
    }
    visit(entry);
    const assets = new Map();
    for (const path of paths) {
      if (typeof path !== "string" || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe demo asset path.");
      const actual = await realpath(join(root, path));
      const fromRoot = relative(root, actual);
      if (!fromRoot || isAbsolute(fromRoot) || fromRoot.startsWith("..")) throw new Error("Demo asset escaped its output directory.");
      assets.set(`/${path}`, await readFile(actual));
    }
    return assets;
  }
  const [hostAssets, pluginAssets] = await Promise.all([pageAssets("index.html"), pageAssets("plugin/index.html")]);
  const state = { hostOrigin: "", assetOrigin: "" };
  function handler(asset) {
    return (request, response) => {
      const own = asset ? state.assetOrigin : state.hostOrigin;
      if (request.headers.host !== new URL(own).host) { response.writeHead(403).end(); return; }
      if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
      const csp = asset
        ? `default-src 'none'; script-src ${state.assetOrigin}; style-src ${state.assetOrigin}; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors ${state.hostOrigin}`
        : `default-src 'none'; script-src 'self'; style-src 'self'; frame-src ${state.assetOrigin}; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'`;
      response.setHeader("Content-Security-Policy", csp);
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      if (asset) response.setHeader("Access-Control-Allow-Origin", "*");
      let path;
      try { path = new URL(request.url, own).pathname; } catch { response.writeHead(400).end(); return; }
      if (!asset && path === "/health") { response.writeHead(200, { "Content-Type": "text/plain" }).end("ok"); return; }
      if (!asset && path === "/") path = "/index.html";
      const body = (asset ? pluginAssets : hostAssets).get(path);
      if (!body) { response.writeHead(404).end(); return; }
      const data = !asset && path === "/index.html" ? body.toString("utf8").replaceAll("__APLG_ASSET_ORIGIN__", state.assetOrigin) : body;
      const type = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream";
      response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
      response.end(request.method === "HEAD" ? undefined : data);
    };
  }
  const host = createServer(handler(false)); const asset = createServer(handler(true));
  async function listen(server, port) {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    await Promise.all([host, asset].map((server) => new Promise((resolve) => {
      server.close(resolve); server.closeAllConnections();
    })));
  }
  try {
    state.hostOrigin = await listen(host, hostPort);
    state.assetOrigin = await listen(asset, assetPort);
  } catch (error) { await close(); throw error; }
  return { ...state, close };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const servers = await startExampleServers({ hostPort: Number(process.env.APLG_HOST_PORT ?? 43181), assetPort: Number(process.env.APLG_ASSET_PORT ?? 43182) });
  console.log(`模拟宿主，仅内存数据: ${servers.hostOrigin} (plugin assets: ${servers.assetOrigin})`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void servers.close(); });
}

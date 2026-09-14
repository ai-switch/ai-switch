import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { startExampleServers } from "../../../../examples/aplg-plain-host/scripts/serve.mjs";

test("example server splits host/plugin graphs and applies strict CSP/CORS only to plugin assets", async () => {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, "aplg-server-test-"));
  let server;
  try {
    await mkdir(join(directory, ".vite")); await mkdir(join(directory, "plugin")); await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), '<main data-asset-origin="__APLG_ASSET_ORIGIN__">Host</main>');
    await writeFile(join(directory, "plugin/index.html"), "<p>Plugin</p>");
    for (const name of ["host", "plugin", "shared"]) await writeFile(join(directory, `assets/${name}.js`), `export const name = "${name}";`);
    await writeFile(join(directory, ".vite/manifest.json"), JSON.stringify({
      "index.html": { file: "assets/host.js", imports: ["shared"] },
      "plugin/index.html": { file: "assets/plugin.js", imports: ["shared"] },
      shared: { file: "assets/shared.js" },
    }));
    server = await startExampleServers({ distRoot: directory });
    const host = await fetch(server.hostOrigin);
    assert.match(await host.text(), new RegExp(server.assetOrigin.replaceAll(".", "\\.")));
    assert.equal(host.headers.get("access-control-allow-origin"), null);
    assert.ok(!host.headers.get("content-security-policy").includes("unsafe-"));
    const plugin = await fetch(`${server.assetOrigin}/plugin/index.html`);
    assert.equal(plugin.status, 200);
    assert.equal(plugin.headers.get("access-control-allow-origin"), "*");
    assert.match(plugin.headers.get("content-security-policy"), /connect-src 'none'/);
    assert.match(plugin.headers.get("content-security-policy"), /frame-ancestors http:\/\/127\.0\.0\.1:/);
    assert.equal((await fetch(`${server.hostOrigin}/assets/host.js`)).status, 200);
    assert.equal((await fetch(`${server.assetOrigin}/assets/shared.js`)).status, 200);
    for (const path of ["/", "/index.html", "/assets/host.js", "/.vite/manifest.json", "/node_modules/a.js", "/%2e%2e/package.json"]) assert.equal((await fetch(server.assetOrigin + path)).status, 404, path);
    assert.equal((await fetch(`${server.hostOrigin}/plugin/index.html`)).status, 404);
    assert.equal((await fetch(server.hostOrigin, { method: "POST" })).status, 405);
  } finally {
    await server?.close();
    const actual = await realpath(directory);
    if (dirname(actual) !== parent || !actual.startsWith(join(parent, "aplg-server-test-"))) throw new Error("Unsafe server fixture cleanup");
    await rm(actual, { recursive: true, force: true });
  }
});

import { describe, expect, test } from "vitest";
import { aplgVite } from "../src/vite/index.js";
import { bootstrapPlugin } from "../src/vite/bootstrap.js";
import { withProject } from "./support/project.js";
import { previewPlugin } from "../src/vite/preview.js";

test("preview is opt-in and production plugin composition stays unchanged when disabled", () => {
  expect(aplgVite({ preview: false }).map((plugin) => plugin.name)).toEqual(["aplg:node-aliases", "aplg:bootstrap"]);
  expect(aplgVite({ preview: true }).map((plugin) => plugin.name)).toEqual(["aplg:node-aliases", "aplg:bootstrap", "aplg:preview"]);
});



test("preview bootstrap enables a browser-relative business import only for serve", async () => {
  await withProject({
    "aplg.json": JSON.stringify({
      manifestVersion: 1, id: "io.github.example.preview", name: "Preview", version: "0.1.0",
      description: "Preview fixture", license: "MIT", engines: { aplg: "^1.0.0" }, entry: "dist/index.html",
      activation: "view", requires: {}, optional: {}, permissions: { filesystem: [], network: [], native: false },
      contributes: { views: [{ id: "main", title: "Preview" }] },
    }),
    "index.html": '<!doctype html><script type="module" src="/src/main.ts"></script>',
    "src/main.ts": 'document.body.append("business");',
  }, async (root) => {
    const plugin = bootstrapPlugin({ preview: true }) as any;
    await plugin.configResolved({ root, command: "serve", base: "/", plugins: [plugin], build: { ssr: false, outDir: "dist", target: "es2022", sourcemap: false, rolldownOptions: { input: `${root}/index.html` } } });
    const transformed = await plugin.transformIndexHtml.handler('<!doctype html><script type="module" src="/src/main.ts"></script>', { filename: `${root}/index.html` });
    expect(transformed).toContain("/@aplg/bootstrap.js");
    expect(plugin.load("\0aplg:bootstrap")).toContain('await import("/src/main.ts")');
  });
});

test("preview options reject unknown keys and invalid memory file snapshots", () => {
  expect(() => aplgVite({ preview: true, extra: true } as never)).toThrow(/APLG_INVALID_OPTIONS/);
  expect(() => aplgVite({ preview: true, memoryFiles: null } as never)).toThrow(/APLG_INVALID_OPTIONS/);
  expect(() => aplgVite({ preview: true, memoryFiles: [] } as never)).toThrow(/APLG_INVALID_OPTIONS/);
  expect(aplgVite({ preview: true, memoryFiles: { "/data/note.txt": new Uint8Array([1]) } })).toHaveLength(3);
});

describe("aplg preview policy", () => {
  test.each(["0.0.0.0", "::", "192.168.1.20", "10.0.0.4"])("rejects non-loopback server host %s", (host) => {
    const plugin = previewPlugin();
    expect(() => plugin.config?.({ server: { host } } as never)).toThrow(/APLG_PREVIEW_HOST/);
  });

  test("forces loopback-only server settings and disables HMR/client injection for the iframe", () => {
    const plugin = previewPlugin();
    const config = plugin.config?.({ server: {} } as never) as { server: Record<string, unknown> };
    expect(config.server).toMatchObject({ host: "127.0.0.1", hmr: false, cors: false });
    expect(config.server).not.toHaveProperty("open", true);
  });

  test("preview middleware exposes only its fixed route and never arbitrary filesystem paths", async () => {
    const plugin = previewPlugin();
    const handlers: ((req: any, res: any, next: () => void) => void)[] = [];
    const server = { middlewares: { use: (handler: (req: any, res: any, next: () => void) => void) => { handlers.push(handler); } } };
    plugin.configureServer?.(server as never);
    const requests: { statusCode?: number; body?: string }[] = [];
    handlers[1]({ url: "/__aplg_preview__/../../secret", headers: { host: "127.0.0.1:43272" } }, { statusCode: 200, setHeader() {}, end(body?: string) { requests.push({ body }); } }, () => { requests.push({ statusCode: 404 }); });
    await Promise.resolve();
    expect(requests).toEqual([{ statusCode: 404 }]);
  });

  test("preview middleware rejects a non-loopback Host header", async () => {
    const plugin = previewPlugin();
    const handlers: ((req: any, res: any, next: () => void) => void)[] = [];
    plugin.configureServer?.({ middlewares: { use: (handler: any) => { handlers.push(handler); } } } as never);
    const result: { statusCode?: number; body?: string } = {};
    handlers[1]({ url: "/__aplg_preview__/", headers: { host: "192.168.1.20:5173" } }, { setHeader() {}, end(body?: string) { result.body = body; }, get statusCode() { return result.statusCode; }, set statusCode(value: number) { result.statusCode = value; } }, () => {});
    expect(result).toMatchObject({ statusCode: 403, body: "Preview is loopback-only." });
  });
});

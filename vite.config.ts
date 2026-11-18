import react from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

const DEV_WEBSERVICE_CONFIG_PATH = join(homedir(), ".ai-switch", "web-service-dev.json");

/**
 * dev 实例的 Web 服务端口住在 `~/.ai-switch/web-service-dev.json`（默认 10086，
 * 被本机其他服务占用时可在该文件里改掉，例如换成 18086）。代理目标跟着这个文件
 * 走，与桌面端 dev 实例永远一致；`AI_SWITCH_DEV_API_TARGET` 仍可显式覆盖。
 * token 的读取保持惰性（只在 dev server 的 proxy configure 里发生）。
 */
function resolveDevApiTarget(): string {
  const fromEnv = process.env.AI_SWITCH_DEV_API_TARGET?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const port = (JSON.parse(readFileSync(DEV_WEBSERVICE_CONFIG_PATH, "utf8")) as { port?: number })
      .port;
    if (port && Number.isFinite(port)) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // 从没跑过桌面端（文件不存在）或读不出端口：退回历史默认 10086。
  }
  return "http://127.0.0.1:10086";
}

const DEV_API_TARGET = resolveDevApiTarget();

/// The dev page can never authenticate itself: the local dev runtime skips the web
/// auth gate (`canSkipWebAuthGate` in App.tsx), so nothing ever writes a token to
/// localStorage, while the server denies every request that carries none
/// (`is_authorized` fails closed on an empty token). The browser saw only 401s until
/// someone hand-seeded localStorage from the devtools console.
///
/// So the dev server attaches the credential instead, read from the same
/// `~/.ai-switch/web-service.json` the desktop app and `ai-switch-server` read. It
/// stays in this Node process — never in the bundle, never in localStorage.
function resolveDevApiAuthHeaders(): Record<string, string> {
  const fromEnv = process.env.AI_SWITCH_DEV_API_TOKEN?.trim();
  if (fromEnv) {
    console.log(`[dev] /api -> ${DEV_API_TARGET} (token from AI_SWITCH_DEV_API_TOKEN)`);
    return { Authorization: `Bearer ${fromEnv}` };
  }

  try {
    const token = (JSON.parse(readFileSync(DEV_WEBSERVICE_CONFIG_PATH, "utf8")) as { token?: string })
      .token?.trim();
    if (token) {
      console.log(`[dev] /api -> ${DEV_API_TARGET} (token from ${DEV_WEBSERVICE_CONFIG_PATH})`);
      return { Authorization: `Bearer ${token}` };
    }
    console.log(`[dev] /api -> ${DEV_API_TARGET} (no token configured; expect 401)`);
  } catch {
    // No local install yet: leave the requests unauthenticated rather than failing
    // the dev server, and say so, because every /api call will come back 401.
    console.log(`[dev] /api -> ${DEV_API_TARGET} (no ${DEV_WEBSERVICE_CONFIG_PATH}; expect 401)`);
  }
  return {};
}

let devApiAuthHeaders: Record<string, string> | null = null;

/// Called from each proxy entry's `configure`, which only runs when the dev server
/// wires up the proxy — so `vite build` and vitest never read the token file. The
/// options object is the one http-proxy consults per request, so assigning to it
/// after the proxy exists is enough. Memoized to keep the log to one line.
function attachDevApiAuth(options: { headers?: Record<string, string> }) {
  devApiAuthHeaders ??= resolveDevApiAuthHeaders();
  options.headers = devApiAuthHeaders;
}

function patchOcradSource(code: string) {
  return code
    .replace(/\b0([0-7]{3})\b/g, "0o$1")
    .replace(/this\[['"]Module['"]\]\s*=\s*Module;/g, 'globalThis["Module"] = Module;');
}

function ocradOptimizeDepsPlugin() {
  return {
    name: "ocrad-optimize-deps",
    setup(build: {
      onLoad: (
        options: { filter: RegExp },
        callback: (args: { path: string }) => Promise<{ contents: string; loader: "js" }>,
      ) => void;
    }) {
      build.onLoad({ filter: /ocrad\.js[\\/]ocrad\.js$/ }, async (args) => ({
        contents: patchOcradSource(await readFile(args.path, "utf8")),
        loader: "js",
      }));
    },
  };
}

function ocradLegacyOctalPlugin(): Plugin {
  return {
    name: "ocrad-legacy-octal",
    enforce: "pre",
    transform(code, id) {
      const normalizedId = id.split("?")[0].replace(/\\/g, "/");
      const isOcradModule =
        normalizedId.endsWith("/ocrad.js") || normalizedId.includes("/.vite/deps/ocrad__js.js");

      if (!isOcradModule) {
        return null;
      }

      return {
        code: patchOcradSource(code),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [ocradLegacyOctalPlugin(), UnoCSS(), react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: {
      "/api/saas/": {
        target: DEV_API_TARGET,
        changeOrigin: false,
      },
      "/v1/": {
        target: DEV_API_TARGET,
        changeOrigin: true,
      },
      "/api": {
        target: DEV_API_TARGET,
        changeOrigin: true,
        configure: (_proxy, options) => attachDevApiAuth(options),
      },
      // The events socket takes the same bearer token as /api; a browser
      // WebSocket cannot set headers, so the proxy is the only place it can come
      // from short of putting the token in the query string.
      "/ws/events": {
        target: DEV_API_TARGET,
        changeOrigin: true,
        ws: true,
        configure: (_proxy, options) => attachDevApiAuth(options),
      },
      "/ws/terminal": {
        target: DEV_API_TARGET,
        changeOrigin: true,
        ws: true,
        configure: (_proxy, options) => attachDevApiAuth(options),
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [ocradOptimizeDepsPlugin()],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2020",
    minify: false,
  },
});

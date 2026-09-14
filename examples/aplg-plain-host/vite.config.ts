import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // Each page resolves the public npm package. No repository aliases or devkit.
  build: {
    target: "es2022",
    manifest: true,
    rollupOptions: {
      input: {
        host: fileURLToPath(new URL("./index.html", import.meta.url)),
        plugin: fileURLToPath(new URL("./plugin/index.html", import.meta.url)),
      },
    },
  },
});

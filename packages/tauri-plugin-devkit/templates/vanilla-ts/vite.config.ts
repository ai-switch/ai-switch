import { defineConfig } from "vite";
import { aplgVite } from "@ai-switch/tauri-plugin-devkit/vite";

export default defineConfig({
  plugins: aplgVite({ preview: true }),
});

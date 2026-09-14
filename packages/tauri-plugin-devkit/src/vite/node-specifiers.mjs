/** Single source for Vite resolution and browser-only ambient declarations. */
export const nodeSpecifiers = Object.freeze([
  { name: "fs/promises", target: "@ai-switch/tauri-plugin-runtime/node/fs/promises", hasDefault: true },
  { name: "fs", target: "@ai-switch/tauri-plugin-runtime/node/fs", hasDefault: true },
  { name: "path", target: "@ai-switch/tauri-plugin-runtime/node/path", hasDefault: true },
  { name: "buffer", target: "@ai-switch/tauri-plugin-runtime/node/buffer", hasDefault: false },
  { name: "events", target: "@ai-switch/tauri-plugin-runtime/node/events", hasDefault: true },
].map((entry) => Object.freeze(entry)));

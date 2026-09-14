import type { Manifest } from "../../src/protocol/index.js";
import { makeManifest } from "./manifest.js";

export function makeSession() {
  return {
    sessionId: "session-a",
    manifest: makeManifest() as Manifest,
    assetUrl: "http://127.0.0.1:43172/plugin/index.html",
    info: {
      protocol: "aplg/1",
      apiVersion: "1.0.0",
      plugin: { id: "io.github.example.notes", version: "0.1.0", packageSha256: "a".repeat(64) },
      capabilities: {} as Record<string, { version: string; methods: string[] }>,
      limits: { controlBytes: 1048576, fileChunkBytes: 262144, fileBytes: 8388608, fileTransfers: 2 },
    },
  };
}

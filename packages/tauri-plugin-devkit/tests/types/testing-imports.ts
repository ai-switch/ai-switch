import { createTestHost, type TestHost, type TestHostOptions } from "@ai-switch/tauri-plugin-devkit/testing";
import type { Manifest } from "@ai-switch/tauri-plugin-runtime/protocol";

const manifest = null as unknown as Manifest;
const options: TestHostOptions = { manifest, assetUrl: "http://127.0.0.1:43272/plugin.html" };
const host: TestHost = createTestHost(options);
const sessions: string[] = host.activeSessionIds();
void [host, sessions];

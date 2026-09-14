import { expect, test } from "vitest";
import { createPluginHost } from "../src/host/index.js";
import type { HostTransport } from "../src/protocol/wire.js";

function unavailableTransport(): HostTransport {
  return {
    async call() { throw new Error("Unexpected transport call"); },
    async subscribe() { throw new Error("Unexpected subscription"); },
  };
}

test("host creation and idle disposal are safe without a DOM or transport side effects", async () => {
  const host = createPluginHost({ transport: unavailableTransport() });
  const first = host.dispose(); const second = host.dispose();
  await Promise.all([first, second]);
  await expect(host.mount({ pluginId: "io.example.a", container: null as never })).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
});

test.each(["*", "null", "https://host.example/path", "https://user:pass@host.example", "http://internet.example", "file:///tmp"])(
  "asset origin policy cannot be broadened with %s", (origin) => {
    expect(() => createPluginHost({ transport: unavailableTransport(), allowedAssetOrigins: [origin] })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  },
);

test.each([{ handshakeTimeoutMs: 0 }, { handshakeTimeoutMs: Infinity }, { requestTimeoutMs: -1 }, { requestTimeoutMs: 2 ** 31 }])(
  "timeouts must remain bounded: %j", (options) => {
    expect(() => createPluginHost({ transport: unavailableTransport(), ...options })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  },
);

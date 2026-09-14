import { expect, test } from "vitest";
import { appendBootstrapHint, readBootstrapHint, validateConnectMessage } from "../src/bridge/handshake.js";
import { makeSession } from "./fixtures/session.js";

const nonce = "A".repeat(43);

test("bootstrap hints preserve hash routes and do not place tokens in server query strings", () => {
  const url = appendBootstrapHint("https://plugins.example.com/index.html#/notes?q=1", nonce, "https://host.example.com");
  expect(new URL(url).search).toBe("");
  expect(readBootstrapHint(url)).toEqual({ nonce, parentOrigin: "https://host.example.com", originalHash: "#/notes?q=1" });
});

test.each(["https://plugins.example.com/a", "https://plugins.example.com/a#;aplg=bad", "file:///a#;aplg=bad"])("missing and malformed bootstrap context fails closed: %s", (url) => {
  expect(() => readBootstrapHint(url)).toThrow(expect.objectContaining({ code: "E_HOST_UNAVAILABLE" }));
});

test.each(["*", "null", "https://user:pass@host.example.com", "https://host.example.com/path", "javascript:alert(1)"])("parent identity cannot be a wildcard or non-origin: %s", (origin) => {
  expect(() => appendBootstrapHint("https://plugins.example.com/a", nonce, origin)).toThrow();
});

test("only exact connect messages with validated public session information are accepted", () => {
  const info = makeSession().info;
  const message = { channel: "aplg.bootstrap", protocol: "aplg/1", kind: "connect", nonce, info };
  expect(validateConnectMessage(message, nonce)).toEqual(info);
  expect(() => validateConnectMessage({ ...message, nonce: "B".repeat(43) }, nonce)).toThrow();
  expect(() => validateConnectMessage({ ...message, token: "secret" }, nonce)).toThrow();
  expect(() => validateConnectMessage({ ...message, info: { ...info, sessionId: "secret" } }, nonce)).toThrow();
  expect(() => validateConnectMessage({ ...message, info: { ...info, apiVersion: "2.0.0" } }, nonce)).toThrow();
});

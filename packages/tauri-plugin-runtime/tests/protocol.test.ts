import { describe, expect, test } from "vitest";
import { validateWireMessage, validateSessionDescriptor, validateHostEvent } from "../src/protocol/index.js";
import { makeSession } from "./fixtures/session.js";

const request = () => ({ protocol: "aplg/1", kind: "request", id: "r-1", operation: "capability.call", args: { capability: "aplg.storage", method: "get", params: { key: "note" } } });

describe("wire contract", () => {
  test("accepts each supported request and reply shape", () => {
    const messages = [request(),
      { protocol: "aplg/1", kind: "request", id: "r-2", operation: "subscription.open", args: { capability: "example.feed", topic: "changed" } },
      { protocol: "aplg/1", kind: "request", id: "r-3", operation: "subscription.close", args: { subscriptionId: "s-1" } },
      { protocol: "aplg/1", kind: "request", id: "r-4", operation: "request.cancel", args: { requestId: "r-1" } },
      { protocol: "aplg/1", kind: "result", id: "r-1", value: null },
      { protocol: "aplg/1", kind: "error", id: "r-1", error: { code: "E_PERMISSION_DENIED", message: "Denied" } },
      { protocol: "aplg/1", kind: "event", subscriptionId: "s-1", seq: 1, payload: { changed: true } },
      { protocol: "aplg/1", kind: "connection", state: "connected" },
    ];
    for (const message of messages) expect(validateWireMessage(message)).toEqual({ ok: true, value: message });
  });

  test.each(["sessionId", "pluginId", "principal", "token"])("rejects plugin-controlled identity field %s", (field) => {
    const message = request();
    expect(validateWireMessage({ ...message, args: { ...message.args, [field]: "victim" } }).ok).toBe(false);
    expect(validateWireMessage({ ...message, [field]: "victim" }).ok).toBe(false);
  });

  test.each(["session.open", "session.close", "arbitrary.command"])("rejects privileged operation %s", (operation) => {
    expect(validateWireMessage({ ...request(), operation }).ok).toBe(false);
  });

  test("rejects malformed ids, versions, sequences and unknown reply fields", () => {
    expect(validateWireMessage({ ...request(), protocol: "aplg/2" }).ok).toBe(false);
    expect(validateWireMessage({ ...request(), id: "\n" }).ok).toBe(false);
    for (const seq of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateWireMessage({ protocol: "aplg/1", kind: "event", subscriptionId: "s-1", seq, payload: null }).ok).toBe(false);
    }
    expect(validateWireMessage({ protocol: "aplg/1", kind: "error", id: "r-1", error: { code: "E_FAIL", message: "Failed", stack: "secret" } }).ok).toBe(false);
  });

  test("validates JSON before traversing messages", () => {
    expect(validateWireMessage({ ...request(), args: { ...request().args, params: new Date() } }).ok).toBe(false);
    expect(validateWireMessage({ ...request(), args: { ...request().args, params: 1n } }).ok).toBe(false);
    expect(validateWireMessage({ ...request(), args: { ...request().args, params: "x".repeat(1048576) } }).ok).toBe(false);
  });
});

describe("session negotiation", () => {
  test("a matching session and unavailable optional capability can start", () => {
    const session = makeSession();
    session.manifest.optional = { "aplg.fs": "^1.0.0" };
    expect(validateSessionDescriptor(session)).toEqual({ ok: true, value: session });
  });

  test("missing required capabilities and unsupported API versions reject before loading", () => {
    const missing = makeSession();
    missing.manifest.requires = { "aplg.fs": "^1.0.0" };
    expect(validateSessionDescriptor(missing).ok).toBe(false);
    const api = makeSession(); api.info.apiVersion = "2.0.0";
    expect(validateSessionDescriptor(api).ok).toBe(false);
  });

  test("cannot advertise undeclared capabilities or mismatched plugin identity", () => {
    const unknown = makeSession();
    unknown.info.capabilities = { "aplg.storage": { version: "1.0.0", methods: ["get", "set", "remove"] } };
    expect(validateSessionDescriptor(unknown).ok).toBe(false);
    const wrongId = makeSession(); wrongId.info.plugin.id = "io.github.victim.notes";
    expect(validateSessionDescriptor(wrongId).ok).toBe(false);
    const wrongVersion = makeSession(); wrongVersion.info.plugin.version = "0.2.0";
    expect(validateSessionDescriptor(wrongVersion).ok).toBe(false);
  });

  test("standard capability versions require their complete method contract", () => {
    const session = makeSession();
    session.manifest.requires = { "aplg.storage": "^1.0.0" };
    session.info.capabilities = { "aplg.storage": { version: "1.0.0", methods: ["get", "set"] } };
    expect(validateSessionDescriptor(session).ok).toBe(false);
    session.info.capabilities["aplg.storage"].methods.push("remove");
    expect(validateSessionDescriptor(session).ok).toBe(true);
    session.info.capabilities["aplg.storage"].version = "2.0.0";
    expect(validateSessionDescriptor(session).ok).toBe(false);
  });

  test("accepts declared extension capabilities without assuming host privileges", () => {
    const session = makeSession();
    session.manifest.requires = { "example.render": "^3.0.0" };
    session.info.capabilities = { "example.render": { version: "3.1.0", methods: ["render"] } };
    expect(validateSessionDescriptor(session).ok).toBe(true);
  });

  test.each([0, -1, 3, 1.5])("rejects invalid or expanded transfer concurrency %s", (fileTransfers) => {
    const session = makeSession(); session.info.limits.fileTransfers = fileTransfers;
    expect(validateSessionDescriptor(session).ok).toBe(false);
  });

  test.each(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "http://example.com/plugin", "https://user:pass@example.com/a"])("rejects unsafe asset URL %s", (assetUrl) => {
    expect(validateSessionDescriptor({ ...makeSession(), assetUrl }).ok).toBe(false);
  });
});

test("host events have separate strict identity-bearing shapes", () => {
  expect(validateHostEvent({ kind: "transport.state", state: "disconnected" }).ok).toBe(true);
  expect(validateHostEvent({ kind: "session.closed", sessionId: "s-1", reason: "disabled" }).ok).toBe(true);
  expect(validateHostEvent({ kind: "capability.event", sessionId: "s-1", subscriptionId: "sub-1", seq: 1, payload: null }).ok).toBe(true);
  expect(validateHostEvent({ kind: "capability.event", subscriptionId: "sub-1", seq: 1, payload: null }).ok).toBe(false);
});

test("extension capabilities cannot claim unrecognized standard namespaces", () => {
  const session = makeSession();
  session.manifest.requires = { "aplg.exec": "^1.0.0" };
  session.info.capabilities = { "aplg.exec": { version: "1.0.0", methods: ["run"] } };
  expect(validateSessionDescriptor(session).ok).toBe(false);
});

test("valid HTTPS hash routes survive session negotiation for bootstrap restoration", () => {
  const session = makeSession();
  session.assetUrl = "https://plugins.example.com/dist/index.html#/notes";
  expect(validateSessionDescriptor(session).ok).toBe(true);
});

test("wire size limits apply to UTF-8 encoded bytes including the envelope", () => {
  const empty = { protocol: "aplg/1", kind: "result", id: "r-1", value: "" };
  const overhead = Buffer.byteLength(JSON.stringify(empty));
  const atLimit = { ...empty, value: "x".repeat(1048576 - overhead) };
  expect(validateWireMessage(atLimit).ok).toBe(true);
  expect(validateWireMessage({ ...atLimit, value: atLimit.value + "x" }).ok).toBe(false);
  expect(validateWireMessage({ ...empty, value: "你".repeat(400000) }).ok).toBe(false);
});

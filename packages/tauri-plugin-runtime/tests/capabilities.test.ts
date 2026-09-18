import { expect, test } from "vitest";
import { validateCapabilityRequest, validateCapabilityResult } from "../src/protocol/index.js";

test("validates storage and dialog DTOs without granting capabilities", () => {
  expect(validateCapabilityRequest("aplg.storage", "set", { key: "note", value: "hello" }).ok).toBe(true);
  expect(validateCapabilityRequest("aplg.storage", "get", { key: "note", sessionId: "victim" }).ok).toBe(false);
  expect(validateCapabilityResult("aplg.storage", "get", null).ok).toBe(true);
  expect(validateCapabilityResult("aplg.storage", "set", "ok").ok).toBe(false);
  expect(validateCapabilityRequest("aplg.dialog", "pickDirectory", { access: "read" }).ok).toBe(true);
  expect(validateCapabilityResult("aplg.dialog", "pickDirectory", { path: "/mounts/grant-1", access: "read" }).ok).toBe(true);
  expect(validateCapabilityResult("aplg.dialog", "pickDirectory", { path: "C:/secret", access: "read" }).ok).toBe(false);
});

test("file transfer payloads enforce offsets, strict base64 and limits", () => {
  expect(validateCapabilityRequest("aplg.fs", "transfer.openWrite", { path: "/data/a", size: 3, mode: "wx" }).ok).toBe(true);
  expect(validateCapabilityRequest("aplg.fs", "transfer.openWrite", { path: "/data/a", size: 8388609, mode: "w" }).ok).toBe(false);
  expect(validateCapabilityRequest("aplg.fs", "transfer.pull", { handle: "h-1", offset: -1, length: 3 }).ok).toBe(false);
  expect(validateCapabilityRequest("aplg.fs", "transfer.pull", { handle: "h-1", offset: 0, length: 262145 }).ok).toBe(false);
  expect(validateCapabilityRequest("aplg.fs", "transfer.push", { handle: "h-1", offset: 0, dataBase64: "YWJj" }).ok).toBe(true);
  expect(validateCapabilityRequest("aplg.fs", "transfer.push", { handle: "h-1", offset: 0, dataBase64: "bad!" }).ok).toBe(false);
  expect(validateCapabilityResult("aplg.fs", "transfer.pull", { offset: 0, dataBase64: "Zg==" }).ok).toBe(true);
  expect(validateCapabilityResult("aplg.fs", "transfer.pull", { offset: 0, dataBase64: "Zh==" }).ok).toBe(false);
});

test("file DTOs cannot leak real paths or unknown methods", () => {
  expect(validateCapabilityRequest("aplg.fs", "rename", { from: "/data/a", to: "/data/b" }).ok).toBe(true);
  expect(validateCapabilityRequest("aplg.fs", "rename", { from: "/data/a", to: "/mounts/g/b" }).ok).toBe(false);
  expect(validateCapabilityRequest("aplg.fs", "copyFile", { from: "/data/a", to: "/mounts/g/b" }).ok).toBe(true);
  expect(validateCapabilityResult("aplg.fs", "mkdir", { createdPath: "/etc" }).ok).toBe(false);
  expect(validateCapabilityResult("aplg.fs", "stat", { kind: "file", size: -1, mtimeMs: 0 }).ok).toBe(false);
  expect(validateCapabilityResult("aplg.fs", "readdir", [{ name: "../secret", kind: "file" }]).ok).toBe(false);
  expect(validateCapabilityRequest("aplg.fs", "exec", {}).ok).toBe(false);
  expect(validateCapabilityRequest("example.unknown", "go", {}).ok).toBe(false);
});

test("accepts the full-size chunk and rejects one byte beyond the limit", () => {
  const fullChunk = Buffer.alloc(262144, 255).toString("base64");
  const beyond = Buffer.alloc(262145, 255).toString("base64");
  expect(validateCapabilityRequest("aplg.fs", "transfer.push", { handle: "h-1", offset: 0, dataBase64: fullChunk }).ok).toBe(true);
  expect(validateCapabilityRequest("aplg.fs", "transfer.push", { handle: "h-1", offset: 0, dataBase64: beyond }).ok).toBe(false);
});

test("all standardized request and result contracts have concrete positive fixtures", () => {
  const cases: Array<[string, unknown, unknown]> = [
    ["transfer.openRead", { path: "/data/a" }, { handle: "h", size: 0 }],
    ["transfer.openWrite", { path: "/data/a", size: 0, mode: "ax" }, { handle: "h" }],
    ["transfer.pull", { handle: "h", offset: 0, length: 1 }, { offset: 0, dataBase64: "" }],
    ["transfer.push", { handle: "h", offset: 0, dataBase64: "" }, { written: 0 }],
    ["transfer.finish", { handle: "h" }, null],
    ["transfer.abort", { handle: "h" }, null],
    ["stat", { path: "/data/a" }, { kind: "file", size: 0, mtimeMs: 0 }],
    ["readdir", { path: "/data" }, [{ name: "a", kind: "file" }]],
    ["mkdir", { path: "/data/a", recursive: true }, { createdPath: null }],
    ["rename", { from: "/data/a", to: "/data/b" }, null],
    ["copyFile", { from: "/data/a", to: "/mounts/g/b" }, null],
    ["rm", { path: "/data/a", recursive: false, force: true }, null],
  ];
  for (const [method, request, result] of cases) {
    expect(validateCapabilityRequest("aplg.fs", method, request).ok, method).toBe(true);
    expect(validateCapabilityResult("aplg.fs", method, result).ok, method).toBe(true);
  }
});

test("filesystem timestamps preserve valid pre-epoch Node stat values", () => {
  expect(validateCapabilityResult("aplg.fs", "stat", { kind: "file", size: 0, mtimeMs: -1000 }).ok).toBe(true);
});

import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { validateManifest, validateWireMessage, validateSessionDescriptor, validateCapabilityRequest, validateCapabilityResult } from "../src/protocol/index.js";

const root = new URL("../../../fixtures/aplg/protocol-v1/", import.meta.url);
async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, root), "utf8"));
}

describe("cross-language protocol fixtures", () => {
  test("a valid manifest, request and session use the public contract", async () => {
    expect(validateManifest(await readFixture("manifest.valid.json")).ok).toBe(true);
    expect(validateWireMessage(await readFixture("request.valid.json")).ok).toBe(true);
    expect(validateSessionDescriptor(await readFixture("session.valid.json")).ok).toBe(true);
  });
  test("spoofed identity is rejected", async () => {
    expect(validateWireMessage(await readFixture("request.spoofed.json")).ok).toBe(false);
  });
  test("file method fixtures cover valid requests and replies", async () => {
    const cases = await readFixture("fs.methods.json") as Array<{ method: string; request: unknown; result: unknown }>;
    for (const item of cases) {
      expect(validateCapabilityRequest("aplg.fs", item.method, item.request).ok, item.method).toBe(true);
      expect(validateCapabilityResult("aplg.fs", item.method, item.result).ok, item.method).toBe(true);
    }
  });
});

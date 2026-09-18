import { describe, expect, test } from "vitest";
import { parseManifest, validateManifest, satisfiesApiRange } from "../src/protocol/index.js";
import { makeManifest } from "./fixtures/manifest.js";

describe("manifest contract", () => {
  test("accepts a self-contained permission-free plugin without mutating its input", () => {
    const manifest = makeManifest();
    const before = structuredClone(manifest);
    expect(validateManifest(manifest)).toEqual({ ok: true, value: manifest });
    expect(manifest).toEqual(before);
    expect(parseManifest(manifest)).toEqual(manifest);
  });

  test.each(["../entry.html", "/entry.html", "dist/../entry.html", "C:/entry.html", "dist/CON.txt", "dist\\index.html", "https://example.com/a.html", "index.html", "dist/index.js"])(
    "rejects an unsafe or non-HTML entry %s", (entry) => {
      expect(validateManifest({ ...makeManifest(), entry }).ok).toBe(false);
    },
  );

  test.each(["bad id", "UPPER.Plugin", "only", "x".repeat(161)])("rejects an invalid plugin id %s", (id) => {
    expect(validateManifest({ ...makeManifest(), id }).ok).toBe(false);
  });

  test.each(["latest", "v1.0.0", "01.0.0", "1.2"])("rejects noncanonical plugin version %s", (version) => {
    expect(validateManifest({ ...makeManifest(), version }).ok).toBe(false);
  });

  test("validates engine and capability ranges rather than accepting arbitrary strings", () => {
    expect(validateManifest({ ...makeManifest(), engines: { aplg: "yesterday" } }).ok).toBe(false);
    expect(validateManifest({ ...makeManifest(), requires: { "aplg.fs": "wrong" } }).ok).toBe(false);
    expect(satisfiesApiRange("1.2.0", "^1.0.0")).toBe(true);
    expect(satisfiesApiRange("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesApiRange("1.1.0-beta.1", "^1.0.0")).toBe(false);
    expect(satisfiesApiRange("1.0.0", "not a range")).toBe(false);
  });

  test("rejects capability overlap, duplicate views, unknown permissions and root fields", () => {
    const manifest = makeManifest();
    expect(validateManifest({ ...manifest, requires: { "aplg.fs": "^1.0.0" }, optional: { "aplg.fs": "^1.0.0" } }).ok).toBe(false);
    expect(validateManifest({ ...manifest, contributes: { views: [{ id: "main", title: "A" }, { id: "main", title: "B" }] } }).ok).toBe(false);
    expect(validateManifest({ ...manifest, permissions: { ...manifest.permissions, all: true } }).ok).toBe(false);
    expect(validateManifest({ ...manifest, allowAll: true }).ok).toBe(false);
  });

  test("requires explicitly scoped filesystem and network requests", () => {
    const manifest = makeManifest();
    const permissions = { filesystem: [{ root: "user-selected", access: ["read"] }], network: [{ origins: ["https://api.example.com"], methods: ["GET"] }], native: false };
    expect(validateManifest({ ...manifest, permissions }).ok).toBe(true);
    for (const origin of ["https://*.example.com", "https://api.example.com/path", "https://u:p@api.example.com", "file:///etc", "https://api.example.com#x"]) {
      expect(validateManifest({ ...manifest, permissions: { ...permissions, network: [{ origins: [origin], methods: ["GET"] }] } }).ok).toBe(false);
    }
    expect(validateManifest({ ...manifest, permissions: { ...permissions, filesystem: [{ root: "/etc", access: ["read"] }] } }).ok).toBe(false);
    expect(validateManifest({ ...manifest, permissions: { ...permissions, network: [{ origins: ["https://api.example.com"], methods: ["get"] }] } }).ok).toBe(false);
  });

  test("allows only namespaced JSON extensions and rejects prototype pollution", () => {
    expect(validateManifest({ ...makeManifest(), extensions: { "example.feature": { enabled: true } } }).ok).toBe(true);
    expect(validateManifest({ ...makeManifest(), extensions: { unsafe: {} } }).ok).toBe(false);
    const polluted = JSON.parse(JSON.stringify(makeManifest()).replace('"requires":{}', '"requires":{"__proto__":"*"}'));
    expect(validateManifest(polluted).ok).toBe(false);
  });

  test("returns structured diagnostics and a stable parse error", () => {
    const invalid = { ...makeManifest(), version: 1 };
    const report = validateManifest(invalid);
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.diagnostics).toContainEqual(expect.objectContaining({ path: "/version", code: "E_MANIFEST_INVALID" }));
    expect(() => parseManifest(invalid)).toThrow(expect.objectContaining({ code: "E_MANIFEST_INVALID" }));
  });
});

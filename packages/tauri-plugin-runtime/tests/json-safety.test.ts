import { expect, test } from "vitest";
import { validateManifest } from "../src/protocol/index.js";
import { makeManifest } from "./fixtures/manifest.js";

test("validation rejects circular and non-JSON objects without evaluating getters", () => {
  const circular = { ...makeManifest(), extensions: { "example.loop": {} } };
  circular.extensions["example.loop"] = circular;
  expect(validateManifest(circular).ok).toBe(false);
  expect(validateManifest({ ...makeManifest(), extensions: { "example.time": new Date() } }).ok).toBe(false);
  expect(validateManifest({ ...makeManifest(), extensions: { "example.number": Infinity } }).ok).toBe(false);
  let reads = 0;
  const withGetter = { ...makeManifest() };
  Object.defineProperty(withGetter, "name", { enumerable: true, get() { reads++; return "unsafe"; } });
  expect(validateManifest(withGetter).ok).toBe(false);
  expect(reads).toBe(0);
});

test("validation rejects bounded-depth and bounded-byte inputs before schema traversal", () => {
  let nested: unknown = null;
  for (let index = 0; index < 70; index++) nested = [nested];
  expect(validateManifest({ ...makeManifest(), extensions: { "example.deep": nested } }).ok).toBe(false);
  expect(validateManifest({ ...makeManifest(), description: "x".repeat(1048577) }).ok).toBe(false);
});

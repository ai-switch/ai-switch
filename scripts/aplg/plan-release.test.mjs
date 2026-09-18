import assert from "node:assert/strict";
import test from "node:test";
import { planRelease } from "./plan-release.mjs";

const input = {
  tag: "tauri-plugin-runtime-v0.1.0",
  runtime: { name: "@ai-switch/tauri-plugin-runtime", version: "0.1.0" },
  devkit: { name: "@ai-switch/tauri-plugin-devkit", version: "0.1.0", runtimeDependency: "0.1.0" },
};

test("app version tags can never publish runtime packages", () => {
  assert.throws(() => planRelease({ ...input, tag: "v0.1.0" }), { code: "E_RELEASE_PLAN" });
});

test("package version mismatch blocks both package publications", () => {
  assert.throws(() => planRelease({ ...input, devkit: { ...input.devkit, version: "0.2.0" } }), { code: "E_RELEASE_PLAN" });
});

test("runtime is published before its exact-version devkit consumer", () => {
  assert.deepEqual(planRelease(input).order, ["@ai-switch/tauri-plugin-runtime", "@ai-switch/tauri-plugin-devkit"]);
});

test("only stable SemVer tags and exact workspace versions are accepted", () => {
  assert.throws(() => planRelease({ ...input, tag: "tauri-plugin-runtime-v0.1.0-rc.1" }), { code: "E_RELEASE_PLAN" });
  assert.throws(() => planRelease({ ...input, devkit: { ...input.devkit, runtimeDependency: "^0.1.0" } }), { code: "E_RELEASE_PLAN" });
  assert.throws(() => planRelease({ ...input, runtime: { ...input.runtime, name: "@ai-switch/other" } }), { code: "E_RELEASE_PLAN" });
});

test("the stable dist-tag is fixed and not caller-controlled", () => {
  assert.deepEqual(planRelease(input), {
    version: "0.1.0",
    order: ["@ai-switch/tauri-plugin-runtime", "@ai-switch/tauri-plugin-devkit"],
    stableTag: "latest",
  });
});
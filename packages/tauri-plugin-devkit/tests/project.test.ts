import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { validateProject } from "../src/index.js";
import { validateManifest, type Manifest } from "@ai-switch/tauri-plugin-runtime/protocol";
import { withProject, validProjectFiles } from "./support/project.js";

function changedManifest(update: (manifest: Manifest) => void) {
  const files = validProjectFiles(); const manifest = JSON.parse(files["aplg.json"]);
  update(manifest); files["aplg.json"] = JSON.stringify(manifest); return files;
}

describe("read-only source project validation", () => {
  test("never imports build configuration, source or package lifecycle scripts", async () => {
    const files = validProjectFiles();
    const code = "import {writeFileSync} from 'node:fs'; writeFileSync(new URL('./executed.txt', import.meta.url),'bad'); export default {};";
    files["vite.config.js"] = code; files["src/main.ts"] = code;
    const pkg = JSON.parse(files["package.json"]); pkg.scripts = { build: "node vite.config.js", preinstall: "node vite.config.js" }; files["package.json"] = JSON.stringify(pkg);
    files[".env"] = "DO_NOT_READ=secret";
    await withProject(files, async (root) => {
      const before = await fs.readFile(join(root, "aplg.json"));
      const report = await validateProject(root, { stage: "source" });
      expect(report.valid).toBe(true);
      await expect(fs.access(join(root, "executed.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(join(root, "dist"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(join(root, "aplg.json"))).toEqual(before);
      if (!report.valid) return;
      expect(report.manifestSha256).toBe(createHash("sha256").update(before).digest("hex"));
      expect(report.files.map((file) => file.path)).toEqual(["LICENSE", "README.md", "aplg.json", "package.json", "pnpm-lock.yaml"]);
      for (const file of report.files) {
        const bytes = await fs.readFile(join(root, file.path));
        expect(file).toEqual({ path: file.path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
      expect(report.diagnostics).toEqual([]);
    });
  });
  test("opens only the five required metadata files, never source, config, secrets or node_modules", async () => {
    const files = { ...validProjectFiles(), "vite.config.js": "throw new Error('do not execute')", ".env": "private", "node_modules/bad/index.js": "do not read" };
    await withProject(files, async (root) => {
      const open = vi.spyOn(fs, "open");
      try {
        expect((await validateProject(root)).valid).toBe(true);
        expect(open.mock.calls.map(([path]) => path)).toEqual(["aplg.json", "package.json", "README.md", "LICENSE", "pnpm-lock.yaml"].map((name) => join(root, name)));
      } finally { open.mockRestore(); }
    });
  });
  test("required metadata cannot be substituted with a directory", async () => {
    const files = validProjectFiles(); delete files["aplg.json"]; files["aplg.json/secret"] = "not metadata";
    await withProject(files, async (root) => {
      expect(await validateProject(root)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_FILE_TYPE", path: "aplg.json" })]) });
    });
  });
  test("JSON diagnostics carry locations rather than echoing invalid input values", async () => {
    const files = validProjectFiles(); files["package.json"] = '{"secret": PRIVATE_ENV_TOKEN}';
    await withProject(files, async (root) => {
      const report = await validateProject(root); expect(report.valid).toBe(false);
      expect(report.diagnostics).toEqual([expect.objectContaining({ code: "E_JSON_SYNTAX", path: "package.json", message: expect.stringMatching(/line 1, column/) })]);
      expect(JSON.stringify(report)).not.toContain("PRIVATE_ENV_TOKEN");
    });
  });
  test("hashes exact UTF-8 bytes instead of reserializing the manifest", async () => {
    const files = validProjectFiles(); files["aplg.json"] = '\n ' + files["aplg.json"].replaceAll('\n', '\r\n');
    await withProject(files, async (root) => {
      const report = await validateProject(root); expect(report.valid).toBe(true);
      if (report.valid) expect(report.manifestSha256).toBe(createHash("sha256").update(files["aplg.json"]).digest("hex"));
    });
  });
  test("uses the runtime schema and semantic checks without a second manifest definition", async () => {
    const files = changedManifest((manifest) => { manifest.entry = "../index.html"; });
    const reference = validateManifest(JSON.parse(files["aplg.json"])); expect(reference.ok).toBe(false);
    await withProject(files, async (root) => {
      const report = await validateProject(root); expect(report.valid).toBe(false);
      if (!reference.ok) expect(report.diagnostics).toEqual(expect.arrayContaining(reference.diagnostics.map((d) => ({ ...d, path: `aplg.json${d.path}` }))));
    });
  });
  test("source and package versions must agree", async () => {
    const files = validProjectFiles(); const pkg = JSON.parse(files["package.json"]); pkg.version = "0.2.0"; files["package.json"] = JSON.stringify(pkg);
    await withProject(files, async (root) => { expect(await validateProject(root)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_VERSION_MISMATCH", path: "package.json/version" })]) }); });
  });
  test.each(["aplg.json", "package.json", "README.md", "LICENSE", "pnpm-lock.yaml"])("requires a regular nonempty %s", async (name) => {
    const files = validProjectFiles(); delete files[name];
    await withProject(files, async (root) => {
      expect(await validateProject(root)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_REQUIRED_FILE", path: name })]) });
    });
  });
  test.each(["README.md", "LICENSE", "pnpm-lock.yaml"])("rejects empty documentation or lock: %s", async (name) => {
    const files = validProjectFiles(); files[name] = " \n\t ";
    await withProject(files, async (root) => { expect(await validateProject(root)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_EMPTY_FILE", path: name })]) }); });
  });
  test.each(["aplg.json", "package.json"])("rejects invalid and duplicate-key JSON in %s", async (name) => {
    const files = validProjectFiles(); files[name] = '{"version":"0.1.0","version":"0.2.0"}';
    await withProject(files, async (root) => { expect(await validateProject(root)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_JSON_DUPLICATE_KEY", path: `${name}/version` })]) }); });
  });
  test.each(["aplg.json", "package.json", "README.md", "pnpm-lock.yaml"])("rejects malformed UTF-8 in %s", async (name) => {
    const files = { ...validProjectFiles(), [name]: new Uint8Array([0xc3, 0x28]) };
    await withProject(files, async (root) => { expect(await validateProject(root)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_UTF8", path: name })]) }); });
  });
  test("does not accept a manifest larger than 256 KiB", async () => {
    const files = validProjectFiles(); files["aplg.json"] += " ".repeat(256 * 1024);
    await withProject(files, async (root) => { expect(await validateProject(root)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_LIMIT_EXCEEDED", path: "aplg.json" })]) }); });
  });
  test.each([null, [], "string", 42])("requires a package metadata object: %s", async (value) => {
    const files = validProjectFiles(); files["package.json"] = JSON.stringify(value);
    await withProject(files, async (root) => { expect(await validateProject(root)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_PACKAGE_INVALID" })]) }); });
  });
  test("rejects an API range the current runtime cannot satisfy", async () => {
    await withProject(changedManifest((m) => { m.engines.aplg = "^2.0.0"; }), async (root) => {
      expect(await validateProject(root)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_API_INCOMPATIBLE", path: "aplg.json/engines/aplg" })]) });
    });
  });
  test("web-v1 never claims native plugin support", async () => {
    await withProject(changedManifest((m) => { m.permissions.native = true; }), async (root) => { expect(await validateProject(root, { profile: "web-v1" })).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_PROFILE_UNSUPPORTED" })]) }); });
  });
  test("dist rejects output that was never produced by the build hook", async () => {
    await withProject({ ...validProjectFiles(), "dist/index.html": "already built" }, async (root) => {
      expect(await validateProject(root, { stage: "dist" })).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_BUILD_RECORD" })]) });
    });
  });
  test("rejects unsupported API options instead of silently falling back to source", async () => {
    for (const options of [{ stage: "other" }, { profile: "native-v1" }, { unknown: true }]) {
      const report = await validateProject("not-read", options as never); expect(report.valid).toBe(false);
      expect(report.diagnostics[0].code).toMatch(/E_(INVALID_ARGUMENT|PROFILE_UNSUPPORTED)/);
    }
  });
  test("does not follow a symlink/junction root or read metadata through linked directories", async () => {
    await withProject(validProjectFiles(), async (outside) => withProject({}, async (container) => {
      const link = join(container, "project"); await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
      expect(await validateProject(link)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_PATH_SYMLINK" })]) });
      await fs.mkdir(join(outside, "nested"));
      expect(await validateProject(join(link, "nested"))).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_PATH_SYMLINK" })]) });
    }));
  });
  test("returns invalid for absent or non-directory project roots", async () => {
    await withProject({ file: "not a directory" }, async (root) => {
      for (const target of [join(root, "missing"), join(root, "file")]) expect(await validateProject(target)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_PROJECT_ROOT", path: "" })]) });
    });
  });
  test("unexpected OS read failures throw a safe I/O error without a private path", async () => {
    await withProject(validProjectFiles(), async (root) => {
      const open = vi.spyOn(fs, "open").mockRejectedValue(Object.assign(new Error(`EACCES secret at ${root}`), { code: "EACCES", path: root }));
      try {
        await expect(validateProject(root)).rejects.toMatchObject({ code: "E_IO", path: "aplg.json" });
        await validateProject(root).catch((error: Error) => { expect(error.message).not.toContain(root); expect(error.message).not.toContain("secret"); });
      } finally { open.mockRestore(); }
    });
  });
});

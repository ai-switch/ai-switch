import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { runCli } from "../src/cli/run.js";
import { validProjectFiles, withProject } from "./support/project.js";
import { validArchiveEntries, writeZipFixture } from "./support/zip-fixtures.js";

function output() {
  let stdout = ""; let stderr = "";
  return { io: { stdout(text: string) { stdout += text; }, stderr(text: string) { stderr += text; } }, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

describe("aplg CLI", () => {
  test.each([[], ["--help"], ["-h"], ["--version"], ["-v"]].map((argv) => ({ argv })))("help/version do not inspect a project: %j", async ({ argv }) => {
    const out = output(); const open = vi.spyOn(fs, "open").mockRejectedValue(new Error("must not read"));
    try {
      expect(await runCli(argv, out.io, { cwd: "missing-project" })).toBe(0);
      expect(out.stdout).toMatch(argv.includes("--version") || argv.includes("-v") ? /^0\.1\.0\n$/ : /aplg validate/);
      expect(out.stderr).toBe(""); expect(open).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
  });
  test("defaults to cwd/source and writes exactly one machine-readable report", async () => {
    await withProject(validProjectFiles(), async (root) => {
      const out = output(); expect(await runCli(["validate", "--json"], out.io, { cwd: root })).toBe(0);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: true, manifest: { id: "io.github.example.notes" }, manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(out.stderr).toBe("");
      expect(out.stdout).not.toContain(root);
    });
  });
  test("resolves an explicit directory relative to cwd and does not change process.cwd", async () => {
    const current = process.cwd();
    const files = Object.fromEntries(Object.entries(validProjectFiles()).map(([name, data]) => [`nested/${name}`, data]));
    await withProject(files, async (root) => {
      const out = output(); expect(await runCli(["validate", "--stage=source", "nested"], out.io, { cwd: root })).toBe(0);
      expect(out.stdout).toMatch(/valid.*io.github.example.notes/i); expect(process.cwd()).toBe(current);
    });
  });
  test.each(["C:relative-project", "https://example.invalid/project"])("does not reinterpret nonlocal path syntax %s as a directory", async (path) => {
    const out = output(); const open = vi.spyOn(fs, "open");
    try {
      expect(await runCli(["validate", path, "--json"], out.io, { cwd: process.cwd() })).toBe(1);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_CLI_ARGUMENTS" })] });
      expect(open).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
  });
  test("an option-looking directory after -- is a path, not a JSON flag", async () => {
    const files = Object.fromEntries(Object.entries(validProjectFiles()).map(([name, data]) => [`--json/${name}`, data]));
    await withProject(files, async (root) => {
      const out = output(); expect(await runCli(["validate", "--", "--json"], out.io, { cwd: root })).toBe(0);
      expect(out.stdout).toMatch(/^Valid source project:/); expect(out.stderr).toBe("");
    });
  });
  test("invalid projects exit 1 with JSON diagnostics and concise stderr", async () => {
    await withProject({ ...validProjectFiles(), "aplg.json": "not JSON" }, async (root) => {
      const out = output(); expect(await runCli(["validate", root, "--json"], out.io, { cwd: root })).toBe(1);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_JSON_SYNTAX", path: "aplg.json" })] });
      expect(out.stderr).toContain("E_JSON_SYNTAX"); expect(out.stderr).not.toContain(root);
    });
  });
  test("dist is a clear unavailable validation, not success and not a build invocation", async () => {
    await withProject(validProjectFiles(), async (root) => {
      const out = output(); expect(await runCli(["validate", "--stage", "dist", "--json"], out.io, { cwd: root })).toBe(1);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "E_DIST_VALIDATION_UNAVAILABLE" })]) });
    });
  });
  test.each([
    ["unknown", "--json"], ["validate", "--unknown", "--json"], ["validate", "--stage", "wrong", "--json"],
    ["validate", "a", "b", "--json"], ["validate", "--stage", "--json"], ["validate", "--stage", "source", "--stage", "source", "--json"],
    ["validate", "--json", "--json"], ["validate", "--json=false", "--json"], ["validate", "--profile", "native-v1", "--json"], ["--help", "--json"],
  ].map((argv) => ({ argv })))("rejects invalid routing/options without touching files: %j", async ({ argv }) => {
    const out = output(); const open = vi.spyOn(fs, "open").mockRejectedValue(new Error("must not open"));
    try {
      expect(await runCli(argv, out.io, { cwd: "not-read" })).toBe(1);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_CLI_ARGUMENTS" })] });
      expect(open).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
  });
  test.each(["init", "pack"])("not-yet-implemented %s exits 1 without creating files", async (command) => {
    await withProject({}, async (root) => {
      const out = output(); expect(await runCli([command, "target", "--json"], out.io, { cwd: root })).toBe(1);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_COMMAND_UNAVAILABLE" })] });
      await expect(fs.access(join(root, "target"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
  test("a real I/O failure exits 2 and never exposes native paths or errors", async () => {
    await withProject(validProjectFiles(), async (root) => {
      const open = vi.spyOn(fs, "open").mockRejectedValue(Object.assign(new Error(`EACCES ${root} PRIVATE_SECRET`), { code: "EACCES" }));
      try {
        const out = output(); expect(await runCli(["validate", "--json"], out.io, { cwd: root })).toBe(2);
        expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_IO", path: "aplg.json" })] });
        expect(out.stdout + out.stderr).not.toContain(root); expect(out.stdout + out.stderr).not.toContain("PRIVATE_SECRET");
      } finally { open.mockRestore(); }
    });
  });
  test("human validation failures go to stderr without JSON noise", async () => {
    await withProject({}, async (root) => {
      const out = output(); expect(await runCli(["validate"], out.io, { cwd: root })).toBe(1);
      expect(out.stdout).toBe(""); expect(out.stderr).toContain("E_REQUIRED_FILE");
    });
  });
});

describe("aplg inspect CLI", () => {
  test("returns the inspection report as one JSON object with no signature trust claim", async () => {
    await withProject({}, async (root) => {
      await writeZipFixture(join(root, "notes.aplg"), validArchiveEntries());
      const out = output();
      expect(await runCli(["inspect", "notes.aplg", "--json"], out.io, { cwd: root })).toBe(0);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: true, signature: "not-verified", manifest: { id: "io.github.example.notes" }, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(out.stdout).not.toContain(root); expect(out.stderr).toBe("");
    });
  });
  test("human output explicitly distinguishes archive structure from signature trust", async () => {
    await withProject({}, async (root) => {
      await writeZipFixture(join(root, "notes.aplg"), validArchiveEntries()); const out = output();
      expect(await runCli(["inspect", "notes.aplg"], out.io, { cwd: root })).toBe(0);
      expect(out.stdout).toMatch(/archive/i); expect(out.stdout).toContain("signature: not-verified"); expect(out.stderr).toBe("");
    });
  });
  test("malformed archives exit 1, retain not-verified and do not echo unsafe paths", async () => {
    await withProject({}, async (root) => {
      await writeZipFixture(join(root, "bad.aplg"), [{ name: "../../outside.txt", data: "bad" }]); const out = output();
      expect(await runCli(["inspect", "bad.aplg", "--json"], out.io, { cwd: root })).toBe(1);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, signature: "not-verified", diagnostics: [expect.objectContaining({ code: "E_ARCHIVE_PATH" })] });
      expect(out.stdout + out.stderr).not.toContain("../../outside.txt");
    });
  });
  test.each([["inspect", "--json"], ["inspect", "a.aplg", "b.aplg", "--json"], ["inspect", "a.aplg", "--stage", "source", "--json"], ["inspect", "a.aplg", "--json", "--json"]].map((argv) => ({ argv })))("rejects incorrect inspect arguments %j", async ({ argv }) => {
    const out = output(); expect(await runCli(argv, out.io, { cwd: "." })).toBe(1);
    expect(JSON.parse(out.stdout).diagnostics[0].code).toBe("E_CLI_ARGUMENTS");
  });
  test("inspect I/O failures exit 2 without exposing native errors", async () => {
    await withProject({}, async (root) => {
      await writeZipFixture(join(root, "io.aplg"), validArchiveEntries());
      const open = vi.spyOn(fs, "open").mockRejectedValue(Object.assign(new Error(`EACCES private ${root}`), { code: "EACCES" }));
      try {
        const out = output(); expect(await runCli(["inspect", "io.aplg", "--json"], out.io, { cwd: root })).toBe(2);
        expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, signature: "not-verified", diagnostics: [expect.objectContaining({ code: "E_IO" })] });
        expect(out.stdout + out.stderr).not.toContain(root);
      } finally { open.mockRestore(); }
    });
  });
});
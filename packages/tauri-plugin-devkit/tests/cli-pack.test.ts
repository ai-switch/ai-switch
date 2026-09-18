import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { runCli } from "../src/cli/run.js";
import { createBuiltProject } from "./support/built-project.js";

function output() {
  let stdout = ""; let stderr = "";
  return { io: { stdout(text: string) { stdout += text; }, stderr(text: string) { stderr += text; } }, get stdout() { return stdout; }, get stderr() { return stderr; } };
}
const finalName = "io.github.example.notes-0.1.0.aplg";
let project: Awaited<ReturnType<typeof createBuiltProject>>;
beforeAll(async () => { project = await createBuiltProject(); }, 120000);
afterAll(async () => { await project?.dispose(); });
beforeEach(async () => { await project.reset(); });

describe("aplg pack CLI", () => {
  test("packs an explicit project with one path-safe JSON result", async () => {
    const out = output();
    const code = await runCli(["pack", basename(project.root), "--out-dir", "cli-out", "--json"], out.io, { cwd: dirname(project.root) });
    expect(code).toBe(0);
    const result = JSON.parse(out.stdout);
    expect(result).toMatchObject({
      valid: true,
      path: finalName,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      size: expect.any(Number),
      manifest: { id: "io.github.example.notes", version: "0.1.0" },
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const bytes = await fs.readFile(join(project.root, "cli-out", finalName));
    expect(result.size).toBe(bytes.length);
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(out.stdout.trim().split("\n")).toHaveLength(1);
    expect(out.stdout + out.stderr).not.toContain(project.root);
    expect(out.stderr).toBe("");
  });

  test("human output is concise and does not expose the absolute output directory", async () => {
    const out = output();
    expect(await runCli(["pack", "--out-dir=cli-human"], out.io, { cwd: project.root })).toBe(0);
    expect(out.stdout).toContain(finalName);
    expect(out.stdout).toMatch(/packed/i);
    expect(out.stdout).not.toContain(project.root);
    expect(out.stderr).toBe("");
  });

  test("missing dist exits 1 without invoking a build or creating output", async () => {
    await fs.rm(join(project.root, "dist"), { recursive: true });
    const out = output();
    expect(await runCli(["pack", "--json"], out.io, { cwd: project.root })).toBe(1);
    expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: expect.stringMatching(/^E_BUILD_/) })]) });
    await expect(fs.access(join(project.root, ".aplg-output"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["pack", "--out-dir", "a", "--out-dir", "b", "--json"],
    ["pack", "--out-dir", "--json"],
    ["pack", "--stage", "dist", "--json"],
    ["pack", "a", "b", "--json"],
    ["pack", "--json", "--json"],
  ].map((argv) => ({ argv })))("rejects invalid pack arguments before opening project files: %j", async ({ argv }) => {
    const out = output(); const open = vi.spyOn(fs, "open").mockRejectedValue(new Error("must not open"));
    try {
      expect(await runCli(argv, out.io, { cwd: project.root })).toBe(1);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_CLI_ARGUMENTS" })] });
      expect(open).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
  });

  test("publication I/O failures exit 2, clean staging and hide native error details", async () => {
    const link = vi.spyOn(fs, "link").mockRejectedValue(Object.assign(new Error(`EPERM ${project.root} PRIVATE_SECRET`), { code: "EPERM" }));
    try {
      const out = output();
      expect(await runCli(["pack", "--out-dir", "cli-io", "--json"], out.io, { cwd: project.root })).toBe(2);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_OUTPUT_PUBLISH" })] });
      expect(out.stdout + out.stderr).not.toContain(project.root);
      expect(out.stdout + out.stderr).not.toContain("PRIVATE_SECRET");
      expect(await fs.readdir(join(project.root, "cli-io"))).toEqual([]);
    } finally { link.mockRestore(); }
  });
});

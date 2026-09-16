import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { initProject } from "../src/index.js";
import { runCli } from "../src/cli/run.js";
import { validateProject } from "../src/index.js";
import { validProjectFiles, withProject } from "./support/project.js";

function output() {
  let stdout = ""; let stderr = "";
  return { io: { stdout(text: string) { stdout += text; }, stderr(text: string) { stderr += text; } }, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

const expectedFiles = [
  ".github/workflows/ci.yml",
  ".gitignore",
  "LICENSE",
  "README.md",
  "aplg.json",
  "index.html",
  "package.json",
  "src/example.js",
  "src/main.ts",
  "src/styles.css",
  "tests/example.test.mjs",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
];

async function filesUnder(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string, prefix = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(directory, entry.name), path);
      else result.push(path);
    }
  }
  await visit(root);
  return result.sort();
}

describe("initProject", () => {
  test("refuses a nonempty directory without changing user files", async () => {
    await withProject({ "target/keep.txt": "unchanged" }, async (root) => {
      await expect(initProject(join(root, "target"), { id: "io.github.example.demo", name: "Demo" }))
        .rejects.toMatchObject({ code: "E_TARGET_NOT_EMPTY" });
      expect(await fs.readFile(join(root, "target/keep.txt"), "utf8")).toBe("unchanged");
      expect(await filesUnder(join(root, "target"))).toEqual(["keep.txt"]);
    });
  });

  test("creates the complete private template without a lockfile, node_modules or git metadata", async () => {
    await withProject({}, async (root) => {
      const target = join(root, "generated");
      const result = await initProject(target, { id: "io.github.example.demo", name: "Demo" });
      expect(result.directory).toBe(target);
      expect(result.files).toEqual(expectedFiles);
      expect(await filesUnder(target)).toEqual(expectedFiles);
      await expect(fs.access(join(target, "pnpm-lock.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(join(target, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(join(target, ".git"))).rejects.toMatchObject({ code: "ENOENT" });

      const packageJson = JSON.parse(await fs.readFile(join(target, "package.json"), "utf8"));
      expect(packageJson).toMatchObject({
        name: "aplg-plugin-io-github-example-demo",
        private: true,
        version: "0.1.0",
        dependencies: { "@ai-switch/tauri-plugin-runtime": "0.1.0" },
        devDependencies: {
          "@ai-switch/tauri-plugin-devkit": "0.1.0",
          "@types/node": "22.19.15",
          typescript: "5.9.3",
          vite: "8.3.0",
        },
      });
      expect(packageJson.scripts).toMatchObject({
        "dev:vite": "vite",
        typecheck: "tsc --noEmit -p tsconfig.json",
        "typecheck:node": "tsc --noEmit -p tsconfig.node.json",
        "test:node": "node --test tests/*.test.mjs",
        build: "pnpm typecheck && pnpm typecheck:node && vite build",
        "plugin:validate": "aplg validate --stage dist",
        "plugin:pack": "aplg pack",
      });

      const manifest = JSON.parse(await fs.readFile(join(target, "aplg.json"), "utf8"));
      expect(manifest).toMatchObject({
        manifestVersion: 1,
        id: "io.github.example.demo",
        name: "Demo",
        version: "0.1.0",
        entry: "dist/index.html",
        permissions: { filesystem: [], network: [], native: false },
      });
      expect((await validateProject(target)).valid).toBe(false);
      expect((await validateProject(target)).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "E_REQUIRED_FILE", path: "pnpm-lock.yaml" })]));

      const readme = await fs.readFile(join(target, "README.md"), "utf8");
      expect(readme).toContain("ai-switch/plugin-store");
      expect(readme).toContain("pnpm install");
      expect(readme).toContain("pnpm plugin:validate");
      expect(await fs.readFile(join(target, ".gitignore"), "utf8")).toContain(".aplg-output");
      const unit = spawnSync(process.execPath, ["--test", "tests/example.test.mjs"], { cwd: target, encoding: "utf8", windowsHide: true });
      expect(unit.status, unit.stdout + unit.stderr).toBe(0);
    });
  });

  test("escapes untrusted display names for HTML and JSON contexts", async () => {
    await withProject({}, async (root) => {
      const name = '</script><img src=x onerror="alert(1)"> & "demo"';
      const target = join(root, "escaped");
      await initProject(target, { id: "io.github.example.demo", name });
      const html = await fs.readFile(join(target, "index.html"), "utf8");
      const main = await fs.readFile(join(target, "src/main.ts"), "utf8");
      const manifest = JSON.parse(await fs.readFile(join(target, "aplg.json"), "utf8"));
      expect(html).toContain("&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;demo&quot;");
      expect(html).not.toContain("<img src=x");
      expect(main).toContain(JSON.stringify(name));
      expect(manifest.name).toBe(name);
    });
  });

  test.each([
    [{ id: "Demo.Plugin", name: "Demo" }, "E_INVALID_ID"],
    [{ id: "../escape", name: "Demo" }, "E_INVALID_ID"],
    [{ id: "io.github.demo", name: "" }, "E_INVALID_NAME"],
    [{ id: "io.github.demo", name: "line\nname" }, "E_INVALID_NAME"],
    [{ id: "io.github.demo", name: "Demo" , template: "react" }, "E_TEMPLATE_UNSUPPORTED"],
  ] as const)("rejects unsafe init options before writing files: %j", async (options, code) => {
    await withProject({}, async (root) => {
      const target = join(root, "invalid");
      await expect(initProject(target, options as never)).rejects.toMatchObject({ code });
      await expect(fs.access(target)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  test("rejects symlink targets and never writes through them", async () => {
    await withProject({}, async (root) => {
      const outside = join(root, "outside"); const link = join(root, "linked");
      await fs.mkdir(outside); await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
      await expect(initProject(link, { id: "io.github.example.demo", name: "Demo" })).rejects.toMatchObject({ code: "E_PATH_SYMLINK" });
      expect(await fs.readdir(outside)).toEqual([]);
    });
  });

  test("concurrent initialization has one winner and does not delete the winner", async () => {
    await withProject({}, async (root) => {
      const target = join(root, "race");
      const settled = await Promise.allSettled([
        initProject(target, { id: "io.github.example.one", name: "One" }),
        initProject(target, { id: "io.github.example.two", name: "Two" }),
      ]);
      expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      expect(settled.filter((item) => item.status === "rejected")).toHaveLength(1);
      expect(await fs.readFile(join(target, "aplg.json"), "utf8")).toMatch(/io\.github\.example\.(one|two)/);
      expect(await filesUnder(target)).toEqual(expectedFiles);
    });
  });

  test("cleans only files created by a failed initialization", async () => {
    await withProject({}, async (root) => {
      const target = join(root, "failed");
      const originalOpen = fs.open.bind(fs);
      const open = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]).endsWith("README.md")) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        return originalOpen(...args);
      });
      try {
        await expect(initProject(target, { id: "io.github.example.demo", name: "Demo" })).rejects.toMatchObject({ code: "E_IO" });
        expect(await fs.readdir(target)).toEqual([]);
      } finally { open.mockRestore(); }
    });
  });

  test("writes a read-only contribution CI without release credentials or unsafe triggers", async () => {
    await withProject({}, async (root) => {
      const target = join(root, "ci");
      await initProject(target, { id: "io.github.example.demo", name: "Demo" });
      const ci = await fs.readFile(join(target, ".github/workflows/ci.yml"), "utf8");
      expect(ci).toMatch(/uses:\s+actions\/checkout@[0-9a-f]{40}/);
      expect(ci).toMatch(/uses:\s+pnpm\/action-setup@[0-9a-f]{40}/);
      expect(ci).toMatch(/uses:\s+actions\/setup-node@[0-9a-f]{40}/);
      expect(ci).not.toMatch(/pull_request_target|secrets\.|contents:\s*write|gh\s+release|npm publish/i);
      expect(ci).toContain("pnpm test:node");
      expect(ci).toContain("pnpm plugin:validate");
    });
  });
});

describe("aplg init CLI", () => {
  test("creates a project and returns one safe JSON object", async () => {
    await withProject({}, async (root) => {
      const out = output();
      expect(await runCli(["init", "generated", "--id", "io.github.example.demo", "--name", "Demo", "--json"], out.io, { cwd: root })).toBe(0);
      expect(JSON.parse(out.stdout)).toMatchObject({ valid: true, directory: "generated", files: expectedFiles });
      expect(out.stdout).not.toContain(root);
      expect(out.stderr).toBe("");
    });
  });

  test("human init output stays concise and invalid arguments do not touch files", async () => {
    await withProject({}, async (root) => {
      const out = output();
      expect(await runCli(["init", "human", "--id", "io.github.example.demo", "--name", "Demo"], out.io, { cwd: root })).toBe(0);
      expect(out.stdout).toMatch(/initialized|created/i);
      expect(out.stdout).toContain("human");
      expect(out.stdout).not.toContain(root);
      expect(out.stderr).toBe("");

      const invalid = output();
      expect(await runCli(["init", "invalid", "--id", "io.github.example.demo", "--json"], invalid.io, { cwd: root })).toBe(1);
      expect(JSON.parse(invalid.stdout)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "E_CLI_ARGUMENTS" })] });
      await expect(fs.access(join(root, "invalid"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});

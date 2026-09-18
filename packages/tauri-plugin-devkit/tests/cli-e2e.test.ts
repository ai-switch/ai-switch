import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { withInstalledTarballs } from "./support/tarball-consumer.js";

describe("packed devkit CLI", () => {
  test("is consumable from a real external tarball install without workspace fallback", async () => {
    await withInstalledTarballs(async (consumer) => {
      const version = await consumer.runCli(["--version"]);
      expect(version).toMatchObject({ code: 0, stderr: "" });
      expect(version.stdout.trim()).toBe("0.1.1");

      const unknown = await consumer.runCli(["not-a-command", "--json"]);
      expect(unknown.code).toBe(1);
      expect(() => JSON.parse(unknown.stdout)).not.toThrow();

      const initialized = await consumer.runCli(["init", "plugin", "--id", "io.github.example.external", "--name", "External", "--json"]);
      expect(initialized).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(initialized.stdout)).toMatchObject({ valid: true, directory: "plugin" });

      await consumer.write("plugin/package.json", JSON.stringify({
        name: "external-plugin",
        version: "0.1.0",
        private: true,
        type: "module",
        dependencies: { "@ai-switch/tauri-plugin-runtime": `file:${consumer.runtimeTarball}` },
        devDependencies: { "@ai-switch/tauri-plugin-devkit": `file:${consumer.devkitTarball}`, typescript: "5.9.3", vite: "8.3.0" },
        scripts: { build: "vite build" },
      }, null, 2));
      await consumer.write("plugin/.npmrc", "ignore-scripts=true\nworkspaces=false\naudit=false\nfund=false\n");
      await consumer.write("plugin/pnpm-lock.yaml", "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n");
      const installed = await consumer.run([consumer.npm, "install", "--ignore-scripts", "--workspaces=false", "--no-audit", "--no-fund"], { cwd: join(consumer.root, "plugin"), timeout: 180_000 });
      expect(installed, installed.stderr).toMatchObject({ code: 0 });

      const vite = join(consumer.root, "node_modules/vite/bin/vite.js");
      const built = await consumer.run([vite, "build"], { cwd: join(consumer.root, "plugin"), timeout: 180_000 });
      expect(built.code).toBe(0);

      const validated = await consumer.runCli(["validate", "plugin", "--stage", "dist", "--json"]);
      expect(validated).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(validated.stdout)).toMatchObject({ valid: true, manifest: { id: "io.github.example.external" } });

      const packed = await consumer.runCli(["pack", "plugin", "--out-dir", "release", "--json"]);
      expect(packed).toMatchObject({ code: 0, stderr: "" });
      const packResult = JSON.parse(packed.stdout);
      expect(packResult.path).toMatch(/^io\.github\.example\.external-0\.1\.0\.aplg$/);
      const archive = join(consumer.root, "plugin/release", packResult.path);
      expect((await readFile(archive)).subarray(0, 2).toString("latin1")).toBe("PK");

      const inspected = await consumer.runCli(["inspect", archive, "--json"]);
      expect(inspected).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(inspected.stdout)).toMatchObject({ valid: true, signature: "not-verified", manifest: { id: "io.github.example.external" } });
    });
  }, 600_000);
});
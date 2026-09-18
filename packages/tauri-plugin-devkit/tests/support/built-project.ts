import { rm } from "node:fs/promises";
import { aplgVite } from "../../src/vite/index.js";
import { createBuildProject } from "./build-project.js";
import { validProjectFiles } from "./project.js";

const base = validProjectFiles();
export async function createBuiltProject() {
  const project = await createBuildProject(base);
  async function reset(extra: Record<string, string | Uint8Array> = {}) {
    for (const name of ["dist", ".aplg-output", "out-a", "out-b", "out", "race-out", "invalid-out", "existing-out", "concurrent-out", "identity-out", "cli-out", "cli-human", "cli-io", "inside-link", "external-target", "public", "icon.svg", "icon.png", "source-icon.svg", "THIRD_PARTY_NOTICES.md", ".env"]) {
      await rm(`${project.root}/${name}`, { recursive: true, force: true });
    }
    for (const name of ["aplg.json", "README.md", "LICENSE", "index.html", "src/main.ts", "pnpm-lock.yaml"]) await project.write(name, base[name]);
    for (const [name, data] of Object.entries(extra)) await project.write(name, data);
    await project.vite.build({ root: project.root, configFile: false, logLevel: "silent", plugins: aplgVite({ preview: false }) });
  }
  await reset();
  return { ...project, reset };
}
export async function withBuiltProject(run: (root: string) => Promise<void>): Promise<void> {
  const project = await createBuiltProject();
  try { await run(project.root); } finally { await project.dispose(); }
}

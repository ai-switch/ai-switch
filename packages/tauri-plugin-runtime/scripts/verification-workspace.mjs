import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const inside = (parent, child) => { const path = relative(parent, child); return !path || !isAbsolute(path) && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\"); };

export async function createVerificationWorkspace(repository) {
  const repo = await realpath(repository instanceof URL ? fileURLToPath(repository) : repository);
  const parent = await realpath(tmpdir());
  if (inside(repo, parent)) throw new Error("os.tmpdir must be outside the source repository.");
  const root = await mkdtemp(join(parent, "aplg-tarball-"));
  const identity = await lstat(root);
  const token = randomUUID();
  const marker = join(root, ".aplg-verification-owner");
  // root came directly from mkdtemp. Cleanup still verifies its identity and token.
  try { await writeFile(marker, token, { flag: "wx" }); }
  catch (error) { if (dirname(root) === parent) await rm(root, { recursive: true, force: true }); throw error; }
  let cleaned = false;
  return {
    root,
    async cleanup() {
      if (cleaned) return;
      const actual = await realpath(root);
      const current = await lstat(root);
      if (actual !== resolve(root) || dirname(actual) !== parent || !actual.startsWith(join(parent, "aplg-tarball-")) || current.isSymbolicLink() || !current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino || await readFile(marker, "utf8") !== token) throw new Error("Refusing to clean an unowned verification directory.");
      await rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      cleaned = true;
    },
  };
}

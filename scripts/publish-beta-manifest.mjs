import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value);
  if (!match) throw new Error("Invalid manifest version");
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && /^0\d/.test(part))) {
    throw new Error("Invalid numeric prerelease version");
  }
  return { core: match.slice(1, 4).map((part) => BigInt(part)), prerelease };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function validateManifest(contents, tag) {
  const manifest = JSON.parse(contents);
  if (manifest.version !== tag.slice(1)) throw new Error("Manifest version does not match release tag");
  parseVersion(manifest.version);
  if (!manifest.platforms || !Object.keys(manifest.platforms).length) {
    throw new Error("Manifest has no signed platforms");
  }
  for (const platform of Object.values(manifest.platforms)) {
    if (typeof platform?.signature !== "string" || !platform.signature.trim()) {
      throw new Error("Manifest platform is missing its signature");
    }
    const url = new URL(platform.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Manifest platform has an unsafe download URL");
    }
  }
  return manifest;
}

export async function publishBetaManifest({ manifest, tag, remote, token = process.env.GH_TOKEN }) {
  if (!/^v\d+\.\d+\.\d+(?:-(?:rc|beta|alpha)(?:\.\d+)?)?$/.test(tag ?? "")) {
    throw new Error("Unsupported release tag");
  }
  if (!tag.includes("-")) return { published: false, reason: "stable" };
  const contents = await readFile(path.resolve(manifest), "utf8");
  const incoming = validateManifest(contents, tag);
  if (!remote) {
    const repository = process.env.GITHUB_REPOSITORY;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Missing GitHub repository");
    remote = `https://github.com/${repository}.git`;
  }

  const workspace = await mkdtemp(path.join(tmpdir(), "ai-switch-beta-publish-"));
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token && remote.startsWith("https://github.com/")) {
    // Keep credentials out of the remote URL, argv and diagnostics.
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  const git = (...args) => {
    try {
      return execFileSync("git", args, {
        cwd: workspace,
        env,
        encoding: "utf8",
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (cause) {
      // Raw Git output may contain credentials. Only surface the failed action.
      throw Object.assign(new Error(`Git ${args[0]} failed`), { status: cause.status });
    }
  };
  try {
    git("init", "--quiet");
    git("remote", "add", "origin", remote);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let branchExists = true;
      try {
        git("ls-remote", "--exit-code", "--heads", "origin", "refs/heads/beta");
      } catch (error) {
        if (error.status !== 2) throw error;
        branchExists = false;
      }
      if (branchExists) {
        git("fetch", "--quiet", "--depth=1", "origin", "beta");
        git("checkout", "--quiet", "-B", "beta", "FETCH_HEAD");
        if (git("ls-tree", "--name-only", "HEAD") !== "beta.json") {
          throw new Error("Beta branch is not a dedicated manifest branch");
        }
        const previous = JSON.parse(git("show", "HEAD:beta.json"));
        if (compareVersions(previous.version, incoming.version) > 0) {
          return { published: false, reason: "older" };
        }
      } else if (attempt === 0) {
        git("checkout", "--quiet", "--orphan", "beta");
      }
      await writeFile(path.join(workspace, "beta.json"), contents);
      git("add", "beta.json");
      if (!git("diff", "--cached", "--name-only")) {
        if (branchExists) return { published: false, reason: "unchanged" };
        // A failed first push already committed the manifest locally. Reuse
        // that commit when retrying; recreating --orphan beta would fail.
      } else {
        git("-c", "user.email=github-actions[bot]@users.noreply.github.com", "-c", "user.name=github-actions[bot]", "commit", "--quiet", "-m", `chore(beta): update the beta manifest for ${tag}`);
      }
      try {
        git("push", "--quiet", "origin", "HEAD:refs/heads/beta");
        return { published: true };
      } catch (error) {
        if (attempt === 2) throw error;
        // Another release may have finished first. Fetch/recompare and use only
        // a fast-forward push: never force an older RC over a newer one.
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--manifest", "--tag", "--remote"].includes(key) || !value) throw new Error("Invalid publication arguments");
    options[key.slice(2)] = value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => publishBetaManifest(parseArgs(process.argv.slice(2))))
    .then((result) => console.log(result.published ? "Published the beta manifest." : `Beta manifest unchanged (${result.reason}).`))
    .catch((error) => {
      // The Release has already been published. Leave it green and make a failed
      // beta handoff visible; fixing the cause and rerunning the tag retries it.
      console.warn(`::warning::Could not publish the beta manifest: ${error.message}`);
    });
}

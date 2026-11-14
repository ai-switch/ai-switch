import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { publishBetaManifest } from "./publish-beta-manifest.mjs";

const script = fileURLToPath(new URL("./publish-beta-manifest.mjs", import.meta.url));

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "ai-switch-beta-"));
  const remote = path.join(root, "remote.git");
  git(root, "init", "--bare", "--quiet", remote);
  const manifest = path.join(root, "latest.json");
  return { root, remote, manifest };
}

async function writeManifest(file, version) {
  const contents = `${JSON.stringify({
    version,
    notes: "Release notes\n\n中文\n\n-----------------------------\n\nEnglish",
    pub_date: "2026-11-15T00:00:00Z",
    platforms: {
      "windows-x86_64": {
        signature: "signed-updater",
        url: `https://github.com/ai-switch/ai-switch/releases/download/v${version}/setup.exe`,
      },
    },
  }, null, 2)}\n`;
  await writeFile(file, contents);
  return contents;
}

function branchManifest(remote) {
  return JSON.parse(git(remote, "show", "refs/heads/beta:beta.json"));
}

test("publishes a byte-identical prerelease manifest on a new single-file beta branch", async () => {
  const { root, remote, manifest } = await fixture();
  try {
    const contents = await writeManifest(manifest, "0.19.0-rc.1");
    const result = await publishBetaManifest({ manifest, tag: "v0.19.0-rc.1", remote });
    assert.equal(result.published, true);
    assert.equal(git(remote, "ls-tree", "--name-only", "beta"), "beta.json");
    assert.equal(git(remote, "show", "beta:beta.json"), contents.trim());
    assert.equal(branchManifest(remote).version, "0.19.0-rc.1");
    assert.equal(git(remote, "for-each-ref", "--format=%(refname)", "refs/heads"), "refs/heads/beta");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("updates beta by fast-forward and does not create a commit for an identical retry", async () => {
  const { root, remote, manifest } = await fixture();
  try {
    await writeManifest(manifest, "0.19.0-rc.1");
    await publishBetaManifest({ manifest, tag: "v0.19.0-rc.1", remote });
    const initial = git(remote, "rev-parse", "beta");
    const repeat = await publishBetaManifest({ manifest, tag: "v0.19.0-rc.1", remote });
    assert.equal(repeat.published, false);
    assert.equal(git(remote, "rev-parse", "beta"), initial);
    await writeManifest(manifest, "0.19.0-rc.2");
    await publishBetaManifest({ manifest, tag: "v0.19.0-rc.2", remote });
    assert.equal(git(remote, "rev-parse", "beta^"), initial);
    assert.equal(branchManifest(remote).version, "0.19.0-rc.2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rerunning an older prerelease cannot move the beta feed backwards", async () => {
  const { root, remote, manifest } = await fixture();
  try {
    await writeManifest(manifest, "0.19.0-rc.10");
    await publishBetaManifest({ manifest, tag: "v0.19.0-rc.10", remote });
    const latest = git(remote, "rev-parse", "beta");
    await writeManifest(manifest, "0.19.0-rc.2");
    const result = await publishBetaManifest({ manifest, tag: "v0.19.0-rc.2", remote });
    assert.equal(result.published, false);
    assert.equal(git(remote, "rev-parse", "beta"), latest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stable release never writes the beta branch", async () => {
  const { root, remote, manifest } = await fixture();
  try {
    await writeManifest(manifest, "0.19.0");
    const result = await publishBetaManifest({ manifest, tag: "v0.19.0", remote });
    assert.equal(result.published, false);
    assert.equal(git(remote, "for-each-ref", "--format=%(refname)"), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mismatching versions and unsigned platform entries never reach Git", async () => {
  const { root, remote, manifest } = await fixture();
  try {
    await writeManifest(manifest, "0.19.0-rc.1");
    await assert.rejects(
      publishBetaManifest({ manifest, tag: "v0.19.0-rc.2", remote }),
      /version.*tag/i,
    );
    const contents = JSON.parse(await readFile(manifest, "utf8"));
    delete contents.platforms["windows-x86_64"].signature;
    await writeFile(manifest, JSON.stringify(contents));
    await assert.rejects(
      publishBetaManifest({ manifest, tag: "v0.19.0-rc.1", remote }),
      /signed.*platform|signature/i,
    );
    assert.equal(git(remote, "for-each-ref", "--format=%(refname)"), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the caller's main checkout, HEAD and index are untouched", async () => {
  const { root, remote, manifest } = await fixture();
  try {
    git(root, "init", "--quiet", "--initial-branch=main");
    await writeFile(path.join(root, "keep.txt"), "caller file\n");
    git(root, "add", "keep.txt");
    git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "caller baseline");
    const head = git(root, "rev-parse", "HEAD");
    const index = git(root, "ls-files", "--stage");
    await writeManifest(manifest, "0.19.0-beta.1");
    await publishBetaManifest({ manifest, tag: "v0.19.0-beta.1", remote });
    assert.equal(git(root, "branch", "--show-current"), "main");
    assert.equal(git(root, "rev-parse", "HEAD"), head);
    assert.equal(git(root, "ls-files", "--stage"), index);
    assert.equal(await readFile(path.join(root, "keep.txt"), "utf8"), "caller file\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retries a rejected first push without recreating the existing local beta branch", async () => {
  const { root, remote, manifest } = await fixture();
  try {
    const hook = path.join(remote, "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\nif [ ! -f first-push-rejected ]; then\n  touch first-push-rejected\n  exit 1\nfi\nexit 0\n", { mode: 0o755 });
    await writeManifest(manifest, "0.19.0-rc.1");
    const result = await publishBetaManifest({ manifest, tag: "v0.19.0-rc.1", remote });
    assert.equal(result.published, true);
    assert.equal(branchManifest(remote).version, "0.19.0-rc.1");
    assert.equal(git(remote, "rev-list", "--count", "beta"), "1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication failures emit a warning without failing an already-published release", async () => {
  const { root, manifest } = await fixture();
  try {
    await writeManifest(manifest, "0.19.0-alpha.1");
    const remote = path.join(root, "missing.git");
    await assert.rejects(publishBetaManifest({ manifest, tag: "v0.19.0-alpha.1", remote }));
    const result = spawnSync(process.execPath, [script, "--manifest", manifest, "--tag", "v0.19.0-alpha.1", "--remote", remote], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /::warning::.*beta manifest/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

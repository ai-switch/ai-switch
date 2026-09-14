import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const read = async (path) => (await readFile(path, "utf8")).replaceAll("\r\n", "\n");

test("docker image uses verified release archives instead of compiling source", async () => {
  const dockerfile = await read("Dockerfile");

  assert.equal(/FROM rust:/i.test(dockerfile), false);
  assert.equal(/cargo build/i.test(dockerfile), false);
  assert.equal(/pnpm (build|install)/i.test(dockerfile), false);
  assert.equal(/go build/i.test(dockerfile), false);

  assert.match(dockerfile, /TARGETARCH/);
  assert.match(dockerfile, /releases\/latest/);
  assert.match(dockerfile, /\.assets\[\]/);
  assert.match(dockerfile, /sha256sum/);
  assert.match(dockerfile, /ai-switch-server_\$\{VERSION\}_linux-\$\{ARCH\}\.zip/);
  assert.match(dockerfile, /ai-switch-server/);
  assert.match(dockerfile, /ai-switch-tsnet/);
  assert.match(dockerfile, /web\/index\.html/);
  assert.match(dockerfile, /useradd .*ai-switch/);
  assert.match(dockerfile, /install -d .*\/home\/ai-switch\/\.ai-switch/);
});

test("docker compose runs the published multi-arch image", async () => {
  const compose = await read("deploy/docker-compose.yml");

  assert.match(compose, /image: \$\{AI_SWITCH_DOCKER_IMAGE:-[^}]+\}/);
  assert.equal(/build:/i.test(compose), false);
});

test("release workflow publishes docker hub images after the github release", async () => {
  const workflow = await read(".github/workflows/release.yml");

  const dockerJob = workflow.slice(workflow.indexOf("  publish-image:"));
  assert.notEqual(dockerJob, "");
  assert.match(dockerJob, /needs:\s*\n\s*- publish/);
  assert.match(dockerJob, /DOCKERHUB_USERNAME/);
  assert.match(dockerJob, /DOCKERHUB_TOKEN/);
  assert.match(dockerJob, /id: dockerhub_credentials/);
  assert.match(dockerJob, /configured=true/);
  assert.match(dockerJob, /if: steps\.dockerhub_credentials\.outputs\.configured == 'true'/);

  assert.match(dockerJob, /docker\/login-action@/);
  assert.match(dockerJob, /docker\/build-push-action@/);
  assert.match(dockerJob, /linux\/amd64,linux\/arm64/);
  assert.match(dockerJob, /AI_SWITCH_VERSION=\$\{\{ github\.ref_name \}\}/);
  assert.match(dockerJob, /AI_SWITCH_REPOSITORY=\$\{\{ github\.repository \}\}/);
  assert.match(dockerJob, /type=semver,pattern=\{\{version\}\}/);
});

test("standalone server fails fast when release environment configuration is invalid", async () => {
  const server = await read("src-tauri/src/server.rs");

  assert.match(
    server,
    /apply_env_config\(&pool\)\s*\.await\s*\.map_err\(\|error\| error\.to_string\(\)\)\?/,
  );
  assert.equal(/SaaS environment configuration failed/.test(server), false);
});

for (const [name, username, token, configured] of [
  ["neither secret", "", "", false],
  ["only a username", "test-user", "", false],
  ["only a token", "", "test-token", false],
  ["both secrets", "test-user", "test-token", true],
]) {
  test(`Docker credentials check handles ${name} without leaking secrets`, async (t) => {
    const workflow = await read(".github/workflows/release.yml");
    const credentialStep = workflow.split("id: dockerhub_credentials")[1]?.split(/\n      - name:/)[0];
    assert.ok(credentialStep, "the workflow must check credentials before logging in");
    const script = credentialStep.split("        run: |\n")[1]?.replace(/^          /gm, "");
    assert.ok(script, "credentials step must have an executable check");
    const directory = await mkdtemp(path.join(tmpdir(), "ai-switch-docker-credentials-"));
    t.after(async () => {
      const resolved = path.resolve(directory);
      const relative = path.relative(path.resolve(tmpdir()), resolved);
      assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "cleanup must stay in the test temp directory");
      assert.ok(path.basename(resolved).startsWith("ai-switch-docker-credentials-"));
      await rm(resolved, { recursive: true, force: true });
    });
    const outputFile = path.join(directory, "outputs");
    const bash = process.platform === "win32" && existsSync("C:/Program Files/Git/bin/bash.exe")
      ? "C:/Program Files/Git/bin/bash.exe" : "bash";
    const result = spawnSync(bash, ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        DOCKERHUB_USERNAME: username,
        DOCKERHUB_TOKEN: token,
        GITHUB_OUTPUT: outputFile.replaceAll("\\", "/"),
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await read(outputFile)).trim(), `configured=${configured}`);
    assert.doesNotMatch(result.stdout + result.stderr, /test-user|test-token/);
    if (!configured) {
      assert.match(result.stdout, /::notice::/);
      assert.match(result.stdout, /DOCKERHUB_USERNAME.*DOCKERHUB_TOKEN/);
    }
  });
}

test("Docker image is still built when publication credentials are unavailable", async () => {
  const workflow = await read(".github/workflows/release.yml");
  const dockerJob = workflow.slice(workflow.indexOf("  publish-image:"));
  for (const action of ["docker/setup-qemu-action", "docker/setup-buildx-action", "docker/metadata-action", "docker/build-push-action"]) {
    const step = dockerJob.split(/\n      - name:/).find((part) => part.includes(action));
    assert.ok(step, `${action} is required`);
    assert.doesNotMatch(step, /^        if:/m, `${action} must run for build-only releases too`);
  }
  const buildStep = dockerJob.split(/\n      - name:/).find((part) => part.includes("docker/build-push-action"));
  assert.match(buildStep, /push: \$\{\{ steps\.dockerhub_credentials\.outputs\.configured == 'true' \}\}/);
});

test("Docker restores executable modes stripped by the Release ZIP before validating binaries", async () => {
  const dockerfile = await read("Dockerfile");
  const downloadStage = dockerfile.split("FROM debian:bookworm-slim")[1];
  const extraction = downloadStage.indexOf('unzip -q "/tmp/${ARCHIVE}" -d /package');
  const chmod = downloadStage.indexOf("chmod 0755 /package/ai-switch-server /package/ai-switch-tsnet", extraction);
  const executableCheck = downloadStage.indexOf("test -x /package/ai-switch-server", extraction);
  assert.ok(extraction !== -1, "the release must be extracted first");
  assert.ok(chmod > extraction && chmod < executableCheck, "Release ZIPs store both binaries as 0644; restore modes before test -x");
  assert.ok(downloadStage.indexOf("sha256sum -c -") < extraction, "archive integrity must be checked before extraction");
});

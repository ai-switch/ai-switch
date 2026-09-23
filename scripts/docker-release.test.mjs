import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const read = async (path) => (await readFile(path, "utf8")).replaceAll("\r\n", "\n");

const DOCKER_WORKFLOW = ".github/workflows/docker.yml";
const RELEASE_WORKFLOW = ".github/workflows/release.yml";

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

test("docker workflow publishes docker hub images for an already published release", async () => {
  const workflow = await read(DOCKER_WORKFLOW);

  const dockerJob = workflow.slice(workflow.indexOf("  publish-image:"));
  assert.notEqual(dockerJob, "");
  assert.match(dockerJob, /DOCKERHUB_USERNAME/);
  assert.match(dockerJob, /DOCKERHUB_TOKEN/);
  assert.match(dockerJob, /id: dockerhub_credentials/);
  assert.match(dockerJob, /configured=true/);
  assert.match(dockerJob, /if: steps\.dockerhub_credentials\.outputs\.configured == 'true'/);

  assert.match(dockerJob, /docker\/login-action@/);
  assert.match(dockerJob, /docker\/build-push-action@/);
  assert.match(dockerJob, /linux\/amd64,linux\/arm64/);
});

test("docker workflow tags the image from the resolved release tag", async () => {
  const workflow = await read(DOCKER_WORKFLOW);

  // `github.ref_name` is the default branch on a `release: published` run, so a
  // workflow that tags from it publishes `main` and `latest` and never the
  // version it was actually triggered for. Every tag must come from the tag the
  // resolve step looked up.
  assert.match(workflow, /tag="\$\(gh release view --repo "\$GITHUB_REPOSITORY" --json tagName --jq \.tagName\)"/);
  assert.match(workflow, /echo "tag=\$tag" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /type=semver,value=\$\{\{ steps\.release\.outputs\.tag \}\},pattern=\{\{version\}\}/);
  assert.match(workflow, /type=semver,value=\$\{\{ steps\.release\.outputs\.tag \}\},pattern=\{\{major\}\}\.\{\{minor\}\}/);
  assert.match(workflow, /type=raw,value=latest,enable=\$\{\{ !contains\(steps\.release\.outputs\.tag, '-'\) \}\}/);
  assert.match(workflow, /AI_SWITCH_VERSION=\$\{\{ steps\.release\.outputs\.version \}\}/);
  assert.match(workflow, /AI_SWITCH_REPOSITORY=\$\{\{ github\.repository \}\}/);

  // A tag that is not on the repository has nothing to unpack; a draft has no
  // public download URL either.
  assert.match(workflow, /gh release view "\$tag" --repo "\$GITHUB_REPOSITORY" --json isDraft --jq \.isDraft/);
});

test("docker workflow can be dispatched for a hand-picked tag", async () => {
  const workflow = await read(DOCKER_WORKFLOW);

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /INPUT_TAG: \$\{\{ inputs\.tag \}\}/);
  assert.match(workflow, /tag="\$\{INPUT_TAG:-\$EVENT_TAG\}"/);
  assert.match(workflow, /EVENT_TAG: \$\{\{ github\.event\.release\.tag_name \}\}/);
});

test("the default image repository belongs to the token's account", async () => {
  // The Docker Hub token is a personal access token, and a namespace its account
  // cannot write to answers every push with `insufficient_scope: authorization
  // failed` — after the login has already reported success, which is what made
  // the original failure look like a credentials problem.
  const workflow = await read(DOCKER_WORKFLOW);
  assert.match(workflow, /DOCKERHUB_REPOSITORY: \$\{\{ vars\.DOCKERHUB_REPOSITORY \|\| 'ijry\/ai-switch' \}\}/);

  const compose = await read("deploy/docker-compose.yml");
  assert.match(compose, /image: \$\{AI_SWITCH_DOCKER_IMAGE:-ijry\/ai-switch:latest\}/);
});

test("the docker publication cannot fail the release", async () => {
  const workflow = await read(RELEASE_WORKFLOW);

  // The registry verdict is a third-party one — a read-only token or a namespace
  // the token cannot write to rejects a perfectly good image. The release has
  // already shipped by then, so the handoff warns and a hand-run of docker.yml
  // repeats it for the same tag.
  assert.equal(
    workflow.includes("publish-image"),
    false,
    "the Docker publication lives in its own workflow so it cannot mark a release red",
  );
  assert.match(workflow, /gh workflow run docker\.yml/);
  assert.match(workflow, /if ! gh workflow run docker\.yml/);
  assert.match(workflow, /::warning::Could not dispatch docker\.yml for \$\{TAG\}/);
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
    const workflow = await read(DOCKER_WORKFLOW);
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
  const workflow = await read(DOCKER_WORKFLOW);
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

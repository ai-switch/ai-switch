import { randomBytes } from "node:crypto";
import { constants, promises as fs, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ProjectError, errorCode } from "../project/errors.js";
import { inspectPath, sameIdentity, samePath, type PathSnapshot } from "../project/files.js";
import { renderVanillaTs, type RenderedTemplateFile } from "./render.js";

export interface InitProjectOptions {
  id: string;
  name: string;
  template?: "vanilla-ts";
}
export interface InitProjectResult {
  directory: string;
  files: string[];
}
interface CreatedFile { path: string; identity: BigIntStats }
interface CreatedDirectory { path: string; identity: BigIntStats }
interface TargetClaim {
  directory: string;
  root: PathSnapshot;
  lockPath: string;
  lockIdentity: BigIntStats;
  files: CreatedFile[];
  directories: CreatedDirectory[];
}

const idPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const invalidText = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const localPathPattern = /^(?:[a-z]:(?![\\/])|[a-z][a-z0-9+.-]*:\/\/|\\\\[?.]\\)/i;
const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);

function asRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function localTarget(input: unknown): string {
  if (typeof input !== "string" || !input || invalidText.test(input) || localPathPattern.test(input)) {
    throw new ProjectError("E_INVALID_ARGUMENT", "An ordinary local target directory is required.");
  }
  return resolve(input);
}
function validateOptions(value: unknown): InitProjectOptions {
  if (!asRecord(value) || Object.keys(value).some((key) => !["id", "name", "template"].includes(key))) {
    throw new ProjectError("E_INVALID_ARGUMENT", "Expected id, name and an optional vanilla-ts template.");
  }
  if (typeof value.id !== "string" || Array.from(value.id).length > 160 || !idPattern.test(value.id)) {
    throw new ProjectError("E_INVALID_ID", "The plugin ID must be a lowercase dotted or hyphenated namespace.");
  }
  if (typeof value.name !== "string" || !value.name.trim() || invalidText.test(value.name) || Array.from(value.name).length > 160) {
    throw new ProjectError("E_INVALID_NAME", "The plugin name must be a nonempty safe display string of at most 160 characters.");
  }
  if (value.template !== undefined && value.template !== "vanilla-ts") {
    throw new ProjectError("E_TEMPLATE_UNSUPPORTED", "Only the built-in vanilla-ts template is supported.");
  }
  return { id: value.id, name: value.name, ...(value.template === undefined ? {} : { template: value.template }) };
}
function failure(error: unknown, message: string, path = ""): ProjectError {
  if (error instanceof ProjectError) return error;
  return new ProjectError("E_IO", message, path, "io");
}
function isMissing(error: unknown): boolean { return ["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? ""); }
function inside(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return childRelative === "" || childRelative !== ".." && !childRelative.startsWith(`..${sep}`) && !isAbsolute(childRelative);
}
async function removeOwnedFile(file: CreatedFile | { path: string; identity: BigIntStats }): Promise<void> {
  try {
    const current = await fs.lstat(file.path, { bigint: true });
    if (!current.isSymbolicLink() && sameIdentity(current, file.identity)) await fs.unlink(file.path);
  } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
}
async function removeOwnedDirectory(directory: CreatedDirectory): Promise<void> {
  try {
    const current = await fs.lstat(directory.path, { bigint: true });
    if (current.isSymbolicLink() || !sameIdentity(current, directory.identity)) return;
    if ((await fs.readdir(directory.path)).length === 0) await fs.rmdir(directory.path);
  } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(errorCode(error) ?? "")) throw error; }
}
async function assertTargetStable(claim: TargetClaim): Promise<void> {
  const current = await inspectPath(claim.directory);
  if (!samePath(claim.root, current) || !sameIdentity(claim.root.stat, current.stat)) {
    throw new ProjectError("E_TARGET_CHANGED", "The target directory changed during initialization.");
  }
}
async function claimTarget(target: string): Promise<TargetClaim> {
  const parentPath = dirname(target);
  let parent: PathSnapshot;
  try { parent = await inspectPath(parentPath); }
  catch (error) {
    if (error instanceof ProjectError) throw error;
    if (isMissing(error)) throw new ProjectError("E_TARGET_PARENT", "The target parent directory must already exist.");
    throw failure(error, "The target parent directory could not be inspected.");
  }
  if (!parent.stat.isDirectory()) throw new ProjectError("E_TARGET_PARENT", "The target parent must be a directory.");

  let root: PathSnapshot;
  try {
    root = await inspectPath(target);
  } catch (error) {
    if (error instanceof ProjectError && error.code === "E_PATH_SYMLINK") throw error;
    if (!isMissing(error)) throw failure(error, "The target directory could not be inspected.");
    try { await fs.mkdir(target, { mode: 0o755 }); }
    catch (mkdirError) {
      if (errorCode(mkdirError) !== "EEXIST") throw failure(mkdirError, "The target directory could not be created.");
      try { root = await inspectPath(target); }
      catch (inspectError) { throw failure(inspectError, "The target directory could not be inspected."); }
    }
    if (!root!) {
      try { root = await inspectPath(target); }
      catch (inspectError) { throw failure(inspectError, "The target directory could not be inspected."); }
    }
  }
  if (!root.stat.isDirectory()) throw new ProjectError("E_TARGET_NOT_DIRECTORY", "The initialization target must be a directory.");
  if (!inside(parent.absolute, root.absolute)) throw new ProjectError("E_TARGET_PATH", "The target must remain within its ordinary parent directory.");
  let entries: string[];
  try { entries = await fs.readdir(root.absolute); }
  catch (error) { throw failure(error, "The target directory could not be read."); }
  if (entries.length) throw new ProjectError("E_TARGET_NOT_EMPTY", "The initialization target must be empty.");

  const lockPath = join(root.absolute, ".aplg-init.lock");
  let lockHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let lockIdentity: BigIntStats | undefined;
  try {
    lockHandle = await fs.open(lockPath, flags, 0o600);
    const token = randomBytes(24).toString("hex");
    await lockHandle.writeFile(token, "utf8");
    await lockHandle.sync();
    lockIdentity = await lockHandle.stat({ bigint: true });
  } catch (error) {
    if (errorCode(error) === "EEXIST") throw new ProjectError("E_TARGET_NOT_EMPTY", "The initialization target is already being initialized.");
    throw failure(error, "The initialization lock could not be acquired.");
  } finally { await lockHandle?.close(); }
  if (!lockIdentity) throw new ProjectError("E_IO", "The initialization lock could not be verified.", "", "io");
  const afterLock = await inspectPath(root.absolute);
  const entriesAfterLock = await fs.readdir(root.absolute);
  if (!samePath(root, afterLock) || !sameIdentity(root.stat, afterLock.stat) || entriesAfterLock.some((entry) => entry !== ".aplg-init.lock")) {
    await removeOwnedFile({ path: lockPath, identity: lockIdentity }).catch(() => undefined);
    throw new ProjectError("E_TARGET_CHANGED", "The target directory changed while initialization started.");
  }
  return { directory: root.absolute, root, lockPath, lockIdentity, files: [], directories: [] };
}
async function createDirectory(claim: TargetClaim, relativePath: string): Promise<void> {
  const path = join(claim.directory, ...relativePath.split("/"));
  if (!inside(claim.directory, path) || path === claim.directory) throw new ProjectError("E_TEMPLATE_PATH", "The built-in template contains an unsafe directory path.");
  try { await fs.mkdir(path, { mode: 0o755 }); }
  catch (error) {
    if (errorCode(error) === "EEXIST") throw new ProjectError("E_TARGET_CHANGED", "The target changed while the template was being written.");
    throw failure(error, "A template directory could not be created.", relativePath);
  }
  let stat: BigIntStats;
  try { stat = await fs.lstat(path, { bigint: true }); }
  catch (error) { throw failure(error, "A template directory could not be verified.", relativePath); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ProjectError("E_PATH_SYMLINK", "Template directories must be ordinary directories.", relativePath);
  claim.directories.push({ path, identity: stat });
}
async function writeTemplateFile(claim: TargetClaim, file: RenderedTemplateFile): Promise<void> {
  const path = join(claim.directory, ...file.path.split("/"));
  if (!inside(claim.directory, path) || path === claim.directory) throw new ProjectError("E_TEMPLATE_PATH", "The built-in template contains an unsafe file path.", file.path);
  const handle = await fs.open(path, flags, 0o644).catch((error: unknown) => {
    if (errorCode(error) === "EEXIST") throw new ProjectError("E_TARGET_CHANGED", "The target changed while the template was being written.", file.path);
    throw failure(error, "A template file could not be created.", file.path);
  });
  let identity: BigIntStats | undefined;
  let completed = false;
  try {
    identity = await handle.stat({ bigint: true });
    if (!identity.isFile() || identity.size !== 0n) throw new ProjectError("E_TEMPLATE_FILE", "A template file could not be created as a regular file.", file.path);
    let offset = 0;
    while (offset < file.bytes.byteLength) {
      const result = await handle.write(file.bytes, offset, file.bytes.byteLength - offset, offset);
      if (!result.bytesWritten) throw new ProjectError("E_IO", "A template file could not be written.", file.path, "io");
      offset += result.bytesWritten;
    }
    await handle.sync();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(identity, after) || after.size !== BigInt(file.bytes.byteLength)) throw new ProjectError("E_FILE_CHANGED", "A template file changed while it was written.", file.path);
    completed = true;
  } finally {
    await handle.close();
    if (completed && identity) claim.files.push({ path, identity });
    else if (identity) await removeOwnedFile({ path, identity }).catch(() => undefined);
  }
}
async function cleanupClaim(claim: TargetClaim): Promise<void> {
  let stable = false;
  try { await assertTargetStable(claim); stable = true; } catch { /* never remove paths after target replacement */ }
  if (!stable) return;
  for (const file of [...claim.files].reverse()) await removeOwnedFile(file).catch(() => undefined);
  for (const directory of [...claim.directories].reverse()) await removeOwnedDirectory(directory).catch(() => undefined);
  await removeOwnedFile({ path: claim.lockPath, identity: claim.lockIdentity }).catch(() => undefined);
}

/** Generate a private, dependency-ready project from the built-in template. */
export async function initProject(directory: string, options: InitProjectOptions): Promise<InitProjectResult> {
  const target = localTarget(directory);
  const checked = validateOptions(options);
  let rendered: RenderedTemplateFile[];
  try { rendered = await renderVanillaTs(checked); }
  catch (error) { throw failure(error, "The built-in template could not be rendered."); }
  const claim = await claimTarget(target);
  try {
    const requiredDirectories = new Set<string>();
    for (const file of rendered) {
      const parts = file.path.split("/");
      for (let index = 1; index < parts.length; index++) requiredDirectories.add(parts.slice(0, index).join("/"));
    }
    for (const path of [...requiredDirectories].sort((a, b) => a.split("/").length - b.split("/").length || Buffer.compare(Buffer.from(a), Buffer.from(b)))) await createDirectory(claim, path);
    await assertTargetStable(claim);
    for (const file of rendered) { await writeTemplateFile(claim, file); await assertTargetStable(claim); }
    await removeOwnedFile({ path: claim.lockPath, identity: claim.lockIdentity });
    return { directory: claim.directory, files: rendered.map((file) => file.path) };
  } catch (error) {
    await cleanupClaim(claim);
    if (error instanceof ProjectError) throw error;
    throw failure(error, "The generated project could not be written.");
  }
}

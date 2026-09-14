import { promises as fs, type BigIntStats } from "node:fs";
import { join, parse, relative, resolve, sep } from "node:path";
import { ProjectError } from "./errors.js";

export interface PathSnapshot {
  absolute: string;
  directories: { path: string; stat: BigIntStats }[];
  stat: BigIntStats;
}
export function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
}
export function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
export function samePath(a: PathSnapshot, b: PathSnapshot): boolean {
  return a.absolute === b.absolute && a.directories.length === b.directories.length
    && a.directories.every((part, index) => part.path === b.directories[index].path && sameIdentity(part.stat, b.directories[index].stat));
}

/** lstat every component, including ancestor junctions, before opening a file. */
export async function inspectPath(input: string): Promise<PathSnapshot> {
  if (typeof input !== "string" || !input || /[\u0000-\u001f\u007f]/.test(input)
    || process.platform === "win32" && /^(?:[a-z]:(?![\\/])|\\\\[?.]\\)/i.test(input)) {
    throw new ProjectError("E_INVALID_ARGUMENT", "An ordinary local filesystem path is required.");
  }
  const absolute = resolve(input);
  const root = parse(absolute).root;
  const parts = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  const directories: PathSnapshot["directories"] = [];
  for (let index = 0; index <= parts.length; index++) {
    if (index) current = join(current, parts[index - 1]);
    const stat = await fs.lstat(current, { bigint: true });
    if (stat.isSymbolicLink()) throw new ProjectError("E_PATH_SYMLINK", "Symbolic links and junctions are not allowed in project input paths.");
    if (index === parts.length) return { absolute, directories, stat };
    if (!stat.isDirectory()) throw new ProjectError("E_FILE_TYPE", "An input ancestor is not a directory.");
    directories.push({ path: current, stat });
  }
  throw new ProjectError("E_INVALID_ARGUMENT", "The local input path is invalid.");
}

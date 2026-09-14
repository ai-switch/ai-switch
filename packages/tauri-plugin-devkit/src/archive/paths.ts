import { limits, normalizeArchivePath } from "@ai-switch/tauri-plugin-runtime/protocol";
import { ProjectError } from "../project/errors.js";

const topFiles = new Set(["aplg.json", "LICENSE", "README.md", "icon.svg", "icon.png", "THIRD_PARTY_NOTICES.md"]);
const forbiddenExtension = /\.(?:exe|com|dll|dylib|node|sys|msi|scr|bat|cmd|ps1|sh|key|pem|p12|pfx|p8|p7b|crt|cer|a|lib|o|obj|class|jar|rs|c|cpp|h|hpp|ts|tsx|jsx|map|so(?:\.\d+)*)$/i;
const asciiFold = (path: string) => path.replace(/[A-Z]/g, (char) => char.toLowerCase());
const fail = (code: string, message: string): never => { throw new ProjectError(code, message); };

export function decodeEntryName(raw: Uint8Array, flags: number): string {
  if (!(flags & 0x800) && raw.some((byte) => byte >= 0x80)) fail("E_ARCHIVE_ENCODING", "Non-ASCII names require an explicit UTF-8 ZIP flag.");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw); }
  catch { return fail("E_ARCHIVE_ENCODING", "ZIP member names must be valid UTF-8 or unambiguous ASCII."); }
}
export function entryPath(name: string): { path: string; directory: boolean; limit: number } {
  const directory = name.endsWith("/"); const path = directory ? name.slice(0, -1) : name;
  try { normalizeArchivePath(path); } catch { fail("E_ARCHIVE_PATH", "ZIP member names must be portable relative paths."); }
  if (path.normalize("NFKC") !== path || /[\u0080-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]|~[0-9]/u.test(path)) fail("E_ARCHIVE_PATH", "ZIP member names contain a known ambiguous filesystem spelling.");
  if (!(directory ? path === "dist" || path.startsWith("dist/") : topFiles.has(path) || path.startsWith("dist/"))) fail("E_ARCHIVE_CONTENT", "ZIP members must be declared web assets or allowed root metadata.");
  if (path.split("/").some((part) => part.startsWith(".") || /^(?:node_modules|native|id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i.test(part)) || forbiddenExtension.test(path)) fail("E_ARCHIVE_CONTENT", "Native, secret, source-management or dependency files are not web-v1 assets.");
  const lower = path.toLowerCase();
  const limit = directory ? 0 : path === "aplg.json" ? 256 * 1024 : /\.html?$/.test(lower) ? 2 * 1024 * 1024 : /\.(?:[cm]?js|css)$/.test(lower) ? 16 * 1024 * 1024 : limits.archiveExtractedBytes;
  return { path, directory, limit };
}

/** Store only explicit names. Materializing every parent prefix would amplify
 * 10000 deep paths into millions of strings. Component-sorted neighbors suffice
 * to detect implicit-parent case conflicts and file/directory ancestor conflicts.
 */
export function createPathRegistry() {
  type Path = { path: string; directory: boolean; key: string };
  const sorted: Path[] = [];
  const fold = (path: string) => asciiFold(path).toUpperCase().toLowerCase();
  function compatible(a: Path, b: Path) {
    const left = a.path.split("/"); const right = b.path.split("/");
    const shared = Math.min(left.length, right.length);
    for (let index = 0; index < shared; index++) {
      if (fold(left[index]) !== fold(right[index])) return;
      if (left[index] !== right[index]) fail("E_ARCHIVE_COLLISION", "ZIP member paths have conflicting case spellings.");
    }
    if (left.length === right.length || !(left.length < right.length ? a.directory : b.directory)) fail("E_ARCHIVE_COLLISION", "ZIP members duplicate or conflict with a file/directory path.");
  }
  return {
    add(path: string, directory: boolean): void {
      // NUL is not a legal filename byte and sorts before all portable segments,
      // ensuring parents/children stay adjacent even next to names like assets-x.
      const item = { path, directory, key: fold(path).replaceAll("/", "\0") };
      let low = 0; let high = sorted.length;
      while (low < high) { const middle = (low + high) >>> 1; if (sorted[middle].key < item.key) low = middle + 1; else high = middle; }
      if (low) compatible(sorted[low - 1], item);
      if (low < sorted.length) compatible(item, sorted[low]);
      sorted.splice(low, 0, item);
    },
  };
}export function checkEntryMode(attributes: number, versionMadeBy: number, directory: boolean): void {
  const creator = versionMadeBy >>> 8; const mode = attributes >>> 16; const dos = attributes & 0xffff;
  if (![0, 3].includes(creator) || dos & ~0x31) fail("E_ARCHIVE_MODE", "Unsupported ZIP creator or special DOS attributes.");
  if (Boolean(dos & 0x10) && !directory) fail("E_ARCHIVE_MODE", "Directory attributes disagree with the member path.");
  if (mode !== 0) {
    const type = mode & 0o170000;
    if (type !== (directory ? 0o040000 : 0o100000) || mode & 0o7000 || !directory && mode & 0o111) fail("E_ARCHIVE_MODE", "ZIP links, executable files and special permission bits are forbidden.");
  }
}

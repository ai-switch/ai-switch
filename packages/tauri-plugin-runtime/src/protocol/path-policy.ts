const invalidCharacters = /[\u0000-\u001f\u007f<>:"|?*%\\]/u;
const reservedName = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;

function pathError(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function portableSegment(segment: string) {
  return segment.length > 0 && segment !== "." && segment !== ".."
    && segment.normalize("NFC") === segment && !invalidCharacters.test(segment)
    && !/[ .]$/u.test(segment) && !reservedName.test(segment);
}

export function normalizeArchivePath(path: string): string {
  if (typeof path !== "string" || path.length > 1024 || !path.split("/").every(portableSegment)) {
    pathError("E_ARCHIVE_PATH", "Archive paths must be portable relative POSIX paths.");
  }
  return path;
}

export function validateVirtualPath(path: string): string {
  if (typeof path !== "string" || path.length > 4096 || !path.startsWith("/") || path.startsWith("//") || invalidCharacters.test(path)) {
    pathError("E_INVALID_ARGUMENT", "An absolute virtual filesystem path is required.");
  }
  const raw = path.split("/").slice(1);
  const rootLength = raw[0] === "mounts" ? 2 : 1;
  if (raw[0] !== "app" && raw[0] !== "data" && raw[0] !== "mounts") pathError("E_INVALID_ARGUMENT", "Unknown virtual filesystem root.");
  if (raw[0] === "mounts" && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(raw[1] ?? "")) {
    pathError("E_INVALID_ARGUMENT", "A valid mount grant is required.");
  }
  const parts = raw.slice(0, rootLength);
  for (const part of raw.slice(rootLength)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length <= rootLength) pathError("E_INVALID_ARGUMENT", "Virtual paths cannot escape their authorized root.");
      parts.pop();
    } else {
      if (!portableSegment(part)) pathError("E_INVALID_ARGUMENT", "Virtual path contains a nonportable segment.");
      parts.push(part);
    }
  }
  return `/${parts.join("/")}`;
}

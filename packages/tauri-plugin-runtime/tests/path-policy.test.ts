import { expect, test } from "vitest";
import { normalizeArchivePath, validateVirtualPath } from "../src/protocol/index.js";

test.each(["dist/index.html", "dist/assets/a.js", "dist/你好.svg", "LICENSE"])("preserves portable archive path %s", (path) => {
  expect(normalizeArchivePath(path)).toBe(path);
});

test.each(["", "/etc/passwd", "../secret", "dist/../secret", "./dist/a", "dist//a", "dist/", "C:/secret", "\\\\server\\a", "dist\\a", "dist/%2e%2e/a", "dist/a?b", "dist/CON.txt", "dist/LPT1", "dist/a.", "dist/a ", "dist/e\u0301.txt", "dist/a\u0000b"])("rejects nonportable archive path %j", (path) => {
  expect(() => normalizeArchivePath(path)).toThrow(expect.objectContaining({ code: "E_ARCHIVE_PATH" }));
});

test.each([["/data/a/../note.txt", "/data/note.txt"], ["/app/index.html", "/app/index.html"], ["/mounts/grant-1/readme.md", "/mounts/grant-1/readme.md"]])("normalizes only virtual roots: %s", (input, expected) => {
  expect(validateVirtualPath(input)).toBe(expected);
});

test.each(["relative.txt", "C:/secret", "/etc/passwd", "file:///data/a", "/data/../../etc/passwd", "/mounts", "/mounts/", "/mounts/../data", "/data/a\u0000b", "/data\\a"])("rejects non-virtual path %j", (path) => {
  expect(() => validateVirtualPath(path)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});

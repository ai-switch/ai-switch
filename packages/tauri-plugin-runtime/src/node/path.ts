import posix from "path-browserify";

/** Pure string helpers, not filesystem authorization. All relative paths use /data. */
export const join = (...parts: string[]): string => posix.join(...parts);
export const resolve = (...parts: string[]): string => posix.resolve("/data", ...parts);
export const normalize = (path: string): string => posix.normalize(path);
export const dirname = (path: string): string => posix.dirname(path);
export const basename = (path: string, suffix?: string): string => posix.basename(path, suffix);
export const extname = (path: string): string => posix.extname(path);
export const isAbsolute = (path: string): boolean => posix.isAbsolute(path);
export const relative = (from: string, to: string): string => posix.relative(resolve(from), resolve(to));

export default Object.freeze({ join, resolve, normalize, dirname, basename, extname, relative, isAbsolute });

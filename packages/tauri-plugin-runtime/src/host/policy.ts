import { AplgError } from "../protocol/errors.js";

export function checkedTimeout(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new AplgError("E_INVALID_ARGUMENT", "Host timeouts must be positive timer-safe integers.");
  }
  return value;
}
export function checkedOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/.test(url.hostname);
    if (url.origin !== origin || url.username || url.password || !(url.protocol === "https:" || url.protocol === "http:" && loopback)) throw new Error();
    return origin;
  } catch { throw new AplgError("E_INVALID_ARGUMENT", "Asset origins must be explicit HTTPS or loopback HTTP origins."); }
}
export function requireAssetOrigin(assetUrl: string, origins: readonly string[]) {
  if (!origins.includes(new URL(assetUrl).origin)) throw new AplgError("E_PERMISSION_DENIED", "The plugin asset origin is not allowed by this host.");
}
export function randomId(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return prefix + Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
export function randomNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Bound a trusted control operation even if its physical transport cannot abort. */
export function bounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AplgError("E_TIMEOUT", "The host operation timed out.")), timeoutMs);
    void Promise.resolve().then(operation).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

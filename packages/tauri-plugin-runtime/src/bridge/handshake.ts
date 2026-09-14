import { AplgError } from "../protocol/errors.js";
import { validateJson } from "../protocol/json-safety.js";
import { apiVersion, protocolVersion } from "../protocol/limits.js";
import { satisfiesApiRange } from "../protocol/manifest.js";
import { validateSessionDescriptor } from "../protocol/session.js";
import { standardCapabilities } from "../protocol/capabilities.js";
import type { SessionInfo } from "../protocol/wire.js";

const marker = ";aplg=";
export interface BootstrapHint { nonce: string; parentOrigin: string; originalHash: string }

function encodeBase64Url(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeBase64Url(value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Invalid base64url.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const result = atob(padded);
  if (encodeBase64Url(result) !== value) throw new Error("Noncanonical base64url.");
  return result;
}
function validNonce(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 43) return false;
  try { return decodeBase64Url(value).length === 32; } catch { return false; }
}
function validOrigin(origin: unknown): origin is string {
  if (typeof origin !== "string") return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

export function appendBootstrapHint(assetUrl: string, nonce: string, parentOrigin: string): string {
  if (!validNonce(nonce) || !validOrigin(parentOrigin)) throw new AplgError("E_INVALID_ARGUMENT", "Invalid bootstrap context.");
  const url = new URL(assetUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AplgError("E_INVALID_ARGUMENT", "Invalid plugin asset URL.");
  const hint = encodeBase64Url(JSON.stringify({ aplgNonce: nonce, aplgParentOrigin: parentOrigin }));
  url.hash = `${url.hash}${marker}${hint}`;
  return url.href;
}

export function readBootstrapHint(href: string): BootstrapHint {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported asset URL.");
    const offset = url.hash.lastIndexOf(marker);
    if (offset < 0) throw new Error("Missing bootstrap context.");
    const encoded = url.hash.slice(offset + marker.length);
    if (encoded.length > 4096) throw new Error("Oversized context.");
    const value: unknown = JSON.parse(decodeBase64Url(encoded));
    if (!validateJson(value, 4096).ok || value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid context.");
    const hint = value as Record<string, unknown>;
    if (Object.keys(hint).length !== 2 || !validNonce(hint.aplgNonce) || !validOrigin(hint.aplgParentOrigin)) throw new Error("Invalid identity.");
    const originalHash = url.hash.slice(0, offset);
    return { nonce: hint.aplgNonce, parentOrigin: hint.aplgParentOrigin, originalHash: originalHash === "#" ? "" : originalHash };
  } catch { throw new AplgError("E_HOST_UNAVAILABLE", "This page is not connected to an APLG host."); }
}

/** Validate public info through the existing session contract, never a second schema. */
export function validatePublicSessionInfo(input: unknown): SessionInfo {
  if (!validateJson(input).ok || input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new AplgError("E_PROTOCOL_MISMATCH", "Invalid public session information.");
  }
  const candidate = input as SessionInfo;
  if (candidate.protocol !== protocolVersion || !satisfiesApiRange(candidate.apiVersion, `^${apiVersion}`)) {
    throw new AplgError("E_PROTOCOL_MISMATCH", "The host API version is incompatible.");
  }
  const required: Record<string, string> = {};
  if (candidate.capabilities && typeof candidate.capabilities === "object") {
    for (const [name, value] of Object.entries(candidate.capabilities)) {
      if (!value || typeof value.version !== "string") throw new AplgError("E_PROTOCOL_MISMATCH", "Invalid capability information.");
      required[name] = value.version;
      if (name.startsWith("aplg.") && !Object.hasOwn(standardCapabilities, name)) throw new AplgError("E_PROTOCOL_MISMATCH", "Unknown standard capability.");
    }
  }
  const descriptor = {
    sessionId: "public-info-validation", assetUrl: "https://aplg.invalid/dist/index.html", info: input,
    manifest: {
      manifestVersion: 1, id: candidate.plugin?.id, name: "Public info validation", version: candidate.plugin?.version,
      description: "", license: "MIT", engines: { aplg: `^${apiVersion}` }, entry: "dist/index.html", activation: "view",
      requires: required, optional: {}, permissions: { filesystem: [], network: [], native: false },
      contributes: { views: [{ id: "main", title: "Main" }] },
    },
  };
  if (!validateSessionDescriptor(descriptor).ok) throw new AplgError("E_PROTOCOL_MISMATCH", "Invalid public session information.");
  return candidate;
}

export function validateConnectMessage(value: unknown, nonce: string): SessionInfo {
  if (!validateJson(value).ok || value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AplgError("E_PROTOCOL_MISMATCH", "Invalid bootstrap response.");
  }
  const message = value as Record<string, unknown>;
  const keys = ["channel", "protocol", "kind", "nonce", "info"];
  if (Object.keys(message).length !== keys.length || !keys.every((key) => Object.hasOwn(message, key)) || message.channel !== "aplg.bootstrap" || message.protocol !== protocolVersion || message.kind !== "connect" || message.nonce !== nonce) {
    throw new AplgError("E_PROTOCOL_MISMATCH", "Bootstrap identity or protocol mismatch.");
  }
  return validatePublicSessionInfo(message.info);
}

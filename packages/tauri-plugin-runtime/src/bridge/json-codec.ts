import { AplgError } from "../protocol/errors.js";
import { validateJson } from "../protocol/json-safety.js";
import { limits } from "../protocol/limits.js";
import { validateWireMessage } from "../protocol/wire.js";
import type { WireMessage } from "../protocol/generated/types.generated.js";

const encoder = new TextEncoder();

export function checkedByteLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > limits.controlBytes) {
    throw new AplgError("E_INVALID_ARGUMENT", "Invalid RPC message size limit.");
  }
  return value;
}

export function encodeWireMessage(value: unknown, maxBytes: number = limits.controlBytes): string {
  checkedByteLimit(maxBytes);
  const safe = validateJson(value, maxBytes);
  if (!safe.ok) {
    const sizeExceeded = safe.diagnostics.some((diagnostic) => diagnostic.message.includes("size"));
    throw new AplgError(sizeExceeded ? "E_LIMIT_EXCEEDED" : "E_INVALID_MESSAGE", "The outgoing RPC message is invalid.");
  }
  if (!validateWireMessage(value).ok) throw new AplgError("E_INVALID_MESSAGE", "The outgoing RPC message does not match the protocol.");
  return JSON.stringify(value);
}

export function decodeWireMessage(frame: unknown, maxBytes: number = limits.controlBytes): WireMessage {
  checkedByteLimit(maxBytes);
  if (typeof frame !== "string") throw new AplgError("E_INVALID_MESSAGE", "RPC frames must be JSON strings.");
  if (frame.length > maxBytes || encoder.encode(frame).byteLength > maxBytes) {
    throw new AplgError("E_LIMIT_EXCEEDED", "The RPC frame exceeds the negotiated byte limit.");
  }
  let value: unknown;
  try { value = JSON.parse(frame); } catch { throw new AplgError("E_INVALID_MESSAGE", "The RPC frame is not valid JSON."); }
  const result = validateWireMessage(value);
  if (!result.ok) throw new AplgError("E_INVALID_MESSAGE", "The RPC frame does not match the protocol.");
  return result.value;
}

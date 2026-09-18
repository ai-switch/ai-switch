import { AplgError, errorCodes, type AplgErrorCode, type ErrorPayload } from "../protocol/errors.js";

/** The caller must already have validated the remote wire envelope. */
export function fromErrorPayload(payload: ErrorPayload): Error {
  if ((errorCodes as readonly string[]).includes(payload.code)) {
    return new AplgError(payload.code as AplgErrorCode, payload.message, payload.details);
  }
  return Object.assign(new Error(payload.message), {
    name: "RemoteCapabilityError", code: payload.code,
    ...(payload.details === undefined ? {} : { details: payload.details }),
  });
}

import { validateHostEventSchema, validateWireMessageSchema } from "./generated/validators.generated.mjs";
import type { HostEvent, SessionDescriptor, WireMessage } from "./generated/types.generated.js";
import type { JsonObject, SchemaValidator, ValidationResult } from "./types.js";
import { validateWithSchema } from "./validation.js";

export type SessionInfo = SessionDescriptor["info"];
export type CapabilityInfo = SessionInfo["capabilities"][string];
export type PluginRequest = Extract<WireMessage, { kind: "request" }>;
export type PluginOperation = PluginRequest["operation"];
export type HostOperation = PluginOperation | "session.open" | "session.close";
export type Unsubscribe = () => void;

export interface HostTransport {
  call<T>(operation: HostOperation, args: JsonObject): Promise<T>;
  subscribe(handler: (event: HostEvent) => void): Promise<Unsubscribe>;
}

export function validateWireMessage(value: unknown): ValidationResult<WireMessage> {
  return validateWithSchema(value, validateWireMessageSchema as SchemaValidator, "E_INVALID_MESSAGE");
}

export function validateHostEvent(value: unknown): ValidationResult<HostEvent> {
  return validateWithSchema(value, validateHostEventSchema as SchemaValidator, "E_INVALID_MESSAGE");
}

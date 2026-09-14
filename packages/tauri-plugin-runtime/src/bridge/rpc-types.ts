import type { JsonObject, JsonValue } from "../protocol/types.js";
import type { PluginOperation, PluginRequest, Unsubscribe } from "../protocol/wire.js";
import type { WireMessage } from "../protocol/generated/types.generated.js";

export interface CallOptions { signal?: AbortSignal; timeoutMs?: number }
export type IncomingRequest = PluginRequest & { signal: AbortSignal };
export type PortEvent = Extract<WireMessage, { kind: "event" | "connection" }>;
export interface RpcPeer {
  request(operation: PluginOperation, args: JsonObject, options?: CallOptions): Promise<JsonValue>;
  onRequest(handler: (request: IncomingRequest) => Promise<JsonValue>): Unsubscribe;
  onEvent(handler: (event: PortEvent) => void): Unsubscribe;
  sendEvent(event: PortEvent): void;
  close(reason?: Error): void;
}

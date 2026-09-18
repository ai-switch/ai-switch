import type { CallOptions } from "../bridge/rpc-types.js";
import type { SessionInfo, Unsubscribe } from "../protocol/wire.js";
import type { JsonValue } from "../protocol/types.js";

export type ConnectionState = "connected" | "disconnected" | "closed";
export type DirectorySelection = { path: string; access: "read" | "readwrite" } | null;
export interface PluginApi {
  ready(): Promise<SessionInfo>;
  capabilities: { supports(name: string, range?: string): boolean };
  call<T extends JsonValue>(capability: string, method: string, params?: JsonValue, options?: CallOptions): Promise<T>;
  subscribe(capability: string, topic: string, handler: (payload: JsonValue) => void): Promise<Unsubscribe>;
  onConnectionChange(handler: (state: ConnectionState) => void): Unsubscribe;
  storage: {
    get(key: string): Promise<JsonValue>;
    set(key: string, value: JsonValue): Promise<void>;
    remove(key: string): Promise<void>;
  };
  dialog: { pickDirectory(options?: { access?: "read" | "readwrite" }): Promise<DirectorySelection> };
}
export type { CallOptions };

/* Generated from JSON Schema. Do not edit directly. */

export type HostEvent =
  | {
      kind: "capability.event";
      sessionId: string;
      subscriptionId: string;
      seq: number;
      payload: JsonValue;
    }
  | {
      kind: "session.closed";
      sessionId: string;
      reason: string;
    }
  | {
      kind: "transport.state";
      state: "connected" | "disconnected";
    };
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };

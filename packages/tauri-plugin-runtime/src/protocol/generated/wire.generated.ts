/* Generated from JSON Schema. Do not edit directly. */

export type WireMessage =
  | {
      protocol: "aplg/1";
      kind: "request";
      id: string;
      operation: "capability.call";
      args: {
        capability: string;
        method: string;
        params: JsonValue;
      };
    }
  | {
      protocol: "aplg/1";
      kind: "request";
      id: string;
      operation: "subscription.open";
      args: {
        capability: string;
        topic: string;
      };
    }
  | {
      protocol: "aplg/1";
      kind: "request";
      id: string;
      operation: "subscription.close";
      args: {
        subscriptionId: string;
      };
    }
  | {
      protocol: "aplg/1";
      kind: "request";
      id: string;
      operation: "request.cancel";
      args: {
        requestId: string;
      };
    }
  | {
      protocol: "aplg/1";
      kind: "result";
      id: string;
      value: JsonValue;
    }
  | {
      protocol: "aplg/1";
      kind: "error";
      id: string;
      error: {
        code: string;
        message: string;
        details?: JsonValue;
      };
    }
  | {
      protocol: "aplg/1";
      kind: "event";
      subscriptionId: string;
      seq: number;
      payload: JsonValue;
    }
  | {
      protocol: "aplg/1";
      kind: "connection";
      state: "connected" | "disconnected" | "closed";
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

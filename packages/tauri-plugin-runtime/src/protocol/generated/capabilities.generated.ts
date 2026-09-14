/* Generated from JSON Schema. Do not edit directly. */

export type StandardCapabilityMessage =
  | {
      capability: "aplg.storage";
      method: "get";
      direction: "request";
      value: {
        key: string;
      };
    }
  | {
      capability: "aplg.storage";
      method: "get";
      direction: "result";
      value: JsonValue;
    }
  | {
      capability: "aplg.storage";
      method: "set";
      direction: "request";
      value: {
        key: string;
        value: JsonValue;
      };
    }
  | {
      capability: "aplg.storage";
      method: "set";
      direction: "result";
      value: null;
    }
  | {
      capability: "aplg.storage";
      method: "remove";
      direction: "request";
      value: {
        key: string;
      };
    }
  | {
      capability: "aplg.storage";
      method: "remove";
      direction: "result";
      value: null;
    }
  | {
      capability: "aplg.dialog";
      method: "pickDirectory";
      direction: "request";
      value: {
        access?: "read" | "readwrite";
      };
    }
  | {
      capability: "aplg.dialog";
      method: "pickDirectory";
      direction: "result";
      value: null | {
        path: string;
        access: "read" | "readwrite";
      };
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

/* Generated from JSON Schema. Do not edit directly. */

export type Range = string;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };

export interface Manifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  engines: {
    aplg: Range;
  };
  entry: string;
  activation: "view";
  requires: CapabilityRanges;
  optional: CapabilityRanges;
  permissions: {
    /**
     * @maxItems 2
     */
    filesystem: {
      root: "plugin-data" | "user-selected";
      /**
       * @minItems 1
       * @maxItems 2
       */
      access: ("read" | "write")[];
    }[];
    /**
     * @maxItems 64
     */
    network: {
      /**
       * @minItems 1
       * @maxItems 64
       */
      origins: string[];
      /**
       * @minItems 1
       * @maxItems 9
       */
      methods: ("GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "CONNECT" | "TRACE")[];
    }[];
    native: boolean;
  };
  contributes: {
    /**
     * @minItems 1
     * @maxItems 32
     */
    views: {
      id: string;
      title: string;
    }[];
  };
  extensions?: {
    [k: string]: JsonValue;
  };
}
export interface CapabilityRanges {
  [k: string]: Range;
}

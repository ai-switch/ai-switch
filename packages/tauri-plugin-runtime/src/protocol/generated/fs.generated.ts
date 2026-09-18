/* Generated from JSON Schema. Do not edit directly. */

export type FsCapabilityMessage =
  | {
      capability: "aplg.fs";
      method: "transfer.openRead";
      direction: "request";
      value: {
        path: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.openRead";
      direction: "result";
      value: {
        handle: string;
        size: number;
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.openWrite";
      direction: "request";
      value: {
        path: string;
        size: number;
        mode: "w" | "wx" | "a" | "ax";
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.openWrite";
      direction: "result";
      value: {
        handle: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.pull";
      direction: "request";
      value: {
        handle: string;
        offset: number;
        length: number;
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.pull";
      direction: "result";
      value: {
        offset: number;
        dataBase64: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.push";
      direction: "request";
      value: {
        handle: string;
        offset: number;
        dataBase64: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.push";
      direction: "result";
      value: {
        written: number;
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.finish";
      direction: "request";
      value: {
        handle: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.finish";
      direction: "result";
      value: null;
    }
  | {
      capability: "aplg.fs";
      method: "transfer.abort";
      direction: "request";
      value: {
        handle: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "transfer.abort";
      direction: "result";
      value: null;
    }
  | {
      capability: "aplg.fs";
      method: "stat";
      direction: "request";
      value: {
        path: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "stat";
      direction: "result";
      value: {
        kind: "file" | "directory";
        size: number;
        mtimeMs: number;
      };
    }
  | {
      capability: "aplg.fs";
      method: "readdir";
      direction: "request";
      value: {
        path: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "readdir";
      direction: "result";
      /**
       * @maxItems 10000
       */
      value: {
        name: string;
        kind: "file" | "directory";
      }[];
    }
  | {
      capability: "aplg.fs";
      method: "mkdir";
      direction: "request";
      value: {
        path: string;
        recursive: boolean;
      };
    }
  | {
      capability: "aplg.fs";
      method: "mkdir";
      direction: "result";
      value: {
        createdPath: null | string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "rename";
      direction: "request";
      value: {
        from: string;
        to: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "rename";
      direction: "result";
      value: null;
    }
  | {
      capability: "aplg.fs";
      method: "copyFile";
      direction: "request";
      value: {
        from: string;
        to: string;
      };
    }
  | {
      capability: "aplg.fs";
      method: "copyFile";
      direction: "result";
      value: null;
    }
  | {
      capability: "aplg.fs";
      method: "rm";
      direction: "request";
      value: {
        path: string;
        recursive: boolean;
        force: boolean;
      };
    }
  | {
      capability: "aplg.fs";
      method: "rm";
      direction: "result";
      value: null;
    };

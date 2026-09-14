import { expect, test } from "vitest";
import { AplgError, toErrorPayload } from "../src/protocol/index.js";

test("error envelopes omit stacks, arbitrary fields and real filesystem paths", () => {
  const error = Object.assign(new Error("Internal failure at C:/private"), { token: "secret", path: "C:/private", code: "E_INTERNAL" });
  expect(toErrorPayload(error)).toEqual({ code: "E_HOST_UNAVAILABLE", message: "The host operation failed." });
  const safe = new AplgError("E_PERMISSION_DENIED", "Denied", { path: "/data/note" });
  expect(toErrorPayload(safe)).toEqual({ code: "E_PERMISSION_DENIED", message: "Denied", details: { path: "/data/note" } });
});

test("known file errors retain only safe syscall and virtual path data", () => {
  expect(toErrorPayload({ code: "ENOENT", message: "secret path", syscall: "read", path: "/data/missing", secret: "hidden" }))
    .toEqual({ code: "ENOENT", message: "The filesystem operation failed.", details: { syscall: "read", path: "/data/missing" } });
  const report = toErrorPayload({ code: "ENOENT", syscall: "read", path: "C:/secret" });
  expect(report.details).toEqual({ syscall: "read" });
});

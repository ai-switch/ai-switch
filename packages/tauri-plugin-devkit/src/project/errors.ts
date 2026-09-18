import type { Diagnostic } from "@ai-switch/tauri-plugin-runtime/protocol";

/** Deliberately safe diagnostics; never copy OS error messages, paths or causes. */
export class ProjectError extends Error {
  constructor(readonly code: string, message: string, readonly path = "", readonly kind: "validation" | "io" = "validation") {
    super(message); this.name = "ProjectError";
  }
  diagnostic(prefix = ""): Diagnostic { return { code: this.code, path: prefix + this.path, message: this.message }; }
}
export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
}

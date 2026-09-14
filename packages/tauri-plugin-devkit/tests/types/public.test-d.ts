import { validateProject, type PackFile, type ProjectReport, type ValidateProjectOptions } from "@ai-switch/tauri-plugin-devkit";
import type { Manifest, Diagnostic } from "@ai-switch/tauri-plugin-runtime/protocol";

const options: ValidateProjectOptions = { stage: "source", profile: "web-v1" };
const result: Promise<ProjectReport> = validateProject(".", options);
const report = await result;
const diagnostics: Diagnostic[] = report.diagnostics;
if (report.valid) {
  const manifest: Manifest = report.manifest;
  const files: PackFile[] = report.files;
  const digest: string = report.manifestSha256;
  void [manifest, files, digest];
} else {
  // @ts-expect-error an invalid report never promises a manifest snapshot.
  report.manifest;
}
void diagnostics;
// @ts-expect-error no undeclared native profile.
validateProject(".", { profile: "native-v1" });
// @ts-expect-error unknown stages cannot silently degrade to source validation.
validateProject(".", { stage: "build" });
// @ts-expect-error this validation API is not an install/build command.
validateProject(".", { execute: true });
// @ts-expect-error URI roots and arbitrary objects are not filesystem strings.
validateProject(new URL("file:///tmp/plugin"));

// @ts-expect-error the Node entry must not require browser DOM globals.
document.body.append('not a browser SDK');

import { inspectPackage, type PackageInspection } from "@ai-switch/tauri-plugin-devkit";
const inspection: PackageInspection = await inspectPackage("./notes.aplg");
const untrusted: "not-verified" = inspection.signature;
if (inspection.valid) {
  const manifest: Manifest = inspection.manifest;
  const files: PackFile[] = inspection.files;
  const bytes: number = inspection.size;
  void [manifest, files, bytes];
} else {
  // @ts-expect-error an invalid archive never promises verified file hashes.
  inspection.sha256;
}
void untrusted;
// @ts-expect-error inspect never offers an extraction output directory.
inspectPackage("./notes.aplg", { extract: "./output" });
import { packProject, validateProject, type PackFile, type PackProjectOptions, type PackResult, type ProjectReport, type ValidateProjectOptions } from "@ai-switch/tauri-plugin-devkit";
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

const packOptions: PackProjectOptions = { outDir: "./packages", profile: "web-v1" };
const packed: PackResult = await packProject(".", packOptions);
const packedManifest: Manifest = packed.manifest;
const packedPath: string = packed.path;
const packedBytes: number = packed.size;
const packedDigest: string = packed.sha256;
const packedManifestDigest: string = packed.manifestSha256;
void [packedManifest, packedPath, packedBytes, packedDigest, packedManifestDigest];
// @ts-expect-error native packages are outside the web-v1 devkit contract.
packProject(".", { profile: "native-v1" });
// @ts-expect-error pack never accepts implicit build or arbitrary execution options.
packProject(".", { build: true });
// @ts-expect-error URI roots are not local project path strings.
packProject(new URL("file:///tmp/plugin"));
// @ts-expect-error outDir is a filesystem string, not a URL object.
packProject(".", { outDir: new URL("file:///tmp/output") });

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
import { aplgVite, type AplgViteOptions } from "@ai-switch/tauri-plugin-devkit/vite";
import type { Plugin } from "vite";
const viteOptions: AplgViteOptions = { preview: false };
const plugins: Plugin[] = aplgVite(viteOptions);
void plugins;
// @ts-expect-error unknown options must not silently change the host build.
aplgVite({ global: true });
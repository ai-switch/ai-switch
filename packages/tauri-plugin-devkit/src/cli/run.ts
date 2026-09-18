import { basename, resolve } from "node:path";
import type { Diagnostic } from "@ai-switch/tauri-plugin-runtime/protocol";
import { inspectPackage } from "../archive/inspect.js";
import { packProject } from "../archive/pack.js";
import type { PackageInspection } from "../archive/types.js";
import { initProject, type InitProjectResult } from "../init/index.js";
import { validateProject } from "../project/validate.js";
import { ProjectError } from "../project/errors.js";
import type { PackResult, ProjectReport } from "../project/types.js";

export interface CliIo { stdout(text: string): void; stderr(text: string): void }
const version = "0.1.0";
const help = `APLG devkit ${version}
Usage:
  aplg init <directory> --id <id> --name <name> [--template vanilla-ts] [--json]
  aplg validate [directory] [--stage source|dist] [--json]
  aplg inspect <file.aplg> [--json]
  aplg pack [directory] [--out-dir <directory>] [--json]
  aplg --help
  aplg --version

Init writes only the built-in private template; it does not install, build or run code.
Source validation reads metadata only; it does not run build/install/config code.
Inspect checks archive structure without extraction or signature verification.
Pack requires an existing valid dist and never runs build/install/config code.
`;
const line = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
const localArgument = (value: string) => !!value && !/[\u0000-\u001f\u007f]/.test(value)
  && !/^(?:[a-z]:(?![\\/])|[a-z][a-z0-9+.-]*:\/\/|\\\\[?.]\\)/i.test(value);

/** Core CLI logic: no process.exit, cwd mutation or implicit project execution. */
export async function runCli(argv: string[], io: CliIo, options: { cwd: string }): Promise<0 | 1 | 2> {
  const optionEnd = Array.isArray(argv) ? argv.indexOf("--") : -1;
  const json = Array.isArray(argv) && argv.slice(0, optionEnd < 0 ? argv.length : optionEnd).includes("--json");
  const command = Array.isArray(argv) ? argv[0] : undefined;
  const archive = command === "inspect";
  const packing = command === "pack";
  const initializing = command === "init";
  function reportInvalid(diagnostics: Diagnostic[], code: 1 | 2): 1 | 2 {
    const result = { valid: false as const, ...(archive ? { signature: "not-verified" as const } : {}), diagnostics };
    if (json) io.stdout(`${JSON.stringify(result)}\n`);
    for (const diagnostic of diagnostics) io.stderr(`${line(diagnostic.code)}${diagnostic.path ? ` ${line(diagnostic.path)}` : ""}: ${line(diagnostic.message)}\n`);
    return code;
  }
  function report(result: ProjectReport | PackageInspection, code: 0 | 1 | 2): 0 | 1 | 2 {
    if (!result.valid) return reportInvalid(result.diagnostics, code === 2 ? 2 : 1);
    if (json) io.stdout(`${JSON.stringify(result)}\n`);
    else io.stdout(archive
      ? `Valid archive structure: ${result.manifest.id}@${result.manifest.version}; signature: not-verified\n`
      : `Valid project: ${result.manifest.id}@${result.manifest.version}\n`);
    return code;
  }
  function reportPack(result: PackResult): 0 {
    const safe = { ...result, valid: true as const, path: basename(result.path) };
    if (json) io.stdout(`${JSON.stringify(safe)}\n`);
    else io.stdout(`Packed ${line(result.manifest.id)}@${line(result.manifest.version)}: ${line(safe.path)} (${result.size} bytes, sha256 ${result.sha256})\n`);
    return 0;
  }
  function reportInit(result: InitProjectResult): 0 {
    const safe = { valid: true as const, directory: basename(result.directory), files: result.files };
    if (json) io.stdout(`${JSON.stringify(safe)}\n`);
    else io.stdout(`Initialized ${line(safe.directory)} with ${result.files.length} files.\n`);
    return 0;
  }
  function failure(code: string, message: string, exit: 1 | 2 = 1, path = "") { return reportInvalid([{ code, path, message }], exit); }
  const usage = () => failure("E_CLI_ARGUMENTS", "Invalid command or options. Use aplg --help for usage.");
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== "string")) return usage();
  if (!argv.length || argv.length === 1 && ["--help", "-h"].includes(argv[0])) { io.stdout(help); return 0; }
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) { io.stdout(`${version}\n`); return 0; }
  if (command !== "validate" && !archive && !packing && !initializing) return usage();

  let directory: string | undefined; let outDir: string | undefined; let stage: "source" | "dist" = "source";
  let id: string | undefined; let name: string | undefined; let template: "vanilla-ts" | undefined;
  let seenStage = false; let seenOutDir = false; let seenJson = false; let seenId = false; let seenName = false; let seenTemplate = false; let positional = false;
  const valueFor = (arg: string, name: string, index: number): string | undefined => arg === name ? argv[index + 1] : arg.slice(name.length + 1);
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (!positional && arg === "--") { positional = true; continue; }
    if (!positional && arg === "--json") { if (seenJson) return usage(); seenJson = true; continue; }
    if (!positional && (arg === "--stage" || arg.startsWith("--stage="))) {
      if (command !== "validate" || seenStage) return usage(); seenStage = true;
      const value = arg === "--stage" ? argv[++index] : arg.slice("--stage=".length);
      if (value !== "source" && value !== "dist") return usage(); stage = value; continue;
    }
    if (!positional && (arg === "--out-dir" || arg.startsWith("--out-dir="))) {
      if (!packing || seenOutDir) return usage(); seenOutDir = true;
      const value = arg === "--out-dir" ? argv[++index] : arg.slice("--out-dir=".length);
      if (typeof value !== "string" || value.startsWith("-") || !localArgument(value)) return usage();
      outDir = value; continue;
    }
    if (!positional && (arg === "--id" || arg.startsWith("--id="))) {
      if (!initializing || seenId) return usage(); seenId = true;
      const value = valueFor(arg, "--id", index);
      if (arg === "--id") index++;
      if (typeof value !== "string" || value.startsWith("-") || !localArgument(value)) return usage();
      id = value; continue;
    }
    if (!positional && (arg === "--name" || arg.startsWith("--name="))) {
      if (!initializing || seenName) return usage(); seenName = true;
      const value = valueFor(arg, "--name", index);
      if (arg === "--name") index++;
      if (typeof value !== "string" || value.startsWith("-") || !value || /[\u0000-\u001f\u007f]/.test(value)) return usage();
      name = value; continue;
    }
    if (!positional && (arg === "--template" || arg.startsWith("--template="))) {
      if (!initializing || seenTemplate) return usage(); seenTemplate = true;
      const value = valueFor(arg, "--template", index);
      if (arg === "--template") index++;
      if (value !== "vanilla-ts") return usage();
      template = value; continue;
    }
    if ((!positional && arg.startsWith("-")) || directory !== undefined || !localArgument(arg)) return usage();
    directory = arg;
  }
  try {
    if (!options || typeof options.cwd !== "string" || !options.cwd) return usage();
    if ((archive || initializing) && directory === undefined) return usage();
    if (initializing && (id === undefined || name === undefined)) return usage();
    const target = resolve(options.cwd, directory ?? ".");
    if (initializing) return reportInit(await initProject(target, { id: id!, name: name!, ...(template ? { template } : {}) }));
    if (packing) return reportPack(await packProject(target, { outDir }));
    const result = archive ? await inspectPackage(target) : await validateProject(target, { stage });
    return report(result, result.valid ? 0 : 1);
  } catch (error) {
    if (error instanceof ProjectError) {
      const attached = (error as ProjectError & { diagnostics?: Diagnostic[] }).diagnostics;
      return reportInvalid(Array.isArray(attached) && attached.length ? attached : [error.diagnostic()], error.kind === "io" ? 2 : 1);
    }
    return failure("E_INTERNAL", "The command could not be completed.", 2);
  }
}

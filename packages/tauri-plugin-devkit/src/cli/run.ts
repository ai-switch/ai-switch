import { resolve } from "node:path";
import { validateProject } from "../project/validate.js";
import { ProjectError } from "../project/errors.js";
import type { ProjectReport } from "../project/types.js";

export interface CliIo { stdout(text: string): void; stderr(text: string): void }
const version = "0.1.0";
const help = `APLG devkit ${version}
Usage:
  aplg validate [directory] [--stage source|dist] [--json]
  aplg --help
  aplg --version

Source validation reads metadata only; it does not run build/install/config code.
Dist validation, init, inspect and pack are not implemented in this development slice.
`;
const line = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Core CLI logic: no process.exit, cwd mutation or implicit project execution. */
export async function runCli(argv: string[], io: CliIo, options: { cwd: string }): Promise<0 | 1 | 2> {
  const json = Array.isArray(argv) && argv.slice(0, argv.indexOf("--") < 0 ? argv.length : argv.indexOf("--")).includes("--json");
  function report(result: ProjectReport, code: 0 | 1 | 2): 0 | 1 | 2 {
    if (json) io.stdout(`${JSON.stringify(result)}\n`);
    if (result.valid) { if (!json) io.stdout(`Valid source project: ${result.manifest.id}@${result.manifest.version}\n`); }
    else for (const diagnostic of result.diagnostics) io.stderr(`${line(diagnostic.code)}${diagnostic.path ? ` ${line(diagnostic.path)}` : ""}: ${line(diagnostic.message)}\n`);
    return code;
  }
  function failure(code: string, message: string, exit: 1 | 2 = 1, path = "") { return report({ valid: false, diagnostics: [{ code, path, message }] }, exit); }
  const usage = () => failure("E_CLI_ARGUMENTS", "Invalid command or options. Use aplg --help for usage.");
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== "string")) return usage();
  if (!argv.length || argv.length === 1 && ["--help", "-h"].includes(argv[0])) { io.stdout(help); return 0; }
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) { io.stdout(`${version}\n`); return 0; }
  if (["init", "inspect", "pack"].includes(argv[0])) return failure("E_COMMAND_UNAVAILABLE", "This command is not implemented in the current development slice.");
  if (argv[0] !== "validate") return usage();
  let directory: string | undefined; let stage: "source" | "dist" = "source";
  let seenStage = false; let seenJson = false; let positional = false;
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (!positional && arg === "--") { positional = true; continue; }
    if (!positional && arg === "--json") { if (seenJson) return usage(); seenJson = true; continue; }
    if (!positional && (arg === "--stage" || arg.startsWith("--stage="))) {
      if (seenStage) return usage(); seenStage = true;
      const value = arg === "--stage" ? argv[++index] : arg.slice("--stage=".length);
      if (value !== "source" && value !== "dist") return usage(); stage = value; continue;
    }
    if ((!positional && arg.startsWith("-")) || directory !== undefined || !arg || /[\u0000-\u001f\u007f]/.test(arg) || /^(?:[a-z]:(?![\\/])|[a-z][a-z0-9+.-]*:\/\/|\\\\[?.]\\)/i.test(arg)) return usage();
    directory = arg;
  }
  try {
    if (!options || typeof options.cwd !== "string" || !options.cwd) return usage();
    const result = await validateProject(resolve(options.cwd, directory ?? "."), { stage });
    return report(result, result.valid ? 0 : 1);
  } catch (error) {
    if (error instanceof ProjectError) return report({ valid: false, diagnostics: [error.diagnostic()] }, error.kind === "io" ? 2 : 1);
    return failure("E_INTERNAL", "The validation command could not be completed.", 2);
  }
}

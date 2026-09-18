import { createRequire, isBuiltin } from "node:module";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";

const publicEntries = [".", "./protocol", "./host", "./plugin", "./node/path", "./node/buffer", "./node/events", "./node/fs", "./node/fs/promises", "./package.json"];
const documents = new Set(["package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]);
const installHooks = ["preinstall", "install", "postinstall", "prepare"];
const fail = (message) => { throw new Error(`Package boundary: ${message}`); };
const within = (parent, child) => {
  const path = relative(parent, child);
  return !!path && !isAbsolute(path) && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\");
};
const forbiddenPackage = (name) => /^(?:@tauri-apps(?:\/|$)|@ai-switch\/|ai-switch$|react(?:-dom|-native)?(?:\/|$)|vue(?:\/|$)|@vue\/|@angular\/|svelte(?:\/|$))/.test(name);
const packageName = (specifier) => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
const portableFile = (name) => typeof name === "string" && !name.includes("\\") && !name.includes(":") && !name.startsWith("/") && name.split("/").every((part) => part && part !== "." && part !== "..");
const declaration = (name) => /\.d\.(?:ts|mts)$/.test(name);
const javascript = (name) => /\.m?js$/.test(name);
const allowedFile = (name) => documents.has(name) || /^dist\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|d\.ts|d\.mts)$/.test(name) || /^dist\/protocol\/schema\/[a-z0-9-]+\.schema\.json$/.test(name);

/** Inspect the actual packed files, ESM/declaration edges and installed production graph.
 * The parser is supplied by the caller's toolchain, never shipped in the runtime.
 * This is a release hygiene check, not a proof that arbitrary plugin code is safe.
 */
export async function checkPackageBoundaries({ packageRoot, files, typescript: ts, sourceRoots = [], dependencyRoot }) {
  const root = await realpath(packageRoot);
  const require = createRequire(join(root, "package.json"));
  ts ??= require("typescript");
  const packed = new Set(files);
  if (packed.size !== files.length || !packed.size) fail("duplicate or empty packed file list");
  const texts = new Map();
  for (const name of files) {
    if (!portableFile(name) || !allowedFile(name)) fail(`file is not on the allowlist: ${name}`);
    const path = resolve(root, name);
    if (!within(root, path) || !(await lstat(path)).isFile() || !within(root, await realpath(path))) fail(`non-regular or escaped file: ${name}`);
    const text = await readFile(path, "utf8");
    if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|npm_[A-Za-z0-9]{30,})/.test(text)) fail(`secret/private key in ${name}`);
    const normalized = text.replaceAll("\\\\", "/").replaceAll("\\", "/").toLowerCase();
    if (sourceRoots.some((source) => normalized.includes(resolve(source).replaceAll("\\", "/").toLowerCase()))) fail(`absolute source path in ${name}`);
    if (/(?:["'\s])(?:[a-z]:\/|\/(?:home|users|build|workspace|runner)\/)[^\n"']*\/src\//i.test(normalized)) fail(`absolute build source path in ${name}`);
    texts.set(name, text);
  }
  for (const name of documents) if (!packed.has(name)) fail(`required file missing: ${name}`);
  const metadata = JSON.parse(texts.get("package.json"));
  if (metadata.name !== "@ai-switch/tauri-plugin-runtime" || metadata.type !== "module" || metadata.sideEffects !== false || metadata.publishConfig?.access !== "public") fail("unexpected runtime package metadata");
  if (JSON.stringify([...(metadata.files ?? [])].sort()) !== JSON.stringify(["dist", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"].sort())) fail("package files allowlist changed");
  if (metadata.bin || metadata.imports || metadata.typesVersions || metadata.bundleDependencies || metadata.bundledDependencies) fail("unexpected package indirection or bundled dependencies");
  for (const hook of installHooks) if (metadata.scripts?.[hook]) fail(`install lifecycle script: ${hook}`);
  if (JSON.stringify(Object.keys(metadata.exports ?? {}).sort()) !== JSON.stringify([...publicEntries].sort())) fail("unexpected public export map");
  const jsEntries = []; const typeEntries = [];
  for (const [name, target] of Object.entries(metadata.exports)) {
    if (name === "./package.json") { if (target !== "./package.json") fail("package.json export mismatch"); continue; }
    if (!target || typeof target !== "object" || JSON.stringify(Object.keys(target)) !== '["types","import"]') fail(`export conditions must be types/import only: ${name}`);
    for (const [kind, value] of Object.entries(target)) {
      if (typeof value !== "string" || !value.startsWith("./dist/") || !packed.has(value.slice(2)) || (kind === "types" ? !declaration(value) : !javascript(value))) fail(`missing or unsafe ${kind} export/declaration: ${name}`);
    }
    jsEntries.push(target.import.slice(2)); typeEntries.push(target.types.slice(2));
  }
  if (new Set(jsEntries).size !== jsEntries.length || new Set(typeEntries).size !== typeEntries.length) fail("public entries alias one another");
  for (const kind of ["main", "module", "types"]) {
    if (metadata[kind] && !Object.values(metadata.exports["."]).includes(metadata[kind])) fail(`legacy ${kind} disagrees with exports`);
  }

  const dependencies = new Set(); const visited = new Set();
  const direct = { ...metadata.dependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies };
  async function visitDependencies(parent, entries) {
    for (const [name, version] of Object.entries(entries)) {
      if (forbiddenPackage(name) || (isBuiltin(name) && !["buffer", "events"].includes(name))) fail(`forbidden dependency: ${name}`);
      // Runtime production dependencies are pinned registry packages, not local/git installs.
      if (typeof version !== "string" || !/^[~^]?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) fail(`non-registry dependency: ${name}@${version}`);
      let path;
      try { path = createRequire(join(parent, "package.json")).resolve(`${name}/package.json`); }
      catch { fail(`unresolved dependency: ${name}`); }
      path = await realpath(path);
      if (dependencyRoot && !within(await realpath(dependencyRoot), path)) fail(`dependency resolves outside the consumer: ${name}`);
      if (visited.has(path)) continue;
      visited.add(path);
      const child = JSON.parse(await readFile(path, "utf8"));
      if (child.name !== name || forbiddenPackage(child.name)) fail(`dependency name mismatch: ${name}`);
      if (installHooks.some((hook) => child.scripts?.[hook])) fail(`dependency install lifecycle script: ${name}`);
      dependencies.add(`${name}@${child.version}`);
      await visitDependencies(dirname(path), { ...child.dependencies, ...child.optionalDependencies, ...child.peerDependencies });
    }
  }
  await visitDependencies(root, direct);

  function resolveImport(from, specifier, isType) {
    if (typeof specifier !== "string" || !specifier) fail(`computed import in ${from}`);
    if (specifier.startsWith(".")) {
      const target = posix.normalize(posix.join(posix.dirname(from), specifier));
      if (!target.startsWith("dist/") || specifier.includes("\\") || specifier.includes(":")) fail(`escaped import in ${from}: ${specifier}`);
      const candidates = isType ? [target.replace(/\.js$/, ".d.ts").replace(/\.mjs$/, ".d.mts"), target] : [target];
      const match = candidates.find((candidate) => packed.has(candidate) && (isType ? declaration(candidate) || candidate.endsWith(".json") : javascript(candidate)));
      if (!match) fail(`unresolved ${isType ? "declaration" : "module"} import in ${from}: ${specifier}`);
      return match;
    }
    // All browser JS is bundled. Bare imports are permitted only for public
    // declarations backed by an explicitly installed production dependency.
    if (!isType || isBuiltin(specifier) || specifier.startsWith("node:") || forbiddenPackage(packageName(specifier)) || !Object.hasOwn(direct, packageName(specifier))) fail(`forbidden ${isType ? "declaration" : "module"} import in ${from}: ${specifier}`);
    try { require.resolve(specifier); } catch { fail(`unresolved declaration import in ${from}: ${specifier}`); }
    return null;
  }
  const graph = new Map();
  for (const [name, text] of texts) {
    const isType = declaration(name);
    if (!javascript(name) && !isType) continue;
    const parsed = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, isType ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    if (parsed.parseDiagnostics.length) fail(`unparseable module: ${name}`);
    const edges = new Set();
    const add = (specifier) => { const target = resolveImport(name, specifier, isType); if (target) edges.add(target); };
    function walk(node) {
      if ((ts.isIdentifier(node) && node.text === "require") || ts.isImportEqualsDeclaration(node)) fail(`CommonJS require/module access in ${name}`);
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "require") fail(`CommonJS module import in ${name}`);
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) add(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null);
      if (ts.isImportTypeNode(node)) add(ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal) ? node.argument.literal.text : null);
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null);
        // esbuild may declare a zero-argument __require wrapper; invoking a
        // dynamic require with arguments is still a forbidden runtime import.
        if (ts.isIdentifier(node.expression) && node.expression.text === "__require" && node.arguments.length) fail(`CommonJS module import in ${name}`);
      }
      ts.forEachChild(node, walk);
    }
    walk(parsed);
    if (isType) {
      for (const ref of parsed.referencedFiles) add(ref.fileName.startsWith(".") ? ref.fileName : `./${ref.fileName}`);
      for (const ref of parsed.typeReferenceDirectives) add(ref.fileName);
    }
    if (name === metadata.exports["."].import.slice(2)) {
      const allowed = new Set(["apiVersion", "protocolVersion"]);
      for (const node of parsed.statements) {
        if (ts.isExportDeclaration(node) && (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some((item) => !allowed.has(item.name.text)))) fail("root must not aggregate capability/host APIs");
        if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
          if (!ts.isVariableStatement(node) || node.declarationList.declarations.some((item) => !ts.isIdentifier(item.name) || !allowed.has(item.name.text))) fail("root exports versions only");
        }
      }
    }
    graph.set(name, edges);
  }
  const reached = new Set();
  function visit(name) { if (reached.has(name)) return; reached.add(name); for (const edge of graph.get(name) ?? []) visit(edge); }
  visit(metadata.exports["."].import.slice(2));
  if (jsEntries.slice(1).some((entry) => reached.has(entry))) fail("root must not import capability/host entries");
  // The version root may share tiny constants/helpers, not the validator/client
  // dependency graph. This budget also catches aggregation hidden in a chunk.
  if ([...reached].reduce((bytes, name) => bytes + Buffer.byteLength(texts.get(name) ?? ""), 0) > 16384) fail("root import graph aggregates runtime code instead of versions");
  for (const entry of jsEntries) visit(entry);
  for (const name of files) if (javascript(name) && !reached.has(name)) fail(`unreachable/stale JS artifact: ${name}`);
  return { files: files.length, javascriptFiles: [...reached].filter(javascript).length, dependencies: [...dependencies].sort() };
}

/** Catch accidental app/framework imports before bundling can erase their names. */
export function checkBuildGraph(metafile) {
  const browserPackages = new Set(["buffer", "base64-js", "ieee754", "events", "path-browserify", "semver", "ajv", "fast-deep-equal"]);
  for (const [input, info] of Object.entries(metafile.inputs)) {
    const path = input.replaceAll("\\", "/");
    if (!path.startsWith("src/") || path.split("/").includes("..")) {
      const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*\/node_modules\/)/.exec(path);
      if (!match || !browserPackages.has(match[1])) fail(`forbidden bundled input/dependency: ${path}`);
    }
    for (const edge of info.imports) {
      if (edge.external || !Object.hasOwn(metafile.inputs, edge.path)) fail(`external/unresolved build import: ${edge.path}`);
    }
  }
  for (const output of Object.values(metafile.outputs)) {
    if (output.imports.some((edge) => edge.external)) fail("external import in browser output");
  }
}
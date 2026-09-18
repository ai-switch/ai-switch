import { parseSync } from "vite";

interface AstNode { type: string; [key: string]: unknown }
interface Scope { parent?: Scope; names: Set<string>; function: boolean }
const node = (value: unknown): value is AstNode => value !== null && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
const child = (value: unknown): AstNode | undefined => node(value) ? value : undefined;
const nodes = (value: unknown): AstNode[] => Array.isArray(value) ? value.filter(node) : [];
const typeOnly = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSDeclareFunction", "TSImportType"]);
const functions = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const globals = new Set(["process", "Buffer", "global", "__dirname", "__filename"]);
const string = (value: unknown): string | undefined => node(value) && value.type === "Literal" && typeof value.value === "string" ? value.value : undefined;
const fail = (code: string, message: string): never => { throw new Error(`${code}: ${message}`); };

/** Inspect syntax, not text replacement. Local bindings and property names are not
 * Node globals. This intentionally does not evaluate computed code or provide a sandbox.
 */
export function checkNodeUsage(code: string, id: string, checkImport: (source: string) => void): void {
  if (Buffer.byteLength(code) > 16 * 1024 * 1024) fail("APLG_SOURCE_LIMIT", "A JS/TS module exceeds 16 MiB.");
  const parsed = parseSync(id, code);
  if (parsed.errors.length) fail("APLG_SOURCE_PARSE", "The plugin module could not be parsed.");
  const program = parsed.program as unknown as AstNode;
  const scopes = new WeakMap<AstNode, Scope>(); const bindings = new WeakSet<AstNode>();
  function each(current: AstNode, visit: (child: AstNode, key: string) => void) {
    for (const [key, value] of Object.entries(current)) {
      // Re-export names denote another module, not a read of a local/global.
      if (key === "specifiers" && current.type === "ExportNamedDeclaration" && (current.source || current.exportKind === "type")) continue;
      if (["typeAnnotation", "typeArguments", "typeParameters", "returnType"].includes(key)) continue;
      if (node(value)) visit(value, key); else if (Array.isArray(value)) for (const item of value) if (node(item)) visit(item, key);
    }
  }
  function bind(pattern: AstNode | undefined, scope: Scope) {
    if (!pattern) return;
    if (pattern.type === "Identifier") { scope.names.add(String(pattern.name)); bindings.add(pattern); }
    else if (pattern.type === "RestElement") bind(child(pattern.argument), scope);
    else if (pattern.type === "AssignmentPattern") bind(child(pattern.left), scope);
    else if (pattern.type === "ArrayPattern") for (const element of nodes(pattern.elements)) bind(element, scope);
    else if (pattern.type === "ObjectPattern") for (const property of nodes(pattern.properties)) bind(child(property.type === "RestElement" ? property.argument : property.value), scope);
  }
  function collect(current: AstNode, parent: Scope) {
    if (typeOnly.has(current.type) || current.declare === true) return;
    let scope = parent;
    if (current.type === "FunctionDeclaration" || current.type === "ClassDeclaration") bind(child(current.id), parent);
    if (functions.has(current.type) || ["BlockStatement", "SwitchStatement", "StaticBlock", "CatchClause", "ForStatement", "ForOfStatement", "ForInStatement", "ClassExpression", "ClassDeclaration"].includes(current.type)) {
      scope = { parent, names: new Set(), function: functions.has(current.type) };
      if (functions.has(current.type)) { bind(child(current.id), scope); for (const param of nodes(current.params)) bind(param, scope); }
      if (current.type === "CatchClause") bind(child(current.param), scope);
      if (current.type.startsWith("Class")) bind(child(current.id), scope);
    }
    scopes.set(current, scope);
    if (current.type === "VariableDeclaration") {
      let destination = scope;
      if (current.kind === "var") while (!destination.function && destination.parent) destination = destination.parent;
      for (const declaration of nodes(current.declarations)) bind(child(declaration.id), destination);
    }
    if (current.type === "ImportDeclaration" && current.importKind !== "type") for (const specifier of nodes(current.specifiers)) if (specifier.importKind !== "type") bind(child(specifier.local), scope);
    each(current, (value) => collect(value, scope));
  }
  collect(program, { names: new Set(), function: true });
  function bound(name: string, scope: Scope | undefined): boolean { return !!scope && (scope.names.has(name) || bound(name, scope.parent)); }
  function reference(current: AstNode, parent: AstNode | undefined, key: string): boolean {
    if (bindings.has(current) || !parent) return false;
    if ((parent.type === "MemberExpression" || parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && (key === "property" || key === "key") && !parent.computed) return false;
    if ((parent.type.startsWith("Import") && parent.type !== "ImportExpression") || parent.type === "ExportSpecifier" && (key === "exported" || parent.exportKind === "type") || ["LabeledStatement", "BreakStatement", "ContinueStatement"].includes(parent.type)) return false;
    return true;
  }
  function visit(current: AstNode, parent?: AstNode, key = "") {
    if (typeOnly.has(current.type) || current.declare === true) return;
    const scope = scopes.get(current)!;
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(current.type)) {
      const source = string(current.source);
      if (source !== undefined && current.importKind !== "type" && current.exportKind !== "type") checkImport(source);
    }
    if (current.type === "TSImportEqualsDeclaration") fail("APLG_DYNAMIC_REQUIRE", "Use ESM imports for plugin Node adapters.");
    if (current.type === "Identifier" && reference(current, parent, key) && !bound(String(current.name), scope)) {
      if (globals.has(String(current.name))) fail("APLG_UNSUPPORTED_NODE_GLOBAL", `Import the supported adapter instead of using global ${String(current.name)}.`);
      if (current.name === "require") {
        const specifier = parent?.type === "CallExpression" && key === "callee" && Array.isArray(parent.arguments) && parent.arguments.length === 1 ? string(parent.arguments[0]) : undefined;
        if (specifier === undefined) fail("APLG_DYNAMIC_REQUIRE", "Computed or aliased require is not supported.");
        else checkImport(specifier);
      }
    }
    if (current.type === "VariableDeclarator" || current.type === "AssignmentExpression") {
      const pattern = child(current.type === "VariableDeclarator" ? current.id : current.left);
      const from = child(current.type === "VariableDeclarator" ? current.init : current.right);
      if (pattern?.type === "ObjectPattern" && from?.type === "Identifier" && ["globalThis", "window", "self", "global"].includes(String(from.name)) && !bound(String(from.name), scope)) {
        for (const property of nodes(pattern.properties)) {
          const name = property.computed ? string(property.key) : String(child(property.key)?.name ?? string(property.key) ?? "");
          if (name && globals.has(name)) fail("APLG_UNSUPPORTED_NODE_GLOBAL", "Destructuring Node globals does not provide a browser adapter.");
          if (name === "require") fail("APLG_DYNAMIC_REQUIRE", "Host require is not available to plugin code.");
        }
      }
    }
    if (current.type === "MemberExpression") {
      const object = child(current.object);
      const property = current.computed ? string(current.property) : String(child(current.property)?.name ?? "");
      if (object?.type === "Identifier" && !bound(String(object.name), scope)) {
        if (["globalThis", "window", "self", "global"].includes(String(object.name)) && property && globals.has(property)) fail("APLG_UNSUPPORTED_NODE_GLOBAL", "Node globals are not provided on the plugin window.");
        if (["module", "globalThis", "window", "self"].includes(String(object.name)) && property === "require") fail("APLG_DYNAMIC_REQUIRE", "Host require is not available to plugin code.");
      }
    }
    each(current, (value, key) => visit(value, current, key));
  }
  visit(program);
}

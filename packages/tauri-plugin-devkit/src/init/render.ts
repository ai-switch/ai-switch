import { promises as fs } from "node:fs";

export interface InitRenderOptions {
  id: string;
  name: string;
}
export interface RenderedTemplateFile {
  path: string;
  bytes: Uint8Array;
}

const bundledModule = /\/dist\/[^/]+\.js(?:$|[?#])/.test(import.meta.url);
const templateRoot = new URL(bundledModule ? "../templates/vanilla-ts/" : "../../templates/vanilla-ts/", import.meta.url);
const githubRoot = new URL(bundledModule ? "../templates/github/" : "../../templates/github/", import.meta.url);
const templateRoots = [templateRoot];
const githubRoots = [githubRoot];
const sources: { path: string; source?: string; roots: URL[] }[] = [
  { path: "package.json", roots: templateRoots },
  { path: "aplg.json", roots: templateRoots },
  { path: "index.html", roots: templateRoots },
  { path: "src/main.ts", roots: templateRoots },
  { path: "src/styles.css", roots: templateRoots },
  { path: "src/example.js", roots: templateRoots },
  { path: "tests/example.test.mjs", roots: templateRoots },
  { path: "tsconfig.json", roots: templateRoots },
  { path: "tsconfig.node.json", roots: templateRoots },
  { path: "vite.config.ts", roots: templateRoots },
  { path: "README.md", roots: templateRoots },
  { path: "LICENSE", roots: templateRoots },
  { path: ".gitignore", source: "gitignore", roots: templateRoots },
  { path: ".github/workflows/ci.yml", roots: githubRoots },
];
const tokenPattern = /__APLG_[A-Z0-9_]+__/g;
const htmlEscape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]!));
const markdownEscape = (value: string) => htmlEscape(value).replace(/[\`*_[\]{}()#+.!|>~-]/g, "\\$&");
const packageName = (id: string) => `aplg-plugin-${id.replaceAll(".", "-")}`;

function replacements(options: InitRenderOptions): Map<string, string> {
  const description = `${options.name} APLG plugin`;
  return new Map([
    ["__APLG_ID_JSON__", JSON.stringify(options.id)],
    ["__APLG_ID_TEXT__", markdownEscape(options.id)],
    ["__APLG_NAME_JSON__", JSON.stringify(options.name)],
    ["__APLG_NAME_HTML__", htmlEscape(options.name)],
    ["__APLG_NAME_TEXT__", markdownEscape(options.name)],
    ["__APLG_DESCRIPTION_JSON__", JSON.stringify(description)],
    ["__APLG_PACKAGE_NAME_JSON__", JSON.stringify(packageName(options.id))],
  ]);
}

/** Read and render only the checked-in built-in template; never evaluate it. */
export async function renderVanillaTs(options: InitRenderOptions): Promise<RenderedTemplateFile[]> {
  const values = replacements(options);
  const rendered: RenderedTemplateFile[] = [];
  for (const source of sources) {
    let text: string | undefined;
    let lastError: unknown;
    for (const root of source.roots) {
      try { text = await fs.readFile(new URL(source.source ?? (source.path.startsWith(".github/") ? "ci.yml" : source.path), root), "utf8"); lastError = undefined; break; }
      catch (error) { lastError = error; }
    }
    if (lastError !== undefined || text === undefined) throw new Error(`Template file could not be read: ${source.path}`);
    for (const [token, value] of values) text = text.split(token).join(value);
    if (tokenPattern.test(text)) {
      tokenPattern.lastIndex = 0;
      throw new Error(`Template file contains an unresolved placeholder: ${source.path}`);
    }
    tokenPattern.lastIndex = 0;
    rendered.push({ path: source.path, bytes: Buffer.from(text, "utf8") });
  }
  return rendered.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

export const vanillaTsTemplateFiles = Object.freeze(sources.map((source) => source.path).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));

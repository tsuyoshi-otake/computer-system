import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const sourceRoot = path.join(root, "src");
const layers = ["domain", "application", "adapters"] as const;

describe("architecture dependency boundaries", (): void => {
  it("keeps dependencies pointed toward stable inner layers", async (): Promise<void> => {
    const files = await layerFiles();
    const violations: string[] = [];

    for (const file of files) {
      const layer = relativeLayer(file);
      const imports = extractRelativeImports(await readFile(file, "utf8"));
      for (const specifier of imports) {
        const target = path.resolve(path.dirname(file), specifier);
        const targetLayer = relativeLayer(target);
        if (layer === "domain" && targetLayer !== "domain") {
          violations.push(`${relative(file)} imports ${specifier}`);
        }
        if (layer === "application" && targetLayer === "adapters") {
          violations.push(`${relative(file)} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("contains no relative import cycles in Phase 1 layers", async (): Promise<void> => {
    const files = await layerFiles();
    const known = new Set(files.map(normalize));
    const graph = new Map<string, string[]>();

    for (const file of files) {
      const imports = extractRelativeImports(await readFile(file, "utf8"))
        .map((specifier) => resolveTypeScript(file, specifier))
        .filter(
          (target): target is string =>
            target !== undefined && known.has(target),
        );
      graph.set(normalize(file), imports);
    }

    expect(findCycle(graph)).toBeUndefined();
  });
});

async function layerFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const layer of layers) {
    const directory = path.join(sourceRoot, layer);
    try {
      await walk(directory, found);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return found.filter((file) => file.endsWith(".ts"));
}

async function walk(directory: string, found: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(target, found);
    else found.push(target);
  }
}

function extractRelativeImports(source: string): string[] {
  return [...source.matchAll(/from\s+["'](\.[^"']+)["']/gu)].map(
    (match) => match[1]!,
  );
}

function resolveTypeScript(
  file: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = path.resolve(path.dirname(file), specifier);
  return normalize(resolved.replace(/\.js$/u, ".ts"));
}

function relativeLayer(file: string): string | undefined {
  const [layer] = path.relative(sourceRoot, file).split(path.sep);
  return layers.includes(layer as (typeof layers)[number]) ? layer : undefined;
}

function findCycle(
  graph: ReadonlyMap<string, readonly string[]>,
): string[] | undefined {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): string[] | undefined => {
    if (active.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node].map(relative);
    }
    if (visited.has(node)) return undefined;
    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const target of graph.get(node) ?? []) {
      const cycle = visit(target);
      if (cycle !== undefined) return cycle;
    }
    stack.pop();
    active.delete(node);
    return undefined;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}

function normalize(file: string): string {
  return path.normalize(file).toLowerCase();
}

function relative(file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

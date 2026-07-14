import {
  validateCs486Executable,
  type Cs486Executable,
} from "../../domain/cpu/cs486.js";
import {
  validateCs486Object,
  type Cs486Object,
} from "../../domain/cpu/cs486Object.js";
import { assembleCs486, assembleCs486Object } from "./cs486Assembler.js";

export class Cs486LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkError";
  }
}

export interface Cs486LinkOptions {
  readonly entry?: string;
}

const maximumObjects = 64;
const maximumLinkedAssemblyCharacters = 512_000;

export function linkCs486Objects(
  objects: readonly Cs486Object[],
  options: Cs486LinkOptions = {},
): Cs486Executable {
  if (objects.length === 0) throw new Cs486LinkError("no input objects");
  if (objects.length > maximumObjects)
    throw new Cs486LinkError("object limit exceeded");
  objects.forEach(verifyObjectIntegrity);

  const definitions = new Map<
    string,
    { readonly objectIndex: number; readonly offset: number }
  >();
  for (const [objectIndex, object] of objects.entries()) {
    for (const symbol of object.symbols) {
      if (symbol.binding !== "global") continue;
      if (definitions.has(symbol.name))
        throw new Cs486LinkError(`duplicate symbol ${symbol.name}`);
      definitions.set(symbol.name, {
        objectIndex,
        offset: symbol.offset ?? 0,
      });
    }
  }
  for (const object of objects) {
    for (const symbol of object.symbols) {
      if (symbol.binding === "undefined" && !definitions.has(symbol.name))
        throw new Cs486LinkError(`unresolved symbol ${symbol.name}`);
    }
  }

  const entry =
    options.entry ??
    ["main", "_start", "basic_main"].find((name) => definitions.has(name));
  if (entry === undefined || !definitions.has(entry))
    throw new Cs486LinkError(
      entry === undefined
        ? "entry symbol is required"
        : `unresolved entry ${entry}`,
    );

  const assembly = [`call ${entry}`, "halt"];
  const instructionBases: number[] = [];
  let dataBase = 0;
  for (const [objectIndex, object] of objects.entries()) {
    instructionBases.push(countInstructions(assembly));
    assembly.push(...materialize(object, objectIndex, dataBase));
    dataBase += align4(object.dataBytes);
  }
  const source = assembly.join("\n");
  if (source.length > maximumLinkedAssemblyCharacters)
    throw new Cs486LinkError("linked assembly limit exceeded");
  let executable: Cs486Executable;
  try {
    executable = assembleCs486(source);
  } catch (error: unknown) {
    throw new Cs486LinkError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const symbols = [...definitions]
    .map(([name, definition]) => ({
      address: instructionBases[definition.objectIndex]! + definition.offset,
      name,
    }))
    .sort(
      (left, right) =>
        left.address - right.address || left.name.localeCompare(right.name),
    );
  const linked: Cs486Executable = {
    ...executable,
    dataBytes: dataBase,
    symbols,
  };
  validateCs486Executable(linked);
  return linked;
}

function materialize(
  object: Cs486Object,
  objectIndex: number,
  dataBase: number,
): string[] {
  const localNames = new Set(
    object.symbols
      .filter((symbol) => symbol.binding === "local")
      .map((symbol) => symbol.name),
  );
  const localName = (name: string): string =>
    localNames.has(name) ? `__o${String(objectIndex)}_${name}` : name;
  return object.assembly.split("\n").map((raw) => {
    let line = raw;
    const label = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/u.exec(line);
    if (label !== null) line = `${localName(label[1]!)}:${label[2] ?? ""}`;
    line = line.replace(
      /^(\s*(?:jmp|je|jne|jl|jle|jg|jge|call)\s+)([A-Za-z_][A-Za-z0-9_]*)\s*$/iu,
      (_match, prefix: string, target: string) =>
        `${prefix}${localName(target)}`,
    );
    return line.replace(
      /\[\s*(-?(?:0x[0-9a-f]+|\d+))\s*\]/giu,
      (_match, address: string) => `[${String(Number(address) + dataBase)}]`,
    );
  });
}

function countInstructions(lines: readonly string[]): number {
  return lines.filter((line) => {
    const text = line.trim();
    return text.length > 0 && !text.endsWith(":");
  }).length;
}

function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function verifyObjectIntegrity(object: Cs486Object): void {
  validateCs486Object(object);
  const directives = object.symbols.flatMap((symbol) =>
    symbol.binding === "global"
      ? [`global ${symbol.name}`]
      : symbol.binding === "undefined"
        ? [`extern ${symbol.name}`]
        : [],
  );
  let canonical: Cs486Object;
  try {
    canonical = assembleCs486Object(
      [...directives, object.assembly].join("\n"),
      {
        dataBytes: object.dataBytes,
        language: object.language,
      },
    );
  } catch (error: unknown) {
    throw new Cs486LinkError(
      `invalid object metadata: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    canonical.assembly !== object.assembly ||
    canonical.dataBytes !== object.dataBytes ||
    stableSymbols(canonical) !== stableSymbols(object) ||
    JSON.stringify(canonical.relocations) !== JSON.stringify(object.relocations)
  )
    throw new Cs486LinkError("invalid object metadata");
}

function stableSymbols(object: Cs486Object): string {
  return JSON.stringify(
    [...object.symbols].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.binding.localeCompare(right.binding),
    ),
  );
}

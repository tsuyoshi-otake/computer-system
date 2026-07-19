import {
  createCs486Flat32MemoryMetadata,
  validateCs486Executable,
  type Cs486ExecutableV3,
  type Cs486FunctionSignature,
  type Cs486Instruction,
} from "../../domain/cpu/cs486.js";
import {
  cs486ObjectDataAlignment,
  cs486RelocationAcceptsSection,
  isCs486ObjectV2,
  objectSection,
  validateCs486Object,
  type Cs486Object,
  type Cs486ObjectRelocation,
  type Cs486ObjectSection,
  type Cs486ObjectSymbol,
  type Cs486RelocationField,
} from "../../domain/cpu/cs486Object.js";
import { assembleCs486Object, objectDataLayout } from "./cs486Assembler.js";

export class Cs486LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkError";
  }
}

export interface Cs486LinkOptions {
  readonly entry?: string;
}

interface CanonicalObject extends Cs486Object {
  readonly sections: readonly Cs486ObjectSection[];
  readonly version: 2;
}

interface Definition {
  readonly objectIndex: number;
  readonly symbol: Cs486ObjectSymbol & { readonly offset: number };
}

const maximumObjects = 64;
const maximumDataBytes = 16 * 1_048_576;
const maximumInitializedDataBytes = 256_000;
const maximumLinkedInstructions = 4_096;

export function linkCs486Objects(
  objects: readonly Cs486Object[],
  options: Cs486LinkOptions = {},
): Cs486ExecutableV3 {
  if (objects.length === 0) throw new Cs486LinkError("no input objects");
  if (objects.length > maximumObjects)
    throw new Cs486LinkError("object limit exceeded");
  const canonical = objects.map(normalizeObject);
  const definitions = collectGlobalDefinitions(canonical);
  const localDefinitions = collectObjectDefinitions(canonical);
  verifyUndefinedSymbols(canonical, definitions);
  verifyFunctionSignatures(canonical);

  const entryName =
    options.entry ??
    ["main", "_start", "basic_main"].find((name) => definitions.has(name));
  if (entryName === undefined)
    throw new Cs486LinkError("entry symbol is required");
  const entry = definitions.get(entryName);
  if (entry === undefined)
    throw new Cs486LinkError(`unresolved entry ${entryName}`);
  if (entry.symbol.section !== "text")
    throw new Cs486LinkError(`entry ${entryName} is not a text symbol`);

  const textBases: number[] = [];
  let textCursor = 2;
  for (const object of canonical) {
    textBases.push(textCursor);
    textCursor += objectSection(object, "text").instructions.length;
    if (textCursor > maximumLinkedInstructions)
      throw new Cs486LinkError("linked instruction limit exceeded");
  }
  const dataBases: number[] = [];
  let dataBytes = 0;
  let initializedDataBytes = 0;
  for (const object of canonical) {
    dataBytes = align(dataBytes, cs486ObjectDataAlignment(object));
    dataBases.push(dataBytes);
    dataBytes += object.dataBytes;
    if (dataBytes > maximumDataBytes)
      throw new Cs486LinkError("linked data limit exceeded");
    initializedDataBytes += objectInitializedDataLength(object);
    if (initializedDataBytes > maximumInitializedDataBytes)
      throw new Cs486LinkError("linked initialized data limit exceeded");
  }
  const layouts = canonical.map((object) => objectDataLayout(object));

  const instructions: Cs486Instruction[] = [
    { op: "call", target: textBases[entry.objectIndex]! + entry.symbol.offset },
    { op: "halt" },
  ];
  const initialData: { bytes: number[]; offset: number }[] = [];
  for (const [objectIndex, object] of canonical.entries()) {
    const dataBase = dataBases[objectIndex]!;
    const layout = layouts[objectIndex]!;
    const objectInstructions = objectSection(object, "text").instructions.map(
      (instruction) => relocateNumericDataAddress(instruction, dataBase),
    );
    const objectData = [...layout.initialData];
    for (const relocation of object.relocations) {
      const definition = resolveSymbol(
        localDefinitions,
        definitions,
        objectIndex,
        relocation.symbol,
      );
      if (
        !cs486RelocationAcceptsSection(
          relocation.type,
          definition.symbol.section,
        )
      )
        throw new Cs486LinkError(
          `relocation ${relocation.type} cannot reference ${definition.symbol.section} symbol ${relocation.symbol}`,
        );
      const value =
        definition.symbol.section === "text"
          ? textBases[definition.objectIndex]! +
            definition.symbol.offset +
            (relocation.addend ?? 0)
          : dataBases[definition.objectIndex]! +
            layouts[definition.objectIndex]!.bases[definition.symbol.section] +
            definition.symbol.offset +
            (relocation.addend ?? 0);
      applyObjectRelocation(
        objectInstructions,
        objectData,
        layout.bases,
        relocation,
        value,
      );
    }
    instructions.push(...objectInstructions);
    if (objectData.length > 0)
      initialData.push({ bytes: objectData, offset: dataBase });
  }

  const symbols = [...definitions]
    .map(([name, definition]) => ({
      address:
        definition.symbol.section === "text"
          ? textBases[definition.objectIndex]! + definition.symbol.offset
          : dataBases[definition.objectIndex]! +
            layouts[definition.objectIndex]!.bases[definition.symbol.section] +
            definition.symbol.offset,
      ...(definition.symbol.functionSignature === undefined
        ? {}
        : { functionSignature: definition.symbol.functionSignature }),
      name,
      section: definition.symbol.section,
      type: definition.symbol.type,
    }))
    .sort(
      (left, right) =>
        left.address - right.address || left.name.localeCompare(right.name),
    );
  const linked: Cs486ExecutableV3 = {
    dataBytes,
    format: "cs486-executable",
    initialData,
    instructions,
    memory: createCs486Flat32MemoryMetadata(),
    symbols,
    version: 3,
  };
  try {
    validateCs486Executable(linked);
  } catch (error: unknown) {
    throw new Cs486LinkError(
      `invalid linked executable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return linked;
}

function normalizeObject(object: Cs486Object): CanonicalObject {
  try {
    validateCs486Object(object);
  } catch (error: unknown) {
    throw invalidMetadata(error);
  }
  if (isCs486ObjectV2(object)) return verifyV2Integrity(object);
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
    throw invalidMetadata(error);
  }
  if (
    !isCs486ObjectV2(canonical) ||
    canonical.dataBytes !== object.dataBytes ||
    stableLegacySymbols(canonical) !== stableLegacySymbols(object) ||
    stableLegacyRelocations(canonical) !== stableLegacyRelocations(object)
  )
    throw new Cs486LinkError("invalid object metadata");
  return canonical;
}

function verifyV2Integrity(object: CanonicalObject): CanonicalObject {
  let canonical: Cs486Object | undefined;
  let failure: unknown;
  for (const dialect of ["linux", "dos"] as const) {
    try {
      canonical = assembleCs486Object(object.assembly, {
        dataBytes: object.dataBytes,
        dialect,
        language: object.language,
      });
      break;
    } catch (error: unknown) {
      failure = error;
    }
  }
  if (
    canonical === undefined ||
    !isCs486ObjectV2(canonical) ||
    canonical.dataBytes !== object.dataBytes ||
    stableV2Sections(canonical) !== stableV2Sections(object) ||
    stableV2Symbols(canonical) !== stableV2Symbols(object) ||
    stableV2Relocations(canonical) !== stableV2Relocations(object)
  )
    throw invalidMetadata(failure ?? "canonical object mismatch");
  return canonical;
}

function collectGlobalDefinitions(
  objects: readonly CanonicalObject[],
): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  for (const [objectIndex, object] of objects.entries()) {
    for (const symbol of object.symbols) {
      if (symbol.binding !== "global" || symbol.offset === undefined) continue;
      if (definitions.has(symbol.name))
        throw new Cs486LinkError(`duplicate symbol ${symbol.name}`);
      definitions.set(symbol.name, {
        objectIndex,
        symbol: symbol as Cs486ObjectSymbol & { readonly offset: number },
      });
    }
  }
  return definitions;
}

function collectObjectDefinitions(
  objects: readonly CanonicalObject[],
): readonly ReadonlyMap<string, Definition>[] {
  return objects.map((object, objectIndex) => {
    const definitions = new Map<string, Definition>();
    for (const symbol of object.symbols) {
      if (symbol.binding === "undefined" || symbol.offset === undefined)
        continue;
      definitions.set(symbol.name, {
        objectIndex,
        symbol: symbol as Cs486ObjectSymbol & { readonly offset: number },
      });
    }
    return definitions;
  });
}

function verifyUndefinedSymbols(
  objects: readonly CanonicalObject[],
  definitions: ReadonlyMap<string, Definition>,
): void {
  for (const object of objects) {
    for (const symbol of object.symbols) {
      if (symbol.binding !== "undefined") continue;
      const definition = definitions.get(symbol.name);
      if (definition === undefined)
        throw new Cs486LinkError(`unresolved symbol ${symbol.name}`);
      if (symbol.type === "object" && definition.symbol.section === "text")
        throw new Cs486LinkError(`symbol type mismatch ${symbol.name}`);
      if (symbol.type === "function" && definition.symbol.section !== "text")
        throw new Cs486LinkError(`symbol type mismatch ${symbol.name}`);
    }
  }
}

function verifyFunctionSignatures(objects: readonly CanonicalObject[]): void {
  const signatures = new Map<string, Cs486FunctionSignature>();
  for (const object of objects) {
    for (const symbol of object.symbols) {
      if (symbol.binding === "local" || symbol.functionSignature === undefined)
        continue;
      const existing = signatures.get(symbol.name);
      if (existing !== undefined && existing !== symbol.functionSignature)
        throw new Cs486LinkError(
          `function signature mismatch ${symbol.name}: expected ${existing}, found ${symbol.functionSignature}`,
        );
      signatures.set(symbol.name, symbol.functionSignature);
    }
  }
}

function resolveSymbol(
  localDefinitions: readonly ReadonlyMap<string, Definition>[],
  definitions: ReadonlyMap<string, Definition>,
  objectIndex: number,
  name: string,
): Definition {
  const local = localDefinitions[objectIndex]!.get(name);
  if (local !== undefined) return local;
  const external = definitions.get(name);
  if (external === undefined)
    throw new Cs486LinkError(`unresolved symbol ${name}`);
  return external;
}

function applyObjectRelocation(
  instructions: Cs486Instruction[],
  initialData: number[],
  bases: Readonly<Record<"bss" | "data" | "rodata", number>>,
  relocation: Cs486ObjectRelocation,
  value: number,
): void {
  if (relocation.section === "text") {
    const instruction = instructions[relocation.offset!];
    if (instruction === undefined)
      throw new Cs486LinkError("text relocation is outside its section");
    instructions[relocation.offset!] = patchInstruction(
      instruction,
      relocation.field!,
      value,
    );
    return;
  }
  const section = relocation.section;
  if (section !== "data" && section !== "rodata")
    throw new Cs486LinkError("invalid data relocation section");
  writeInt32(initialData, bases[section] + relocation.offset!, value);
}

function patchInstruction(
  instruction: Cs486Instruction,
  field: Cs486RelocationField,
  value: number,
): Cs486Instruction {
  if (field === "target" && "target" in instruction)
    return { ...instruction, target: value };
  if (field === "address" && "address" in instruction)
    return { ...instruction, address: { kind: "immediate", value } };
  if (
    field === "source" &&
    "source" in instruction &&
    typeof instruction.source !== "string"
  )
    return {
      ...instruction,
      source: { kind: "immediate", value },
    };
  if (field === "right" && instruction.op === "cmp")
    return { ...instruction, right: { kind: "immediate", value } };
  throw new Cs486LinkError(`invalid relocation field ${field}`);
}

function relocateNumericDataAddress(
  instruction: Cs486Instruction,
  dataBase: number,
): Cs486Instruction {
  if (
    (instruction.op === "load" || instruction.op === "store") &&
    instruction.address.kind === "immediate"
  )
    return {
      ...instruction,
      address: {
        kind: "immediate",
        value: instruction.address.value + dataBase,
      },
    };
  return { ...instruction };
}

function writeInt32(target: number[], offset: number, value: number): void {
  if (offset < 0 || offset + 4 > target.length)
    throw new Cs486LinkError("data relocation is outside initialized data");
  const unsigned = value >>> 0;
  for (let index = 0; index < 4; index += 1)
    target[offset + index] = (unsigned >>> (index * 8)) & 0xff;
}

function stableLegacySymbols(object: Cs486Object): string {
  return JSON.stringify(
    object.symbols
      .map(({ binding, name, offset, section }) => ({
        binding,
        name,
        offset,
        section,
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.binding.localeCompare(right.binding),
      ),
  );
}

function stableLegacyRelocations(object: Cs486Object): string {
  return JSON.stringify(
    object.relocations
      .filter((relocation) => relocation.type === "text-target")
      .map((relocation) => ({
        instructionOffset: relocation.instructionOffset ?? relocation.offset,
        symbol: relocation.symbol,
        type: relocation.type,
      }))
      .sort(
        (left, right) =>
          (left.instructionOffset ?? 0) - (right.instructionOffset ?? 0) ||
          left.symbol.localeCompare(right.symbol),
      ),
  );
}

function stableV2Sections(object: CanonicalObject): string {
  return stableJson(object.sections);
}

function stableV2Symbols(object: CanonicalObject): string {
  return stableJson(
    [...object.symbols].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  );
}

function stableV2Relocations(object: CanonicalObject): string {
  return stableJson(
    [...object.relocations]
      .map((relocation) => ({
        ...relocation,
        addend: relocation.addend ?? 0,
      }))
      .sort(
        (left, right) =>
          (left.section ?? "").localeCompare(right.section ?? "") ||
          (left.offset ?? 0) - (right.offset ?? 0) ||
          left.symbol.localeCompare(right.symbol),
      ),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
}

function invalidMetadata(error: unknown): Cs486LinkError {
  return new Cs486LinkError(
    `invalid object metadata: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function objectInitializedDataLength(object: CanonicalObject): number {
  const rodata = objectSection(object, "rodata");
  const data = objectSection(object, "data");
  const bss = objectSection(object, "bss");
  const dataBase = align(rodata.bytes.length, data.alignment);
  return align(dataBase + data.bytes.length, bss.alignment);
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

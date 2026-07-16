import {
  validateCs486Executable,
  type Cs486FunctionSignature,
  type Cs486Instruction,
} from "./cs486.js";

export type Cs486ObjectLanguage = "asm" | "basic" | "c" | "cpp";
export type Cs486ObjectSectionName = "bss" | "data" | "rodata" | "text";
export type Cs486ObjectSymbolType = "function" | "notype" | "object";

export interface Cs486ObjectSymbol {
  readonly binding: "global" | "local" | "undefined";
  readonly functionSignature?: Cs486FunctionSignature;
  readonly name: string;
  readonly offset?: number;
  readonly section: Cs486ObjectSectionName;
  readonly size?: number;
  readonly type?: Cs486ObjectSymbolType;
}

export type Cs486RelocationField =
  "address" | "data" | "right" | "source" | "target";

export interface Cs486ObjectRelocation {
  readonly addend?: number;
  readonly field?: Cs486RelocationField;
  /** Legacy v1 name for a text instruction offset. */
  readonly instructionOffset?: number;
  /** Instruction offset for text, byte offset for initialized data. */
  readonly offset?: number;
  readonly section?: "data" | "rodata" | "text";
  readonly symbol: string;
  readonly type: "absolute32" | "data-address" | "text-target";
}

export interface Cs486ObjectTextSection {
  readonly alignment: 1;
  readonly instructions: readonly Cs486Instruction[];
  readonly name: "text";
}

export interface Cs486ObjectDataSection<
  TName extends "data" | "rodata" = "data" | "rodata",
> {
  readonly alignment: 1 | 2 | 4 | 8 | 16;
  readonly bytes: readonly number[];
  readonly name: TName;
}

export interface Cs486ObjectBssSection {
  readonly alignment: 1 | 2 | 4 | 8 | 16;
  readonly name: "bss";
  readonly size: number;
}

export type Cs486ObjectSection =
  | Cs486ObjectBssSection
  | Cs486ObjectDataSection<"data">
  | Cs486ObjectDataSection<"rodata">
  | Cs486ObjectTextSection;

/**
 * Version 1 objects carry normalized assembly and text-only metadata. Version 2
 * adds structured sections and relocations while retaining `assembly` as a
 * bounded, human-readable listing for objdump and integrity diagnostics.
 */
export interface Cs486Object {
  readonly assembly: string;
  readonly dataBytes: number;
  readonly format: "cs486-object";
  readonly language: Cs486ObjectLanguage;
  readonly relocations: readonly Cs486ObjectRelocation[];
  readonly sections?: readonly Cs486ObjectSection[];
  readonly symbols: readonly Cs486ObjectSymbol[];
  readonly version: 1 | 2;
}

const maximumAssemblyCharacters = 256_000;
const maximumDataBytes = 16 * 1_048_576;
const maximumInitializedDataBytes = 256_000;
const maximumRelocations = 4_096;
const maximumSymbols = 2_048;

export function validateCs486Object(
  value: unknown,
): asserts value is Cs486Object {
  if (typeof value !== "object" || value === null)
    throw new TypeError("invalid CS486 object");
  const candidate = value as Partial<Cs486Object>;
  if (
    candidate.format !== "cs486-object" ||
    (candidate.version !== 1 && candidate.version !== 2) ||
    !["asm", "basic", "c", "cpp"].includes(candidate.language ?? "") ||
    typeof candidate.assembly !== "string" ||
    candidate.assembly.length > maximumAssemblyCharacters ||
    !Number.isSafeInteger(candidate.dataBytes) ||
    (candidate.dataBytes ?? -1) < 0 ||
    (candidate.dataBytes ?? 0) > maximumDataBytes ||
    !Array.isArray(candidate.symbols) ||
    candidate.symbols.length > maximumSymbols ||
    !Array.isArray(candidate.relocations) ||
    candidate.relocations.length > maximumRelocations
  )
    throw new TypeError("unsupported CS486 object format");

  if (candidate.version === 1) {
    if (candidate.sections !== undefined)
      throw new TypeError("unsupported CS486 object format");
  } else validateSections(candidate);

  const symbolNames = new Set<string>();
  const symbolsByName = new Map<string, Cs486ObjectSymbol>();
  for (const value of candidate.symbols as readonly unknown[]) {
    if (typeof value !== "object" || value === null)
      throw new TypeError("invalid CS486 object symbol");
    const symbol = value as Partial<Cs486ObjectSymbol>;
    if (
      !isSymbolName(symbol.name) ||
      !isSectionName(symbol.section) ||
      (symbol.binding !== "global" &&
        symbol.binding !== "local" &&
        symbol.binding !== "undefined") ||
      (symbol.binding === "undefined"
        ? symbol.offset !== undefined
        : !Number.isSafeInteger(symbol.offset) || (symbol.offset ?? -1) < 0) ||
      (symbol.type !== undefined &&
        symbol.type !== "function" &&
        symbol.type !== "notype" &&
        symbol.type !== "object") ||
      (symbol.functionSignature !== undefined &&
        (candidate.version !== 2 ||
          symbol.type !== "function" ||
          (symbol.functionSignature !== "()->i32" &&
            symbol.functionSignature !== "()->void"))) ||
      (symbol.size !== undefined &&
        (!Number.isSafeInteger(symbol.size) || symbol.size < 0)) ||
      symbolNames.has(symbol.name)
    )
      throw new TypeError("invalid CS486 object symbol");
    if (
      candidate.version === 1 &&
      (symbol.section !== "text" ||
        symbol.functionSignature !== undefined ||
        symbol.type !== undefined ||
        symbol.size !== undefined)
    )
      throw new TypeError("invalid CS486 object symbol");
    if (candidate.version === 2) {
      if (
        (symbol.type === "function" && symbol.section !== "text") ||
        (symbol.type === "object" && symbol.section === "text")
      )
        throw new TypeError("invalid CS486 object symbol type");
      if (symbol.binding !== "undefined") {
        const extent = sectionExtent(
          candidate.sections as readonly Cs486ObjectSection[],
          symbol.section,
        );
        if (
          (symbol.offset ?? 0) > extent ||
          (symbol.size !== undefined &&
            (symbol.offset ?? 0) + symbol.size > extent) ||
          (symbol.type === "function" && (symbol.offset ?? extent) >= extent)
        )
          throw new TypeError("invalid CS486 object symbol offset");
      }
    }
    symbolNames.add(symbol.name);
    symbolsByName.set(symbol.name, symbol as Cs486ObjectSymbol);
  }
  for (const value of candidate.relocations as readonly unknown[]) {
    const relocation = validateRelocation(
      value,
      candidate.version,
      symbolNames,
      candidate.sections,
    );
    const symbol = symbolsByName.get(relocation.symbol);
    if (
      candidate.version === 2 &&
      symbol !== undefined &&
      symbol.binding !== "undefined" &&
      !cs486RelocationAcceptsSection(relocation.type, symbol.section)
    )
      throw new TypeError("invalid CS486 object relocation target");
  }
}

export function isCs486ObjectV2(object: Cs486Object): object is Cs486Object & {
  readonly sections: readonly Cs486ObjectSection[];
  readonly version: 2;
} {
  return object.version === 2;
}

export function objectSection<TName extends Cs486ObjectSectionName>(
  object: Cs486Object & { readonly sections: readonly Cs486ObjectSection[] },
  name: TName,
): Extract<Cs486ObjectSection, { readonly name: TName }> {
  const section = object.sections.find((candidate) => candidate.name === name);
  if (section === undefined) throw new TypeError(`missing ${name} section`);
  return section as Extract<Cs486ObjectSection, { readonly name: TName }>;
}

/** Required base alignment when this object's static sections are concatenated. */
export function cs486ObjectDataAlignment(object: Cs486Object): number {
  if (!isCs486ObjectV2(object)) return 4;
  return Math.max(
    4,
    objectSection(object, "rodata").alignment,
    objectSection(object, "data").alignment,
    objectSection(object, "bss").alignment,
  );
}

export function cs486RelocationAcceptsSection(
  type: Cs486ObjectRelocation["type"],
  section: Cs486ObjectSectionName,
): boolean {
  return type === "text-target"
    ? section === "text"
    : type === "data-address"
      ? section !== "text"
      : true;
}

function validateSections(candidate: Partial<Cs486Object>): void {
  if (!Array.isArray(candidate.sections) || candidate.sections.length !== 4)
    throw new TypeError("invalid CS486 object sections");
  const names = new Set<string>();
  let initializedBytes = 0;
  let dataBytes = 0;
  const expectedNames = ["text", "rodata", "data", "bss"] as const;
  for (const [index, value] of (
    candidate.sections as readonly unknown[]
  ).entries()) {
    if (typeof value !== "object" || value === null)
      throw new TypeError("invalid CS486 object section");
    const section = value as Partial<Cs486ObjectSection> & {
      readonly bytes?: readonly unknown[];
      readonly instructions?: readonly unknown[];
      readonly size?: unknown;
    };
    if (
      !isSectionName(section.name) ||
      names.has(section.name) ||
      section.name !== expectedNames[index]
    )
      throw new TypeError("invalid CS486 object section");
    names.add(section.name);
    if (!isAlignment(section.alignment))
      throw new TypeError("invalid CS486 object section alignment");
    if (section.name === "text") {
      if (section.alignment !== 1 || !Array.isArray(section.instructions))
        throw new TypeError("invalid CS486 text section");
      try {
        validateCs486Executable({
          format: "cs486-executable",
          instructions: section.instructions,
          version: 1,
        });
      } catch {
        throw new TypeError("invalid CS486 text section");
      }
      continue;
    }
    dataBytes = align(dataBytes, section.alignment);
    if (section.name === "bss") {
      if (!Number.isSafeInteger(section.size) || (section.size as number) < 0)
        throw new TypeError("invalid CS486 bss section");
      dataBytes += section.size as number;
      continue;
    }
    if (
      !Array.isArray(section.bytes) ||
      section.bytes.some(
        (byte) =>
          !Number.isSafeInteger(byte) ||
          (byte as number) < 0 ||
          (byte as number) > 255,
      )
    )
      throw new TypeError("invalid CS486 data section");
    initializedBytes += section.bytes.length;
    dataBytes += section.bytes.length;
  }
  if (
    !names.has("text") ||
    !names.has("rodata") ||
    !names.has("data") ||
    !names.has("bss") ||
    initializedBytes > maximumInitializedDataBytes ||
    dataBytes !== candidate.dataBytes
  )
    throw new TypeError("invalid CS486 object sections");
}

function validateRelocation(
  value: unknown,
  version: 1 | 2,
  symbolNames: ReadonlySet<string>,
  sections?: readonly Cs486ObjectSection[],
): Cs486ObjectRelocation {
  if (typeof value !== "object" || value === null)
    throw new TypeError("invalid CS486 object relocation");
  const relocation = value as Partial<Cs486ObjectRelocation>;
  if (!isSymbolName(relocation.symbol) || !symbolNames.has(relocation.symbol))
    throw new TypeError("invalid CS486 object relocation");
  if (version === 1) {
    if (
      relocation.type !== "text-target" ||
      typeof relocation.instructionOffset !== "number" ||
      !Number.isSafeInteger(relocation.instructionOffset) ||
      relocation.instructionOffset < 0 ||
      relocation.section !== undefined ||
      relocation.offset !== undefined ||
      relocation.field !== undefined ||
      relocation.addend !== undefined
    )
      throw new TypeError("invalid CS486 object relocation");
    return relocation as Cs486ObjectRelocation;
  }
  if (
    (relocation.type !== "text-target" &&
      relocation.type !== "data-address" &&
      relocation.type !== "absolute32") ||
    (relocation.section !== "text" &&
      relocation.section !== "data" &&
      relocation.section !== "rodata") ||
    !Number.isSafeInteger(relocation.offset) ||
    (relocation.offset ?? -1) < 0 ||
    relocation.instructionOffset !== undefined ||
    !["address", "data", "right", "source", "target"].includes(
      relocation.field ?? "",
    ) ||
    (relocation.addend !== undefined &&
      !Number.isSafeInteger(relocation.addend))
  )
    throw new TypeError("invalid CS486 object relocation");
  const typed = relocation as Cs486ObjectRelocation;
  if (
    (typed.type === "text-target" &&
      (typed.section !== "text" || typed.field !== "target")) ||
    (typed.type === "data-address" &&
      (typed.section !== "text" || typed.field !== "address")) ||
    (typed.type === "absolute32" &&
      !(
        (typed.section === "text" &&
          (typed.field === "source" || typed.field === "right")) ||
        ((typed.section === "data" || typed.section === "rodata") &&
          typed.field === "data")
      ))
  )
    throw new TypeError("invalid CS486 object relocation field");
  if (sections === undefined)
    throw new TypeError("invalid CS486 object relocation section");
  const targetSection = sections.find(
    (section) => section.name === typed.section,
  );
  if (targetSection === undefined)
    throw new TypeError("invalid CS486 object relocation section");
  if (targetSection.name === "text") {
    const instruction = targetSection.instructions[typed.offset!];
    if (
      instruction === undefined ||
      !instructionSupportsRelocationField(instruction, typed.field!)
    )
      throw new TypeError("invalid CS486 object relocation offset");
  } else if (
    targetSection.name === "bss" ||
    typed.offset! + 4 > targetSection.bytes.length
  ) {
    throw new TypeError("invalid CS486 object relocation offset");
  }
  return typed;
}

function instructionSupportsRelocationField(
  instruction: Cs486Instruction,
  field: Cs486RelocationField,
): boolean {
  if (field === "target") return "target" in instruction;
  if (field === "address") return "address" in instruction;
  if (field === "right") return instruction.op === "cmp";
  if (field === "source")
    return "source" in instruction && typeof instruction.source !== "string";
  return false;
}

function sectionExtent(
  sections: readonly Cs486ObjectSection[],
  name: Cs486ObjectSectionName,
): number {
  const section = sections.find((candidate) => candidate.name === name);
  if (section === undefined) throw new TypeError(`missing ${name} section`);
  return section.name === "text"
    ? section.instructions.length
    : section.name === "bss"
      ? section.size
      : section.bytes.length;
}

function isSymbolName(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z_.$@?][A-Za-z0-9_.$@?]*$/u.test(value)
  );
}

function isSectionName(value: unknown): value is Cs486ObjectSectionName {
  return (
    value === "text" ||
    value === "rodata" ||
    value === "data" ||
    value === "bss"
  );
}

function isAlignment(value: unknown): value is 1 | 2 | 4 | 8 | 16 {
  return (
    value === 1 || value === 2 || value === 4 || value === 8 || value === 16
  );
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

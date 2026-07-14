export type Cs486ObjectLanguage = "asm" | "basic" | "c" | "cpp";

export interface Cs486ObjectSymbol {
  readonly binding: "global" | "local" | "undefined";
  readonly name: string;
  readonly offset?: number;
  readonly section: "text";
}

export interface Cs486ObjectRelocation {
  readonly instructionOffset: number;
  readonly symbol: string;
  readonly type: "text-target";
}

export interface Cs486Object {
  readonly assembly: string;
  readonly dataBytes: number;
  readonly format: "cs486-object";
  readonly language: Cs486ObjectLanguage;
  readonly relocations: readonly Cs486ObjectRelocation[];
  readonly symbols: readonly Cs486ObjectSymbol[];
  readonly version: 1;
}

const maximumAssemblyCharacters = 256_000;
const maximumDataBytes = 16 * 1_048_576;
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
    candidate.version !== 1 ||
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

  const symbolNames = new Set<string>();
  for (const value of candidate.symbols as readonly unknown[]) {
    if (typeof value !== "object" || value === null)
      throw new TypeError("invalid CS486 object symbol");
    const symbol = value as Partial<Cs486ObjectSymbol>;
    if (
      !isSymbolName(symbol.name) ||
      symbol.section !== "text" ||
      (symbol.binding !== "global" &&
        symbol.binding !== "local" &&
        symbol.binding !== "undefined") ||
      (symbol.binding === "undefined"
        ? symbol.offset !== undefined
        : !Number.isSafeInteger(symbol.offset) || (symbol.offset ?? -1) < 0) ||
      symbolNames.has(symbol.name)
    )
      throw new TypeError("invalid CS486 object symbol");
    symbolNames.add(symbol.name);
  }
  for (const value of candidate.relocations as readonly unknown[]) {
    if (typeof value !== "object" || value === null)
      throw new TypeError("invalid CS486 object relocation");
    const relocation = value as Partial<Cs486ObjectRelocation>;
    if (
      relocation.type !== "text-target" ||
      typeof relocation.instructionOffset !== "number" ||
      !Number.isSafeInteger(relocation.instructionOffset) ||
      relocation.instructionOffset < 0 ||
      !isSymbolName(relocation.symbol) ||
      !symbolNames.has(relocation.symbol)
    )
      throw new TypeError("invalid CS486 object relocation");
  }
}

function isSymbolName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}

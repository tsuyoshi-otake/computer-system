export const boundedPatternLimits = Object.freeze({
  maximumAtoms: 128,
  maximumPatternCharacters: 256,
  maximumSteps: 100_000,
});

interface CharacterClass {
  readonly negated: boolean;
  readonly ranges: readonly (readonly [number, number])[];
}

interface PatternAtom {
  readonly kind: "any" | "class" | "literal";
  readonly value?: string;
  readonly characterClass?: CharacterClass;
  readonly repeated: boolean;
}

export interface BoundedPattern {
  readonly anchoredEnd: boolean;
  readonly anchoredStart: boolean;
  readonly atoms: readonly PatternAtom[];
}

export interface BoundedPatternMatch {
  readonly end: number;
  readonly start: number;
}

export class BoundedPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundedPatternError";
  }
}

export function compileBoundedPattern(source: string): BoundedPattern {
  if (source.length === 0) throw new BoundedPatternError("empty pattern");
  if (source.length > boundedPatternLimits.maximumPatternCharacters) {
    throw new BoundedPatternError("pattern character limit exceeded");
  }
  let cursor = 0;
  const anchoredStart = source.startsWith("^");
  if (anchoredStart) cursor += 1;
  const atoms: PatternAtom[] = [];
  let anchoredEnd = false;
  while (cursor < source.length) {
    if (source[cursor] === "$" && cursor === source.length - 1) {
      anchoredEnd = true;
      cursor += 1;
      break;
    }
    let atom: Omit<PatternAtom, "repeated">;
    const character = source[cursor]!;
    if (character === "\\") {
      cursor += 1;
      if (cursor >= source.length) {
        throw new BoundedPatternError("trailing escape");
      }
      atom = { kind: "literal", value: source[cursor]! };
      cursor += 1;
    } else if (character === ".") {
      atom = { kind: "any" };
      cursor += 1;
    } else if (character === "[") {
      const parsed = parseCharacterClass(source, cursor + 1);
      atom = { characterClass: parsed.characterClass, kind: "class" };
      cursor = parsed.cursor;
    } else if (character === "*") {
      throw new BoundedPatternError("'*' has no preceding atom");
    } else {
      atom = { kind: "literal", value: character };
      cursor += 1;
    }
    const repeated = source[cursor] === "*";
    if (repeated) cursor += 1;
    atoms.push(Object.freeze({ ...atom, repeated }));
    if (atoms.length > boundedPatternLimits.maximumAtoms) {
      throw new BoundedPatternError("pattern atom limit exceeded");
    }
  }
  if (atoms.length === 0) throw new BoundedPatternError("empty pattern");
  return Object.freeze({
    anchoredEnd,
    anchoredStart,
    atoms: Object.freeze(atoms),
  });
}

export function findBoundedPattern(
  pattern: BoundedPattern,
  input: string,
  from = 0,
): BoundedPatternMatch | undefined {
  if (!Number.isSafeInteger(from) || from < 0 || from > input.length) {
    throw new RangeError("invalid pattern search offset");
  }
  const counter = { steps: 0 };
  const first = pattern.anchoredStart ? 0 : from;
  const last = pattern.anchoredStart ? 0 : input.length;
  for (let start = first; start <= last; start += 1) {
    if (start < from) continue;
    const end = matchAt(pattern, input, start, counter);
    if (end !== undefined) return { end, start };
  }
  return undefined;
}

function matchAt(
  pattern: BoundedPattern,
  input: string,
  start: number,
  counter: { steps: number },
): number | undefined {
  const memo = new Map<string, number | false>();
  const visit = (atomIndex: number, inputIndex: number): number | undefined => {
    counter.steps += 1;
    if (counter.steps > boundedPatternLimits.maximumSteps) {
      throw new BoundedPatternError("pattern evaluation step limit exceeded");
    }
    const key = `${String(atomIndex)}:${String(inputIndex)}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached === false ? undefined : cached;
    if (atomIndex === pattern.atoms.length) {
      const result =
        !pattern.anchoredEnd || inputIndex === input.length
          ? inputIndex
          : undefined;
      memo.set(key, result ?? false);
      return result;
    }
    const atom = pattern.atoms[atomIndex]!;
    let result: number | undefined;
    if (atom.repeated) {
      let cursor = inputIndex;
      while (cursor < input.length && atomMatches(atom, input[cursor]!)) {
        cursor += 1;
      }
      for (let candidate = cursor; candidate >= inputIndex; candidate -= 1) {
        result = visit(atomIndex + 1, candidate);
        if (result !== undefined) break;
      }
    } else if (
      inputIndex < input.length &&
      atomMatches(atom, input[inputIndex]!)
    ) {
      result = visit(atomIndex + 1, inputIndex + 1);
    }
    memo.set(key, result ?? false);
    return result;
  };
  return visit(0, start);
}

function atomMatches(atom: PatternAtom, character: string): boolean {
  if (atom.kind === "any") return character !== "\n";
  if (atom.kind === "literal") return character === atom.value;
  const code = character.codePointAt(0)!;
  const found = atom.characterClass!.ranges.some(
    ([low, high]) => code >= low && code <= high,
  );
  return atom.characterClass!.negated ? !found : found;
}

function parseCharacterClass(
  source: string,
  start: number,
): { readonly characterClass: CharacterClass; readonly cursor: number } {
  let cursor = start;
  const negated = source[cursor] === "^";
  if (negated) cursor += 1;
  const values: number[] = [];
  while (cursor < source.length && source[cursor] !== "]") {
    let character = source[cursor]!;
    if (character === "\\") {
      cursor += 1;
      if (cursor >= source.length) {
        throw new BoundedPatternError("unterminated character class escape");
      }
      character = source[cursor]!;
    }
    values.push(character.codePointAt(0)!);
    cursor += 1;
  }
  if (cursor >= source.length || values.length === 0) {
    throw new BoundedPatternError("unterminated or empty character class");
  }
  cursor += 1;
  const ranges: Array<readonly [number, number]> = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index + 2 < values.length && values[index + 1] === 45) {
      const low = values[index]!;
      const high = values[index + 2]!;
      if (low > high)
        throw new BoundedPatternError("descending character range");
      ranges.push(Object.freeze([low, high]));
      index += 2;
    } else {
      ranges.push(Object.freeze([values[index]!, values[index]!]));
    }
  }
  return {
    characterClass: Object.freeze({ negated, ranges: Object.freeze(ranges) }),
    cursor,
  };
}

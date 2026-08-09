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

interface BoundedPatternBranch {
  readonly anchoredEnd: boolean;
  readonly anchoredStart: boolean;
  readonly atoms: readonly PatternAtom[];
}

/**
 * A deliberately small regular-expression subset shared by guest utilities.
 * Alternatives are kept as independently anchored branches so `^a|b` retains
 * its conventional meaning instead of accidentally anchoring the whole source.
 */
export interface BoundedPattern {
  readonly branches: readonly BoundedPatternBranch[];
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
  const branches = splitAlternatives(source).map(parseBoundedPatternBranch);
  const atoms = branches.reduce(
    (count, branch) => count + branch.atoms.length,
    0,
  );
  if (atoms > boundedPatternLimits.maximumAtoms) {
    throw new BoundedPatternError("pattern atom limit exceeded");
  }
  return Object.freeze({ branches: Object.freeze(branches) });
}

function parseBoundedPatternBranch(source: string): BoundedPatternBranch {
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
  }
  if (atoms.length === 0) throw new BoundedPatternError("empty pattern");
  return Object.freeze({
    anchoredEnd,
    anchoredStart,
    atoms: Object.freeze(atoms),
  });
}

function splitAlternatives(source: string): readonly string[] {
  const alternatives: string[] = [];
  let current = "";
  let characterClass = false;
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === "[") {
      characterClass = true;
      current += character;
      continue;
    }
    if (character === "]" && characterClass) {
      characterClass = false;
      current += character;
      continue;
    }
    if (character === "|" && !characterClass) {
      if (current.length === 0)
        throw new BoundedPatternError("empty alternative");
      alternatives.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current.length === 0) throw new BoundedPatternError("empty alternative");
  alternatives.push(current);
  return alternatives;
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
  for (let start = from; start <= input.length; start += 1) {
    for (const branch of pattern.branches) {
      if (branch.anchoredStart && start !== 0) continue;
      const end = matchAt(branch, input, start, counter);
      if (end !== undefined) return { end, start };
    }
  }
  return undefined;
}

function matchAt(
  pattern: BoundedPatternBranch,
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

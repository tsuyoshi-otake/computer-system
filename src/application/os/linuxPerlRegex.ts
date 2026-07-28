/**
 * Bounded regular-expression engine for the CS-Linux `perl` profile.
 *
 * The engine is a deterministic backtracking matcher over a frozen node tree.
 * It never delegates to the host `RegExp` implementation, so guest programs
 * cannot reach host regex behaviour, host performance characteristics, or a
 * catastrophic-backtracking hang: every match runs under a fixed step budget.
 */

export const perlRegexLimits = Object.freeze({
  maximumCaptureGroups: 16,
  maximumNodes: 512,
  maximumPatternCharacters: 512,
  maximumRepetition: 1_024,
  maximumSteps: 200_000,
});

export class PerlRegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerlRegexError";
  }
}

export interface PerlRegexFlags {
  readonly global: boolean;
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
  readonly singleLine: boolean;
}

export interface PerlRegex {
  readonly captureCount: number;
  readonly flags: PerlRegexFlags;
  readonly root: AlternationNode;
  readonly source: string;
}

export interface PerlRegexMatch {
  /** Capture 0 is the whole match; later slots are `undefined` when unset. */
  readonly captures: readonly (string | undefined)[];
  readonly end: number;
  readonly start: number;
}

type ClassRange = readonly [number, number];

interface CharacterClass {
  readonly negated: boolean;
  readonly ranges: readonly ClassRange[];
}

interface AlternationNode {
  readonly branches: readonly SequenceNode[];
  readonly kind: "alternation";
}

interface SequenceNode {
  readonly items: readonly QuantifiedNode[];
  readonly kind: "sequence";
}

interface QuantifiedNode {
  readonly atom: AtomNode;
  readonly greedy: boolean;
  readonly kind: "quantified";
  readonly maximum: number;
  readonly minimum: number;
}

type AtomNode =
  | { readonly kind: "any" }
  | { readonly characterClass: CharacterClass; readonly kind: "class" }
  | { readonly kind: "literal"; readonly value: string }
  | {
      readonly alternation: AlternationNode;
      readonly captureIndex?: number;
      readonly kind: "group";
    }
  | {
      readonly anchor: "end" | "start" | "wordBoundary" | "notWordBoundary";
      readonly kind: "anchor";
    };

const digitRanges: readonly ClassRange[] = Object.freeze([
  Object.freeze([0x30, 0x39] as const),
]);
const wordRanges: readonly ClassRange[] = Object.freeze([
  Object.freeze([0x30, 0x39] as const),
  Object.freeze([0x41, 0x5a] as const),
  Object.freeze([0x5f, 0x5f] as const),
  Object.freeze([0x61, 0x7a] as const),
]);
const spaceRanges: readonly ClassRange[] = Object.freeze([
  Object.freeze([0x09, 0x0d] as const),
  Object.freeze([0x20, 0x20] as const),
]);

const classEscapes: ReadonlyMap<string, CharacterClass> = new Map([
  ["d", frozenClass(false, digitRanges)],
  ["D", frozenClass(true, digitRanges)],
  ["w", frozenClass(false, wordRanges)],
  ["W", frozenClass(true, wordRanges)],
  ["s", frozenClass(false, spaceRanges)],
  ["S", frozenClass(true, spaceRanges)],
]);

const literalEscapes: ReadonlyMap<string, string> = new Map([
  ["0", "\0"],
  ["a", String.fromCharCode(7)],
  ["e", String.fromCharCode(27)],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
]);

export function compilePerlRegex(source: string, flagText = ""): PerlRegex {
  if (source.length > perlRegexLimits.maximumPatternCharacters) {
    throw new PerlRegexError("regex character limit exceeded");
  }
  const flags = parseRegexFlags(flagText);
  const parser = new RegexParser(source);
  const root = parser.parse();
  return Object.freeze({
    captureCount: parser.captureCount,
    flags,
    root,
    source,
  });
}

export function parseRegexFlags(flagText: string): PerlRegexFlags {
  let global = false;
  let ignoreCase = false;
  let multiline = false;
  let singleLine = false;
  for (const flag of flagText) {
    if (flag === "g") global = true;
    else if (flag === "i") ignoreCase = true;
    else if (flag === "m") multiline = true;
    else if (flag === "s") singleLine = true;
    else throw new PerlRegexError(`unsupported regex modifier: ${flag}`);
  }
  return Object.freeze({ global, ignoreCase, multiline, singleLine });
}

/** Finds the leftmost match at or after `from`, or `undefined`. */
export function matchPerlRegex(
  regex: PerlRegex,
  input: string,
  from = 0,
): PerlRegexMatch | undefined {
  if (!Number.isSafeInteger(from) || from < 0) {
    throw new RangeError("invalid regex search offset");
  }
  if (from > input.length) return undefined;
  const machine = new RegexMachine(regex, input);
  for (let start = from; start <= input.length; start += 1) {
    const match = machine.matchAt(start);
    if (match !== undefined) return match;
  }
  return undefined;
}

class RegexParser {
  captureCount = 0;

  private cursor = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  parse(): AlternationNode {
    const alternation = this.parseAlternation();
    if (this.cursor < this.source.length) {
      throw new PerlRegexError(
        `unbalanced ')' at offset ${String(this.cursor)}`,
      );
    }
    return alternation;
  }

  private parseAlternation(): AlternationNode {
    const branches: SequenceNode[] = [this.parseSequence()];
    while (this.source[this.cursor] === "|") {
      this.cursor += 1;
      branches.push(this.parseSequence());
    }
    return this.freezeNode({
      branches: Object.freeze(branches),
      kind: "alternation",
    });
  }

  private parseSequence(): SequenceNode {
    const items: QuantifiedNode[] = [];
    while (this.cursor < this.source.length) {
      const character = this.source[this.cursor]!;
      if (character === "|" || character === ")") break;
      items.push(this.parseQuantified());
    }
    return this.freezeNode({ items: Object.freeze(items), kind: "sequence" });
  }

  private parseQuantified(): QuantifiedNode {
    const atom = this.parseAtom();
    const { maximum, minimum } = this.parseQuantifierBounds();
    const greedy = this.source[this.cursor] !== "?";
    if (!greedy) this.cursor += 1;
    if (this.source[this.cursor] === "+") {
      throw new PerlRegexError("possessive quantifiers are unavailable");
    }
    if (atom.kind === "anchor" && (minimum !== 1 || maximum !== 1)) {
      throw new PerlRegexError("quantified anchors are unavailable");
    }
    return this.freezeNode({
      atom,
      greedy,
      kind: "quantified",
      maximum,
      minimum,
    });
  }

  private parseQuantifierBounds(): {
    readonly maximum: number;
    readonly minimum: number;
  } {
    const character = this.source[this.cursor];
    if (character === "*") {
      this.cursor += 1;
      return { maximum: perlRegexLimits.maximumRepetition, minimum: 0 };
    }
    if (character === "+") {
      this.cursor += 1;
      return { maximum: perlRegexLimits.maximumRepetition, minimum: 1 };
    }
    if (character === "?") {
      this.cursor += 1;
      return { maximum: 1, minimum: 0 };
    }
    if (character !== "{") return { maximum: 1, minimum: 1 };
    const close = this.source.indexOf("}", this.cursor);
    const body = close < 0 ? "" : this.source.slice(this.cursor + 1, close);
    if (close < 0 || !/^\d{1,4}(?:,\d{0,4})?$/u.test(body)) {
      return { maximum: 1, minimum: 1 };
    }
    this.cursor = close + 1;
    const [low, high] = body.split(",");
    const minimum = Number.parseInt(low!, 10);
    const maximum =
      high === undefined
        ? minimum
        : high.length === 0
          ? perlRegexLimits.maximumRepetition
          : Number.parseInt(high, 10);
    if (maximum > perlRegexLimits.maximumRepetition) {
      throw new PerlRegexError("regex repetition limit exceeded");
    }
    if (minimum > maximum) {
      throw new PerlRegexError("descending regex repetition bounds");
    }
    return { maximum, minimum };
  }

  private parseAtom(): AtomNode {
    const character = this.source[this.cursor]!;
    if (character === "(") return this.parseGroup();
    if (character === "[") return this.parseCharacterClass();
    if (character === "^") {
      this.cursor += 1;
      return this.freezeNode({ anchor: "start", kind: "anchor" });
    }
    if (character === "$") {
      this.cursor += 1;
      return this.freezeNode({ anchor: "end", kind: "anchor" });
    }
    if (character === ".") {
      this.cursor += 1;
      return this.freezeNode({ kind: "any" });
    }
    if (character === "*" || character === "+" || character === "?") {
      throw new PerlRegexError(`quantifier '${character}' has no atom`);
    }
    if (character === "\\") return this.parseEscape();
    this.cursor += 1;
    return this.freezeNode({ kind: "literal", value: character });
  }

  private parseGroup(): AtomNode {
    this.cursor += 1;
    let capturing = true;
    if (this.source.startsWith("?:", this.cursor)) {
      capturing = false;
      this.cursor += 2;
    } else if (this.source[this.cursor] === "?") {
      throw new PerlRegexError(
        "lookaround, named, and modifier groups are unavailable",
      );
    }
    let captureIndex: number | undefined;
    if (capturing) {
      this.captureCount += 1;
      if (this.captureCount > perlRegexLimits.maximumCaptureGroups) {
        throw new PerlRegexError("regex capture group limit exceeded");
      }
      captureIndex = this.captureCount;
    }
    const alternation = this.parseAlternation();
    if (this.source[this.cursor] !== ")") {
      throw new PerlRegexError("unterminated regex group");
    }
    this.cursor += 1;
    return this.freezeNode({
      alternation,
      ...(captureIndex === undefined ? {} : { captureIndex }),
      kind: "group",
    });
  }

  private parseEscape(): AtomNode {
    this.cursor += 1;
    const escaped = this.source[this.cursor];
    if (escaped === undefined) {
      throw new PerlRegexError("trailing regex escape");
    }
    this.cursor += 1;
    if (escaped === "b") {
      return this.freezeNode({ anchor: "wordBoundary", kind: "anchor" });
    }
    if (escaped === "B") {
      return this.freezeNode({ anchor: "notWordBoundary", kind: "anchor" });
    }
    if (/[1-9]/u.test(escaped)) {
      throw new PerlRegexError("regex backreferences are unavailable");
    }
    const characterClass = classEscapes.get(escaped);
    if (characterClass !== undefined) {
      return this.freezeNode({ characterClass, kind: "class" });
    }
    return this.freezeNode({
      kind: "literal",
      value: literalEscapes.get(escaped) ?? escaped,
    });
  }

  private parseCharacterClass(): AtomNode {
    this.cursor += 1;
    const negated = this.source[this.cursor] === "^";
    if (negated) this.cursor += 1;
    const ranges: ClassRange[] = [];
    let first = true;
    while (this.cursor < this.source.length) {
      const character = this.source[this.cursor]!;
      if (character === "]" && !first) {
        this.cursor += 1;
        if (ranges.length === 0) {
          throw new PerlRegexError("empty character class");
        }
        return this.freezeNode({
          characterClass: frozenClass(negated, Object.freeze(ranges)),
          kind: "class",
        });
      }
      first = false;
      const low = this.readClassMember(ranges);
      if (low === undefined) continue;
      if (
        this.source[this.cursor] === "-" &&
        this.source[this.cursor + 1] !== "]"
      ) {
        this.cursor += 1;
        const high = this.readClassMember(ranges);
        if (high === undefined) {
          throw new PerlRegexError("character class range is not a literal");
        }
        if (low > high) {
          throw new PerlRegexError("descending character class range");
        }
        ranges.push(Object.freeze([low, high] as const));
        continue;
      }
      ranges.push(Object.freeze([low, low] as const));
    }
    throw new PerlRegexError("unterminated character class");
  }

  /**
   * Consumes one class member. Shorthand classes are pushed onto `ranges`
   * directly and return `undefined`; literals return their code point.
   */
  private readClassMember(ranges: ClassRange[]): number | undefined {
    let character = this.source[this.cursor]!;
    if (character !== "\\") {
      this.cursor += 1;
      return character.codePointAt(0)!;
    }
    this.cursor += 1;
    character = this.source[this.cursor] ?? "";
    if (character.length === 0) {
      throw new PerlRegexError("trailing regex escape");
    }
    this.cursor += 1;
    const shorthand = classEscapes.get(character);
    if (shorthand === undefined) {
      return (literalEscapes.get(character) ?? character).codePointAt(0)!;
    }
    if (shorthand.negated) {
      throw new PerlRegexError(
        "negated shorthand classes are unavailable inside []",
      );
    }
    ranges.push(...shorthand.ranges);
    return undefined;
  }

  private freezeNode<T>(node: T): T {
    this.nodes += 1;
    if (this.nodes > perlRegexLimits.maximumNodes) {
      throw new PerlRegexError("regex node limit exceeded");
    }
    return Object.freeze(node);
  }
}

class RegexMachine {
  private readonly captures: (string | undefined)[];
  private steps = 0;

  constructor(
    private readonly regex: PerlRegex,
    private readonly input: string,
  ) {
    this.captures = Array.from<string | undefined>({
      length: regex.captureCount + 1,
    }).fill(undefined);
  }

  matchAt(start: number): PerlRegexMatch | undefined {
    this.captures.fill(undefined);
    const end = this.matchAlternation(
      this.regex.root,
      start,
      (position) => position,
    );
    if (end === undefined) return undefined;
    this.captures[0] = this.input.slice(start, end);
    return Object.freeze({
      captures: Object.freeze([...this.captures]),
      end,
      start,
    });
  }

  private matchAlternation(
    node: AlternationNode,
    position: number,
    next: (position: number) => number | undefined,
  ): number | undefined {
    for (const branch of node.branches) {
      const result = this.matchSequence(branch, 0, position, next);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  private matchSequence(
    node: SequenceNode,
    index: number,
    position: number,
    next: (position: number) => number | undefined,
  ): number | undefined {
    this.consumeStep();
    if (index === node.items.length) return next(position);
    return this.matchQuantified(node.items[index]!, position, (after) =>
      this.matchSequence(node, index + 1, after, next),
    );
  }

  private matchQuantified(
    node: QuantifiedNode,
    position: number,
    next: (position: number) => number | undefined,
  ): number | undefined {
    const attempt = (count: number, at: number): number | undefined => {
      this.consumeStep();
      const canRepeat = count < node.maximum;
      const repeat = (): number | undefined =>
        canRepeat
          ? this.matchAtom(node.atom, at, (after) =>
              // A zero-width atom satisfies this repetition but must not
              // repeat again, because that would loop forever.
              after === at
                ? count + 1 >= node.minimum
                  ? next(after)
                  : undefined
                : attempt(count + 1, after),
            )
          : undefined;
      if (count < node.minimum) return repeat();
      if (node.greedy) return repeat() ?? next(at);
      return next(at) ?? repeat();
    };
    return attempt(0, position);
  }

  private matchAtom(
    node: AtomNode,
    position: number,
    next: (position: number) => number | undefined,
  ): number | undefined {
    this.consumeStep();
    switch (node.kind) {
      case "anchor":
        return this.matchesAnchor(node.anchor, position)
          ? next(position)
          : undefined;
      case "group": {
        const index = node.captureIndex;
        if (index === undefined) {
          return this.matchAlternation(node.alternation, position, next);
        }
        const previous = this.captures[index];
        const result = this.matchAlternation(
          node.alternation,
          position,
          (after) => {
            this.captures[index] = this.input.slice(position, after);
            const settled = next(after);
            if (settled === undefined) this.captures[index] = previous;
            return settled;
          },
        );
        if (result === undefined) this.captures[index] = previous;
        return result;
      }
      default: {
        if (position >= this.input.length) return undefined;
        const character = this.input[position]!;
        return this.matchesCharacter(node, character)
          ? next(position + 1)
          : undefined;
      }
    }
  }

  private matchesCharacter(node: AtomNode, character: string): boolean {
    if (node.kind === "any") {
      return this.regex.flags.singleLine || character !== "\n";
    }
    if (node.kind === "literal") {
      return this.regex.flags.ignoreCase
        ? character.toLowerCase() === node.value.toLowerCase()
        : character === node.value;
    }
    if (node.kind !== "class") return false;
    if (!this.regex.flags.ignoreCase) {
      return classMatches(node.characterClass, character);
    }
    return (
      classMatches(node.characterClass, character.toLowerCase()) ||
      classMatches(node.characterClass, character.toUpperCase())
    );
  }

  private matchesAnchor(
    anchor: Extract<AtomNode, { readonly kind: "anchor" }>["anchor"],
    position: number,
  ): boolean {
    if (anchor === "start") {
      if (position === 0) return true;
      // Under `/m` a caret follows every newline except a trailing one, so
      // "a\nb\n" holds two line starts rather than three.
      if (position === this.input.length) return false;
      return this.regex.flags.multiline && this.input[position - 1] === "\n";
    }
    if (anchor === "end") {
      if (position === this.input.length) return true;
      if (this.input[position] !== "\n") return false;
      return this.regex.flags.multiline || position === this.input.length - 1;
    }
    const before = isWordCharacter(this.input[position - 1]);
    const after = isWordCharacter(this.input[position]);
    return anchor === "wordBoundary" ? before !== after : before === after;
  }

  private consumeStep(): void {
    this.steps += 1;
    if (this.steps > perlRegexLimits.maximumSteps) {
      throw new PerlRegexError("regex evaluation step limit exceeded");
    }
  }
}

function classMatches(
  characterClass: CharacterClass,
  character: string,
): boolean {
  const code = character.codePointAt(0)!;
  const found = characterClass.ranges.some(
    ([low, high]) => code >= low && code <= high,
  );
  return characterClass.negated ? !found : found;
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && classMatches(wordClass, character);
}

function frozenClass(
  negated: boolean,
  ranges: readonly ClassRange[],
): CharacterClass {
  return Object.freeze({ negated, ranges });
}

const wordClass = frozenClass(false, wordRanges);

export interface HighlightedCell {
  readonly background: number;
  readonly character: string;
  readonly foreground: number;
}

const indentBackgrounds = [11, 10, 14, 13] as const;
const keywords = new Set([
  "and",
  "as",
  "break",
  "class",
  "continue",
  "def",
  "do",
  "done",
  "elif",
  "else",
  "export",
  "false",
  "fi",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "None",
  "not",
  "null",
  "or",
  "pass",
  "return",
  "then",
  "True",
  "False",
  "true",
  "while",
]);

export function highlightLine(
  fileName: string,
  line: string,
  maximumColumns: number,
): readonly HighlightedCell[] {
  if (!Number.isSafeInteger(maximumColumns) || maximumColumns < 1) {
    throw new RangeError("Highlight width must be a positive integer");
  }
  const characters = [...line].slice(0, maximumColumns);
  const cells = characters.map((character, index) => ({
    background:
      character === " " && index < leadingWhitespace(characters)
        ? indentBackgrounds[Math.floor(index / 2) % indentBackgrounds.length]!
        : 15,
    character,
    foreground: 0,
  }));
  const language = languageFor(fileName);
  if (language === "text") return cells;

  let index = 0;
  while (index < characters.length) {
    const character = characters[index]!;
    if ((language === "python" || language === "shell") && character === "#") {
      color(cells, index, characters.length, 13);
      break;
    }
    if (character === '"' || character === "'") {
      const end = quotedEnd(characters, index, character);
      color(cells, index, end, 5);
      index = end;
      continue;
    }
    if (isDigit(character)) {
      let end = index + 1;
      while (end < characters.length && isDigit(characters[end]!)) end += 1;
      color(cells, index, end, 1);
      index = end;
      continue;
    }
    if (isWordStart(character)) {
      let end = index + 1;
      while (end < characters.length && isWordPart(characters[end]!)) end += 1;
      const word = characters.slice(index, end).join("");
      if (keywords.has(word)) color(cells, index, end, 10);
      index = end;
      continue;
    }
    if ("{}[]():=+-*/|&<>".includes(character)) {
      color(cells, index, index + 1, 9);
    }
    index += 1;
  }
  return cells;
}

function languageFor(fileName: string): "json" | "python" | "shell" | "text" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "shell";
  if (lower.endsWith(".json") || lower.endsWith(".toml")) return "json";
  return "text";
}

function leadingWhitespace(characters: readonly string[]): number {
  let count = 0;
  while (characters[count] === " " || characters[count] === "\t") count += 1;
  return count;
}

function quotedEnd(
  characters: readonly string[],
  start: number,
  quote: string,
): number {
  let escaped = false;
  for (let index = start + 1; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (!escaped && character === quote) return index + 1;
    escaped = !escaped && character === "\\";
    if (character !== "\\") escaped = false;
  }
  return characters.length;
}

function color(
  cells: HighlightedCell[],
  start: number,
  end: number,
  foreground: number,
): void {
  for (let index = start; index < end; index += 1) {
    cells[index] = { ...cells[index]!, foreground };
  }
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isWordStart(character: string): boolean {
  return (
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    character === "_"
  );
}

function isWordPart(character: string): boolean {
  return isWordStart(character) || isDigit(character);
}

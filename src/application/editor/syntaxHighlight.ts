import {
  lexViLine,
  resolveViFiletype,
  type ViFiletypeOption,
  type ViLexState,
  type ViTokenKind,
} from "./viLanguage.js";

export interface HighlightedCell {
  readonly background: number;
  readonly character: string;
  readonly foreground: number;
}
export interface SyntaxHighlightOptions {
  readonly baseColumn?: number;
  readonly endOfLine?: boolean;
  readonly filetype?: ViFiletypeOption;
  readonly list?: boolean;
  readonly lexState?: ViLexState;
  readonly rainbow?: boolean;
  readonly rainbowColumns?: number;
  readonly rainbowWidth?: number;
  readonly syntax?: boolean;
}

const indentBackgrounds = [11, 10, 14, 13] as const;
const tokenColors: Readonly<Record<ViTokenKind, number>> = {
  comment: 13,
  directive: 14,
  identifier: 0,
  instruction: 10,
  keyword: 10,
  number: 1,
  operator: 9,
  register: 12,
  string: 5,
};

export function highlightLine(
  fileName: string,
  line: string,
  maximumColumns: number,
  options: SyntaxHighlightOptions = {},
): readonly HighlightedCell[] {
  return highlightLineWithState(fileName, line, maximumColumns, options).cells;
}

export interface HighlightedLineResult {
  readonly cells: readonly HighlightedCell[];
  readonly state: ViLexState;
}

export function highlightLineWithState(
  fileName: string,
  line: string,
  maximumColumns: number,
  options: SyntaxHighlightOptions = {},
): HighlightedLineResult {
  if (!Number.isSafeInteger(maximumColumns) || maximumColumns < 1)
    throw new RangeError("Highlight width must be a positive integer");
  const syntax = options.syntax ?? true;
  const rainbow = options.rainbow ?? true;
  const list = options.list ?? false;
  const baseColumn = options.baseColumn ?? 0;
  const rainbowWidth = options.rainbowWidth ?? 2;
  if (!Number.isSafeInteger(baseColumn) || baseColumn < 0)
    throw new RangeError(
      "Highlight base column must be a non-negative integer",
    );
  if (!Number.isSafeInteger(rainbowWidth) || rainbowWidth < 1)
    throw new RangeError("Rainbow width must be a positive integer");

  const characters = [...line].slice(0, maximumColumns);
  const rainbowColumns = Math.max(
    0,
    Math.min(
      characters.length,
      options.rainbowColumns ?? leadingWhitespace(characters),
    ),
  );
  const trailingWhitespaceStart = options.endOfLine
    ? trailingWhitespace(characters)
    : characters.length;
  const cells = characters.map((character, index) => ({
    background:
      rainbow &&
      (character === " " || character === "\t") &&
      index < rainbowColumns
        ? indentBackgrounds[
            Math.floor((baseColumn + index) / rainbowWidth) %
              indentBackgrounds.length
          ]!
        : 15,
    character:
      list && character === "\t"
        ? "\u2192"
        : list && character === " " && index >= trailingWhitespaceStart
          ? "\u00b7"
          : character === "\t"
            ? " "
            : character,
    foreground: 0,
  }));
  if (list && options.endOfLine === true && cells.length < maximumColumns)
    cells.push({ background: 15, character: "$", foreground: 8 });
  if (!syntax)
    return {
      cells,
      state: options.lexState ?? { multiline: null },
    };

  const filetype = resolveViFiletype(
    options.filetype ?? "auto",
    fileName,
    line,
  );
  const lexed = lexViLine(filetype, line, maximumColumns, options.lexState);
  for (const token of lexed.tokens) {
    const foreground = tokenColors[token.kind];
    for (let index = token.start; index < token.end; index += 1)
      if (cells[index] !== undefined)
        cells[index] = { ...cells[index]!, foreground };
  }
  return { cells, state: lexed.state };
}

function leadingWhitespace(characters: readonly string[]): number {
  let count = 0;
  while (characters[count] === " " || characters[count] === "\t") count += 1;
  return count;
}
function trailingWhitespace(characters: readonly string[]): number {
  let index = characters.length;
  while (characters[index - 1] === " " || characters[index - 1] === "\t")
    index -= 1;
  return index;
}

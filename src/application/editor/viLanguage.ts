export type ViFiletype =
  "asm" | "basic" | "c" | "cpp" | "json" | "python" | "shell" | "text";
export type ViFiletypeOption = ViFiletype | "auto";
export type ViTokenKind =
  | "comment"
  | "directive"
  | "identifier"
  | "instruction"
  | "keyword"
  | "number"
  | "operator"
  | "register"
  | "string";
export interface ViLexState {
  readonly multiline: "c-comment" | "python-double" | "python-single" | null;
}
export interface ViSyntaxToken {
  readonly end: number;
  readonly kind: ViTokenKind;
  readonly start: number;
}
export interface ViLexResult {
  readonly state: ViLexState;
  readonly tokens: readonly ViSyntaxToken[];
}
export type ViSymbolKind = "function" | "label" | "macro" | "type";
export interface ViSymbol {
  readonly column: number;
  readonly kind: ViSymbolKind;
  readonly line: number;
  readonly name: string;
  readonly path: string | undefined;
}
export interface ViWordOccurrence {
  readonly line: number;
  readonly text: string;
}
export interface ViIncludeReference {
  readonly authored: string;
  readonly kind: "asm" | "python" | "quoted" | "system";
}
export interface ViDocumentIndex {
  readonly filetype: ViFiletype;
  readonly includes: readonly ViIncludeReference[];
  readonly symbols: readonly ViSymbol[];
  readonly words: readonly ViWordOccurrence[];
}

export const maximumViIdentifierCharacters = 64;
export const maximumViIndexedCharacters = 256 * 1_024;
export const maximumViIndexedLines = 16_384;
export const maximumViIndexedSymbols = 512;
export const maximumViIndexedWords = 2_048;
export const maximumViIncludeReferences = 8;

const keywordLists: Readonly<Record<ViFiletype, readonly string[]>> = {
  asm: ["byte", "dword", "far", "near", "ptr", "qword", "short", "word"],
  basic: [
    "AND",
    "AS",
    "CALL",
    "CASE",
    "CONST",
    "DECLARE",
    "DIM",
    "DO",
    "ELSE",
    "ELSEIF",
    "END",
    "EXIT",
    "FOR",
    "FUNCTION",
    "GOSUB",
    "GOTO",
    "IF",
    "INPUT",
    "LOOP",
    "MOD",
    "NEXT",
    "NOT",
    "OR",
    "PRINT",
    "REM",
    "RETURN",
    "SELECT",
    "SHARED",
    "STEP",
    "SUB",
    "THEN",
    "TO",
    "TYPE",
    "UNTIL",
    "WEND",
    "WHILE",
    "XOR",
  ],
  c: [
    "auto",
    "break",
    "case",
    "char",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "float",
    "for",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "register",
    "restrict",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "struct",
    "switch",
    "typedef",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while",
    "_Bool",
  ],
  cpp: [
    "alignas",
    "alignof",
    "and",
    "asm",
    "auto",
    "bool",
    "break",
    "case",
    "catch",
    "char",
    "class",
    "concept",
    "const",
    "constexpr",
    "continue",
    "default",
    "delete",
    "do",
    "double",
    "else",
    "enum",
    "explicit",
    "export",
    "extern",
    "false",
    "float",
    "for",
    "friend",
    "if",
    "inline",
    "int",
    "long",
    "namespace",
    "new",
    "noexcept",
    "nullptr",
    "operator",
    "private",
    "protected",
    "public",
    "requires",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "struct",
    "switch",
    "template",
    "this",
    "throw",
    "true",
    "try",
    "typedef",
    "typename",
    "union",
    "unsigned",
    "using",
    "virtual",
    "void",
    "volatile",
    "while",
  ],
  json: ["false", "null", "true"],
  python: [
    "False",
    "None",
    "True",
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "try",
    "while",
    "with",
    "yield",
  ],
  shell: [
    "case",
    "do",
    "done",
    "elif",
    "else",
    "esac",
    "export",
    "fi",
    "for",
    "function",
    "if",
    "in",
    "local",
    "readonly",
    "return",
    "then",
    "until",
    "while",
  ],
  text: [],
};
const asmInstructions = new Set([
  "adc",
  "add",
  "and",
  "call",
  "cmp",
  "dec",
  "div",
  "hlt",
  "idiv",
  "imul",
  "in",
  "inc",
  "int",
  "iret",
  "ja",
  "jae",
  "jb",
  "jbe",
  "jc",
  "je",
  "jg",
  "jge",
  "jl",
  "jle",
  "jmp",
  "jne",
  "jno",
  "jns",
  "jnz",
  "jo",
  "js",
  "jz",
  "lea",
  "leave",
  "loop",
  "mov",
  "movsx",
  "movzx",
  "mul",
  "neg",
  "nop",
  "not",
  "or",
  "out",
  "pop",
  "push",
  "ret",
  "rol",
  "ror",
  "sar",
  "sbb",
  "shl",
  "shr",
  "sub",
  "test",
  "xchg",
  "xor",
]);
const asmRegisters = new Set([
  "ah",
  "al",
  "ax",
  "bh",
  "bl",
  "bp",
  "bx",
  "ch",
  "cl",
  "cr0",
  "cr2",
  "cr3",
  "cs",
  "cx",
  "dh",
  "di",
  "dl",
  "ds",
  "dx",
  "eax",
  "ebp",
  "ebx",
  "ecx",
  "edi",
  "edx",
  "es",
  "esi",
  "esp",
  "fs",
  "gs",
  "ip",
  "si",
  "sp",
  "ss",
]);
const keywordSets = Object.fromEntries(
  Object.entries(keywordLists).map(([name, words]) => [name, new Set(words)]),
) as unknown as Readonly<Record<ViFiletype, ReadonlySet<string>>>;

export function viKeywords(filetype: ViFiletype): readonly string[] {
  return keywordLists[filetype];
}
export function resolveViFiletype(
  option: ViFiletypeOption,
  fileName?: string,
  firstLine = "",
): ViFiletype {
  if (option !== "auto") return option;
  const name = (fileName ?? "").toLowerCase();
  if (/\.(?:asm|inc|s)$/u.test(name)) return "asm";
  if (/\.(?:bas|bi)$/u.test(name)) return "basic";
  if (/\.c$/u.test(name)) return "c";
  if (/\.(?:cc|cpp|cxx|h|hh|hpp|hxx)$/u.test(name)) return "cpp";
  if (/\.pyw?$/u.test(name)) return "python";
  if (/\.(?:bash|sh)$/u.test(name)) return "shell";
  if (/\.(?:json|jsonc|toml)$/u.test(name)) return "json";
  if (/^#!.*\bpython(?:3)?\b/u.test(firstLine)) return "python";
  if (/^#!.*\b(?:ba|z|k)?sh\b/u.test(firstLine)) return "shell";
  return "text";
}

export function lexViLine(
  filetype: ViFiletype,
  line: string,
  maximumColumns: number,
  initialState: ViLexState = { multiline: null },
): ViLexResult {
  if (!Number.isSafeInteger(maximumColumns) || maximumColumns < 0)
    throw new RangeError("Lexer width must be a non-negative integer");
  const source = [...line].slice(0, maximumColumns);
  const tokens: ViSyntaxToken[] = [];
  let multiline = initialState.multiline;
  let index = 0;
  if (multiline !== null) {
    const quote =
      multiline === "python-double"
        ? '"'
        : multiline === "python-single"
          ? "'"
          : undefined;
    const end =
      quote === undefined
        ? findPair(source, 0, "*", "/")
        : findTriple(source, 0, quote);
    tokens.push({
      start: 0,
      end: end < 0 ? source.length : end,
      kind: multiline === "c-comment" ? "comment" : "string",
    });
    if (end < 0) return { state: { multiline }, tokens };
    multiline = null;
    index = end;
  }
  while (index < source.length) {
    const character = source[index]!;
    if (character === " " || character === "\t") {
      index += 1;
      continue;
    }
    if (lineComment(filetype, source, index)) {
      tokens.push({ start: index, end: source.length, kind: "comment" });
      break;
    }
    if (
      (filetype === "c" || filetype === "cpp") &&
      character === "/" &&
      source[index + 1] === "*"
    ) {
      const end = findPair(source, index + 2, "*", "/");
      tokens.push({
        start: index,
        end: end < 0 ? source.length : end,
        kind: "comment",
      });
      if (end < 0) {
        multiline = "c-comment";
        break;
      }
      index = end;
      continue;
    }
    if (
      filetype === "python" &&
      (character === '"' || character === "'") &&
      source[index + 1] === character &&
      source[index + 2] === character
    ) {
      const end = findTriple(source, index + 3, character);
      tokens.push({
        start: index,
        end: end < 0 ? source.length : end,
        kind: "string",
      });
      if (end < 0) {
        multiline = character === '"' ? "python-double" : "python-single";
        break;
      }
      index = end;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = quotedEnd(source, index, character);
      tokens.push({ start: index, end, kind: "string" });
      index = end;
      continue;
    }
    if ((filetype === "c" || filetype === "cpp") && character === "#") {
      const end = wordEnd(source, skipSpace(source, index + 1));
      tokens.push({
        start: index,
        end: Math.max(index + 1, end),
        kind: "directive",
      });
      index = Math.max(index + 1, end);
      continue;
    }
    if (filetype === "asm" && (character === "." || character === "%")) {
      const end = wordEnd(source, index + 1);
      tokens.push({ start: index, end, kind: "directive" });
      index = end;
      continue;
    }
    if (digit(character)) {
      let end = index + 1;
      while (end < source.length && /[0-9A-Fa-f_xXbBoO.]/u.test(source[end]!))
        end += 1;
      tokens.push({ start: index, end, kind: "number" });
      index = end;
      continue;
    }
    if (wordStart(character)) {
      const end = wordEnd(source, index + 1);
      const word = source.slice(index, end).join("");
      let kind: ViTokenKind = keywordSets[filetype].has(
        filetype === "basic" ? word.toUpperCase() : word,
      )
        ? "keyword"
        : "identifier";
      if (filetype === "asm" && asmInstructions.has(word.toLowerCase()))
        kind = "instruction";
      if (filetype === "asm" && asmRegisters.has(word.toLowerCase()))
        kind = "register";
      tokens.push({ start: index, end, kind });
      index = end;
      continue;
    }
    if ("{}[]():=+-*/|&<>!~%^,.?".includes(character))
      tokens.push({ start: index, end: index + 1, kind: "operator" });
    index += 1;
  }
  return { state: { multiline }, tokens };
}

export function indexViDocument(
  filetype: ViFiletype,
  path: string | undefined,
  contents: string,
): ViDocumentIndex {
  const words: ViWordOccurrence[] = [],
    symbols: ViSymbol[] = [],
    includes: ViIncludeReference[] = [];
  const lines = contents
    .slice(0, maximumViIndexedCharacters)
    .replaceAll("\r\n", "\n")
    .split("\n")
    .slice(0, maximumViIndexedLines);
  for (let line = 0; line < lines.length; line += 1) {
    const source = lines[line]!;
    if (words.length < maximumViIndexedWords) {
      for (const match of source.matchAll(/[A-Za-z_.$?][A-Za-z0-9_.$?]*/gu)) {
        if (match[0].length <= maximumViIdentifierCharacters)
          words.push({ line, text: match[0] });
        if (words.length >= maximumViIndexedWords) break;
      }
    }
    if (symbols.length < maximumViIndexedSymbols) {
      const symbol = symbolForLine(filetype, source, line, path);
      if (symbol !== undefined) symbols.push(symbol);
    }
    if (includes.length < maximumViIncludeReferences) {
      const include = includeForLine(filetype, source);
      if (include !== undefined && include.authored.length <= 256)
        includes.push(include);
    }
    if (
      words.length >= maximumViIndexedWords &&
      symbols.length >= maximumViIndexedSymbols &&
      includes.length >= maximumViIncludeReferences
    )
      break;
  }
  return { filetype, includes, symbols, words };
}

function symbolForLine(
  filetype: ViFiletype,
  source: string,
  line: number,
  path: string | undefined,
): ViSymbol | undefined {
  let match: RegExpExecArray | null = null;
  let kind: ViSymbolKind = "function";
  if (filetype === "python") {
    match = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/u.exec(source);
    if (match === null) {
      match = /^\s*class\s+([A-Za-z_]\w*)/u.exec(source);
      kind = "type";
    }
  } else if (filetype === "basic") {
    match =
      /^\s*(?:SUB|FUNCTION|TYPE|CONST|DECLARE\s+(?:SUB|FUNCTION))\s+([A-Za-z_][A-Za-z0-9_]*[$%&!#]?)/iu.exec(
        source,
      );
    kind = /^\s*TYPE\b/iu.test(source)
      ? "type"
      : /^\s*CONST\b/iu.test(source)
        ? "macro"
        : "function";
    if (match === null) {
      match = /^\s*([A-Za-z_][A-Za-z0-9_]*):/u.exec(source);
      kind = "label";
    }
  } else if (filetype === "c" || filetype === "cpp") {
    match = /^\s*#\s*define\s+([A-Za-z_]\w*)/u.exec(source);
    if (match !== null) kind = "macro";
    if (match === null) {
      match = /^\s*(?:class|struct|enum|union)\s+([A-Za-z_]\w*)/u.exec(source);
      kind = "type";
    }
    if (match === null) {
      match = /^\s*using\s+([A-Za-z_]\w*)\s*=/u.exec(source);
      kind = "type";
    }
    if (match === null) {
      match = /^\s*typedef\b[^;]*\b([A-Za-z_]\w*)\s*;/u.exec(source);
      kind = "type";
    }
    if (match === null) {
      match =
        /^\s*(?!if\b|for\b|while\b|switch\b|return\b)[A-Za-z_][\w\s:*&<>,[\]]*\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:\{|$)/u.exec(
          source,
        );
      kind = "function";
    }
  } else if (filetype === "asm") {
    match = /^\s*([A-Za-z_.$?][\w.$?]*):/u.exec(source);
    kind = "label";
    if (match === null) {
      match = /^\s*%macro\s+([A-Za-z_.$?][\w.$?]*)/iu.exec(source);
      kind = "macro";
    }
    if (match === null) {
      match = /^\s*([A-Za-z_.$?][\w.$?]*)\s+(?:equ|macro)\b/iu.exec(source);
      kind = "macro";
    }
  }
  const name = match?.[1];
  if (name === undefined || name.length > maximumViIdentifierCharacters)
    return undefined;
  return { column: Math.max(0, source.indexOf(name)), kind, line, name, path };
}
function includeForLine(
  filetype: ViFiletype,
  source: string,
): ViIncludeReference | undefined {
  if (filetype === "c" || filetype === "cpp") {
    const match = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/u.exec(source);
    if (match?.[2] !== undefined)
      return {
        authored: match[2],
        kind: match[1] === "<" ? "system" : "quoted",
      };
  }
  if (filetype === "asm") {
    const match = /^\s*(?:%include|include)\s+["<]?([^">\s]+)[">]?/iu.exec(
      source,
    );
    if (match?.[1] !== undefined) return { authored: match[1], kind: "asm" };
  }
  if (filetype === "python") {
    const match =
      /^\s*(?:from\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import|import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))/u.exec(
        source,
      );
    const authored = match?.[1] ?? match?.[2];
    if (authored !== undefined) return { authored, kind: "python" };
  }
  return undefined;
}
function lineComment(
  filetype: ViFiletype,
  source: readonly string[],
  index: number,
): boolean {
  if ((filetype === "python" || filetype === "shell") && source[index] === "#")
    return true;
  if (filetype === "basic") {
    if (source[index] === "'") return true;
    if (
      (index === 0 || /\s/u.test(source[index - 1] ?? "")) &&
      source
        .slice(index, index + 3)
        .join("")
        .toUpperCase() === "REM" &&
      (source[index + 3] === undefined || /\s/u.test(source[index + 3]!))
    ) {
      return true;
    }
  }
  if (
    (filetype === "c" || filetype === "cpp" || filetype === "json") &&
    source[index] === "/" &&
    source[index + 1] === "/"
  )
    return true;
  return filetype === "asm" && source[index] === ";";
}
function findPair(
  source: readonly string[],
  start: number,
  first: string,
  second: string,
): number {
  for (let index = start; index + 1 < source.length; index += 1)
    if (source[index] === first && source[index + 1] === second)
      return index + 2;
  return -1;
}
function findTriple(
  source: readonly string[],
  start: number,
  quote: string,
): number {
  for (let index = start; index + 2 < source.length; index += 1)
    if (
      source[index] === quote &&
      source[index + 1] === quote &&
      source[index + 2] === quote
    )
      return index + 3;
  return -1;
}
function quotedEnd(
  source: readonly string[],
  start: number,
  quote: string,
): number {
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    if (!escaped && source[index] === quote) return index + 1;
    escaped = source[index] === "\\" && !escaped;
  }
  return source.length;
}
function wordEnd(source: readonly string[], start: number): number {
  let index = start;
  while (
    index < source.length &&
    (wordStart(source[index]!) || digit(source[index]!))
  )
    index += 1;
  return index;
}
function skipSpace(source: readonly string[], start: number): number {
  let index = start;
  while (source[index] === " " || source[index] === "\t") index += 1;
  return index;
}
function digit(character: string): boolean {
  return character >= "0" && character <= "9";
}
function wordStart(character: string): boolean {
  return (
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    "_.$?".includes(character)
  );
}

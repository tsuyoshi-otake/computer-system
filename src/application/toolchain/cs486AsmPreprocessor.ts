import { Cs486CompileError, compileErrorAt } from "./cs486AsmDiagnostics.js";
import {
  tokenizeCs486Assembly,
  type Cs486AsmToken,
} from "./cs486AsmTokenizer.js";

export type Cs486AssemblerDialect = "dos" | "linux";

export interface Cs486AsmIncludeSource {
  readonly source: string;
  readonly sourceName: string;
}

export interface Cs486AsmPreprocessorOptions {
  readonly dialect?: Cs486AssemblerDialect;
  readonly include?: (
    request: string,
    fromSource: string,
  ) => Cs486AsmIncludeSource | undefined;
  readonly limits?: Partial<Cs486AsmPreprocessorLimits>;
  readonly sourceName?: string;
}

export interface Cs486AsmPreprocessorLimits {
  readonly expandedTokens: number;
  readonly includeDepth: number;
  readonly includeFiles: number;
  readonly lexicalTokens: number;
  readonly macroDepth: number;
  readonly macros: number;
  readonly sourceCharacters: number;
}

interface MacroDefinition {
  readonly body: readonly (readonly Cs486AsmToken[])[];
  readonly name: string;
  readonly parameterNames?: readonly string[];
  readonly parameterCount: number;
}

export const cs486AsmPreprocessorLimits: Readonly<Cs486AsmPreprocessorLimits> =
  Object.freeze({
    expandedTokens: 2_000_000,
    includeDepth: 8,
    includeFiles: 64,
    lexicalTokens: 2_000_000,
    macroDepth: 16,
    macros: 256,
    sourceCharacters: 8 * 1_048_576,
  });

function resolvePreprocessorLimits(
  requested: Partial<Cs486AsmPreprocessorLimits> | undefined,
): Cs486AsmPreprocessorLimits {
  const resolved: Cs486AsmPreprocessorLimits = {
    ...cs486AsmPreprocessorLimits,
    ...requested,
  };
  for (const key of Object.keys(
    resolved,
  ) as (keyof Cs486AsmPreprocessorLimits)[])
    if (
      !Number.isSafeInteger(resolved[key]) ||
      resolved[key] < 1 ||
      resolved[key] > cs486AsmPreprocessorLimits[key]
    )
      throw new RangeError(`invalid assembly preprocessor ${key} limit`);
  return resolved;
}

export function preprocessCs486Assembly(
  source: string,
  options: Cs486AsmPreprocessorOptions = {},
): readonly Cs486AsmToken[] {
  const limits = resolvePreprocessorLimits(options.limits);
  const definitions = new Map<string, readonly Cs486AsmToken[]>();
  const macros = new Map<string, MacroDefinition>();
  const includeStack: string[] = [];
  let expansionSequence = 0;
  let includeFiles = 0;
  let expandedTokens = 0;
  let lexicalTokens = 0;
  let sourceCharacters = 0;

  const reserveExpanded = (count: number, token: Cs486AsmToken): void => {
    if (count > limits.expandedTokens - expandedTokens)
      throw compileErrorAt("preprocessor token limit exceeded", token.span);
    expandedTokens += count;
  };

  const processSource = (
    value: string,
    sourceName: string,
    depth: number,
  ): Cs486AsmToken[] => {
    if (depth > limits.includeDepth)
      throw new Cs486CompileError("assembly include depth exceeded", 1, {
        column: 1,
        source: sourceName,
      });
    if (includeStack.includes(sourceName))
      throw new Cs486CompileError(
        `circular assembly include ${sourceName}`,
        1,
        { column: 1, source: sourceName },
      );
    if (value.length > limits.sourceCharacters - sourceCharacters)
      throw new Cs486CompileError(
        "assembly source character limit exceeded",
        1,
        { column: 1, source: sourceName },
      );
    sourceCharacters += value.length;
    includeStack.push(sourceName);
    try {
      const tokens = tokenizeCs486Assembly(value, {
        maximumTokens: limits.lexicalTokens - lexicalTokens,
        sourceName,
      });
      lexicalTokens += tokens.length - 1;
      const lines = tokenLines(tokens);
      const output: Cs486AsmToken[] = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        if (line.length === 0) continue;
        const first = lower(line[0]);
        if (first === "%define") {
          const name = line[1];
          if (name?.kind !== "identifier" || line.length < 3)
            throw compileErrorAt(
              "%define expects a name and replacement",
              line[0]!.span,
            );
          definitions.set(name.value, line.slice(2));
          continue;
        }
        if (
          first === "%include" ||
          (options.dialect === "dos" && first === "include")
        ) {
          const request = line[1];
          if (request?.kind !== "string" || line.length !== 2)
            throw compileErrorAt(
              "include expects one quoted path",
              line[0]!.span,
            );
          if (options.include === undefined)
            throw compileErrorAt(
              "assembly includes are unavailable",
              request.span,
            );
          includeFiles += 1;
          if (includeFiles > limits.includeFiles)
            throw compileErrorAt(
              "assembly include file limit exceeded",
              request.span,
            );
          const included = options.include(request.value, sourceName);
          if (included === undefined)
            throw compileErrorAt(
              `include file not found: ${request.value}`,
              request.span,
            );
          if (depth + 1 > limits.includeDepth)
            throw compileErrorAt(
              "assembly include depth exceeded",
              request.span,
            );
          if (includeStack.includes(included.sourceName))
            throw compileErrorAt(
              `circular assembly include ${included.sourceName}`,
              request.span,
            );
          appendTokens(
            output,
            processSource(included.source, included.sourceName, depth + 1),
          );
          continue;
        }
        const nasmMacro = first === "%macro";
        const dosMacro =
          options.dialect === "dos" && lower(line[1]) === "macro";
        if (nasmMacro || dosMacro) {
          const name = nasmMacro ? line[1] : line[0];
          if (name?.kind !== "identifier")
            throw compileErrorAt("macro expects a name", line[0]!.span);
          if (macros.size >= limits.macros && !macros.has(name.value))
            throw compileErrorAt("macro definition limit exceeded", name.span);
          let parameterCount: number;
          let parameterNames: readonly string[] | undefined;
          if (nasmMacro) {
            const count = line[2];
            parameterCount = count === undefined ? 0 : parseMacroCount(count);
            if (line.length !== (count === undefined ? 2 : 3))
              throw compileErrorAt(
                "%macro expects a name and parameter count",
                line[0]!.span,
              );
          } else {
            const parameterTokens = line.slice(2);
            parameterNames = splitArguments(parameterTokens).map((argument) => {
              if (argument.length !== 1 || argument[0]!.kind !== "identifier")
                throw compileErrorAt(
                  "invalid DOS macro parameter",
                  argument[0]?.span ?? name.span,
                );
              return argument[0]!.value;
            });
            parameterCount = parameterNames.length;
          }
          const body: (readonly Cs486AsmToken[])[] = [];
          let terminated = false;
          while ((index += 1) < lines.length) {
            const bodyLine = lines[index]!;
            const marker = lower(bodyLine[0]);
            if (
              (nasmMacro && marker === "%endmacro") ||
              (dosMacro && marker === "endm")
            ) {
              terminated = true;
              break;
            }
            body.push(bodyLine);
          }
          if (!terminated)
            throw compileErrorAt("unterminated macro definition", name.span);
          macros.set(name.value, {
            body,
            name: name.value,
            parameterCount,
            parameterNames,
          });
          continue;
        }
        const expanded = expandLine(line, 0);
        appendTokens(output, expanded);
        const newline = newlineAfter(line[line.length - 1]!);
        reserveExpanded(1, newline);
        output.push(newline);
      }
      return output;
    } finally {
      includeStack.pop();
    }
  };

  const expandLine = (
    input: readonly Cs486AsmToken[],
    depth: number,
  ): Cs486AsmToken[] => {
    if (depth > limits.macroDepth)
      throw compileErrorAt("macro expansion depth exceeded", input[0]!.span);
    const expandedDefinitions = expandDefinitions(
      input,
      definitions,
      limits.expandedTokens - expandedTokens,
    );
    const macro = macros.get(expandedDefinitions[0]?.value ?? "");
    if (macro === undefined) {
      const first = expandedDefinitions[0];
      if (first !== undefined)
        reserveExpanded(expandedDefinitions.length, first);
      return [...expandedDefinitions];
    }
    const arguments_ = splitArguments(expandedDefinitions.slice(1));
    if (arguments_.length !== macro.parameterCount)
      throw compileErrorAt(
        `macro ${macro.name} expects ${String(macro.parameterCount)} argument(s)`,
        expandedDefinitions[0]!.span,
      );
    expansionSequence += 1;
    const output: Cs486AsmToken[] = [];
    for (const bodyLine of macro.body) {
      const substituted = substituteMacroLine(
        bodyLine,
        arguments_,
        macro,
        expansionSequence,
        limits.expandedTokens - expandedTokens,
      );
      appendTokens(output, expandLine(substituted, depth + 1));
      const newline = newlineAfter(bodyLine.at(-1) ?? expandedDefinitions[0]!);
      reserveExpanded(1, newline);
      output.push(newline);
    }
    return output;
  };

  const output = processSource(source, options.sourceName ?? "<assembly>", 0);
  const end = output.at(-1)?.span.end ?? {
    column: 1,
    line: 1,
    offset: 0,
    source: options.sourceName ?? "<assembly>",
  };
  output.push({ kind: "eof", raw: "", span: { end, start: end }, value: "" });
  return output;
}

function tokenLines(tokens: readonly Cs486AsmToken[]): Cs486AsmToken[][] {
  const lines: Cs486AsmToken[][] = [];
  let line: Cs486AsmToken[] = [];
  for (const token of tokens) {
    if (token.kind === "newline" || token.kind === "eof") {
      lines.push(line);
      line = [];
    } else line.push(token);
  }
  return lines;
}

function lower(token: Cs486AsmToken | undefined): string {
  return token?.kind === "identifier" ? token.value.toLowerCase() : "";
}

function parseMacroCount(token: Cs486AsmToken): number {
  const value = Number(token.value);
  if (!Number.isSafeInteger(value) || value < 0 || value > 32)
    throw compileErrorAt(
      "macro parameter count must be between 0 and 32",
      token.span,
    );
  return value;
}

function splitArguments(
  tokens: readonly Cs486AsmToken[],
): readonly (readonly Cs486AsmToken[])[] {
  if (tokens.length === 0) return [];
  const result: Cs486AsmToken[][] = [];
  let current: Cs486AsmToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === "[" || token.value === "(") depth += 1;
    else if (token.value === "]" || token.value === ")") depth -= 1;
    if (token.value === "," && depth === 0) {
      result.push(current);
      current = [];
    } else current.push(token);
  }
  result.push(current);
  return result;
}

function substituteMacroLine(
  bodyLine: readonly Cs486AsmToken[],
  arguments_: readonly (readonly Cs486AsmToken[])[],
  macro: MacroDefinition,
  expansionSequence: number,
  maximumTokens: number,
): Cs486AsmToken[] {
  const output: Cs486AsmToken[] = [];
  for (const token of bodyLine) {
    const positional = /^%(\d+)$/u.exec(token.value);
    const namedIndex = macro.parameterNames?.indexOf(token.value) ?? -1;
    const replacement: readonly Cs486AsmToken[] =
      positional !== null
        ? (arguments_[Number(positional[1]) - 1] ?? [])
        : namedIndex >= 0
          ? (arguments_[namedIndex] ?? [])
          : token.kind === "identifier" && token.value.startsWith("%%")
            ? [
                {
                  ...token,
                  raw: `__m${String(expansionSequence)}_${token.value.slice(2)}`,
                  value: `__m${String(expansionSequence)}_${token.value.slice(2)}`,
                },
              ]
            : [token];
    if (replacement.length > maximumTokens - output.length)
      throw compileErrorAt("preprocessor token limit exceeded", token.span);
    appendTokens(output, replacement);
  }
  return output;
}

function expandDefinitions(
  tokens: readonly Cs486AsmToken[],
  definitions: ReadonlyMap<string, readonly Cs486AsmToken[]>,
  maximumTokens: number,
): readonly Cs486AsmToken[] {
  if (tokens.length > maximumTokens && tokens[0] !== undefined)
    throw compileErrorAt("preprocessor token limit exceeded", tokens[0].span);
  let current = [...tokens];
  for (let pass = 0; pass < 16; pass += 1) {
    let changed = false;
    const next: Cs486AsmToken[] = [];
    for (const token of current) {
      const replacement =
        token.kind === "identifier" ? definitions.get(token.value) : undefined;
      const emitted = replacement ?? [token];
      if (replacement !== undefined) changed = true;
      if (emitted.length > maximumTokens - next.length)
        throw compileErrorAt("preprocessor token limit exceeded", token.span);
      appendTokens(next, emitted);
    }
    if (!changed) return next;
    current = next;
  }
  if (current[0] !== undefined)
    throw compileErrorAt("recursive %define expansion", current[0].span);
  return current;
}

function appendTokens(
  target: Cs486AsmToken[],
  source: readonly Cs486AsmToken[],
): void {
  for (const token of source) target.push(token);
}

function newlineAfter(token: Cs486AsmToken): Cs486AsmToken {
  const position = token.span.end;
  return {
    kind: "newline",
    raw: "\n",
    span: { end: position, start: position },
    value: "\n",
  };
}

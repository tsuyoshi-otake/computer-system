import {
  compileErrorAt,
  type Cs486DiagnosticNote,
  type Cs486SourcePosition,
  type Cs486SourceSpan,
} from "./cs486AsmDiagnostics.js";

export type Cs486CPreprocessorTokenKind =
  "identifier" | "number" | "punctuation" | "string";

export interface Cs486CPreprocessorToken {
  readonly kind: Cs486CPreprocessorTokenKind;
  readonly leadingSpace: boolean;
  readonly raw: string;
  readonly span: Cs486SourceSpan;
  readonly value: string;
}

export interface Cs486CPreprocessorIncludeRequest {
  readonly fromSource: string;
  readonly path: string;
  readonly quoted: boolean;
}

export interface Cs486CPreprocessorInclude {
  /** Profile-normalized identity used for bounded include-cycle detection. */
  readonly identity?: string;
  readonly source: string;
  readonly sourceName: string;
}

export interface Cs486CPreprocessorDefinition {
  readonly name: string;
  readonly replacement?: string;
}

export interface Cs486CPreprocessorOptions {
  readonly definitions?: readonly Cs486CPreprocessorDefinition[];
  readonly include?: (
    request: Cs486CPreprocessorIncludeRequest,
  ) => Cs486CPreprocessorInclude | undefined;
  readonly sourceName?: string;
  readonly undefines?: readonly string[];
}

interface MappedLine {
  readonly positions: readonly Cs486SourcePosition[];
  readonly text: string;
}

interface MacroDefinition {
  readonly functionLike: boolean;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly replacement: readonly Cs486CPreprocessorToken[];
  readonly span: Cs486SourceSpan;
}

interface ConditionalFrame {
  active: boolean;
  branchTaken: boolean;
  elseSeen: boolean;
  readonly parentActive: boolean;
}

interface PreprocessorState {
  aggregateSourceCharacters: number;
  emittedTokens: number;
  includeFiles: number;
  readonly includeStack: string[];
  readonly macros: Map<string, MacroDefinition>;
  readonly options: Cs486CPreprocessorOptions;
  readonly output: Cs486CPreprocessorToken[];
}

const maximumRootSourceCharacters = 128_000;
const maximumAggregateSourceCharacters = 512_000;
const maximumEmittedTokens = 32_000;
const maximumIncludeDepth = 16;
const maximumIncludeFiles = 64;
const maximumConditionalDepth = 64;
const maximumMacroDefinitions = 512;
const maximumMacroParameters = 64;
const maximumMacroExpansionDepth = 64;
const maximumMacroReplacementTokens = 2_048;
const maximumLogicalLineCharacters = 32_768;
const maximumIdentifierCharacters = 64;
const maximumDiagnosticNotes = 8;

const multiCharacterPunctuation = [
  "##",
  "<<=",
  ">>=",
  "...",
  "++",
  "--",
  "->",
  "&&",
  "||",
  "<=",
  ">=",
  "==",
  "!=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<",
  ">>",
  "::",
] as const;

const ifOperatorPrecedence = new Map<string, number>([
  ["||", 1],
  ["&&", 2],
  ["|", 3],
  ["^", 4],
  ["&", 5],
  ["==", 6],
  ["!=", 6],
  ["<", 7],
  ["<=", 7],
  [">", 7],
  [">=", 7],
  ["<<", 8],
  [">>", 8],
  ["+", 9],
  ["-", 9],
  ["*", 10],
  ["/", 10],
  ["%", 10],
]);

export function preprocessCs486C(
  source: string,
  options: Cs486CPreprocessorOptions = {},
): readonly Cs486CPreprocessorToken[] {
  const sourceName = options.sourceName ?? "<c-family>";
  if (source.length > maximumRootSourceCharacters) {
    throw preprocessorError(
      "source limit exceeded",
      pointSpan(sourceName, 1, 1, 0),
    );
  }
  const state: PreprocessorState = {
    aggregateSourceCharacters: 0,
    emittedTokens: 0,
    includeFiles: 0,
    includeStack: [],
    macros: new Map(),
    options,
    output: [],
  };
  installCommandLineDefinitions(state, sourceName);
  processFile(state, source, sourceName, sourceName, 0);
  return state.output;
}

function installCommandLineDefinitions(
  state: PreprocessorState,
  sourceName: string,
): void {
  for (const definition of state.options.definitions ?? []) {
    assertMacroName(definition.name, pointSpan(sourceName, 1, 1, 0));
    const replacement = tokenizeMappedLine(
      mappedLineFromText(definition.replacement ?? "1", sourceName),
      { blockComment: false },
    );
    defineMacro(state, {
      functionLike: false,
      name: definition.name,
      parameters: [],
      replacement,
      span: pointSpan(sourceName, 1, 1, 0),
    });
  }
  for (const name of state.options.undefines ?? []) {
    assertMacroName(name, pointSpan(sourceName, 1, 1, 0));
    state.macros.delete(name);
  }
}

function processFile(
  state: PreprocessorState,
  source: string,
  sourceName: string,
  identity: string,
  depth: number,
  sourceNotes: readonly Cs486DiagnosticNote[] = [],
): void {
  if (depth > maximumIncludeDepth) {
    throw preprocessorError(
      "include depth limit exceeded",
      withDiagnosticNotes(pointSpan(sourceName, 1, 1, 0), sourceNotes),
    );
  }
  if (state.includeStack.includes(identity)) {
    throw preprocessorError(
      `circular include detected for ${sourceName}`,
      withDiagnosticNotes(pointSpan(sourceName, 1, 1, 0), sourceNotes),
    );
  }
  state.aggregateSourceCharacters += source.length;
  if (state.aggregateSourceCharacters > maximumAggregateSourceCharacters) {
    throw preprocessorError(
      "aggregate include source limit exceeded",
      withDiagnosticNotes(pointSpan(sourceName, 1, 1, 0), sourceNotes),
    );
  }
  state.includeStack.push(identity);
  const conditionals: ConditionalFrame[] = [];
  const lexerState = { blockComment: false };
  try {
    for (const line of mappedLogicalLines(source, sourceName)) {
      if (line.text.length > maximumLogicalLineCharacters) {
        throw preprocessorError(
          "logical line limit exceeded",
          spanForRange(line, 0, line.text.length),
        );
      }
      const tokens = tokenizeMappedLine(line, lexerState).map((token) =>
        sourceNotes.length === 0
          ? token
          : {
              ...token,
              span: withDiagnosticNotes(token.span, sourceNotes),
            },
      );
      const directive = directiveTokens(tokens);
      if (directive !== undefined) {
        processDirective(state, directive, conditionals, sourceName, depth);
        continue;
      }
      if (!conditionalActive(conditionals) || tokens.length === 0) continue;
      appendOutput(state, expandTokens(state, tokens, new Set<string>(), 0));
    }
    if (lexerState.blockComment) {
      throw preprocessorError(
        "unterminated block comment",
        withDiagnosticNotes(pointSpan(sourceName, 1, 1, 0), sourceNotes),
      );
    }
    if (conditionals.length !== 0) {
      throw preprocessorError(
        "unterminated conditional directive",
        withDiagnosticNotes(pointSpan(sourceName, 1, 1, 0), sourceNotes),
      );
    }
  } finally {
    state.includeStack.pop();
  }
}

function processDirective(
  state: PreprocessorState,
  tokens: readonly Cs486CPreprocessorToken[],
  conditionals: ConditionalFrame[],
  sourceName: string,
  depth: number,
): void {
  if (tokens.length === 0) return;
  const name = tokens[0]!;
  if (name.kind !== "identifier") {
    throw preprocessorError("invalid preprocessor directive", name.span);
  }
  const rest = tokens.slice(1);
  if (
    name.value === "if" ||
    name.value === "ifdef" ||
    name.value === "ifndef"
  ) {
    beginConditional(state, conditionals, name, rest);
    return;
  }
  if (name.value === "elif") {
    continueConditional(state, conditionals, name, rest);
    return;
  }
  if (name.value === "else") {
    elseConditional(conditionals, name, rest);
    return;
  }
  if (name.value === "endif") {
    endConditional(conditionals, name, rest);
    return;
  }
  if (!conditionalActive(conditionals)) return;
  if (name.value === "include") {
    includeFile(state, rest, sourceName, depth, name.span);
    return;
  }
  if (name.value === "define") {
    parseDefine(state, rest, name.span);
    return;
  }
  if (name.value === "undef") {
    if (rest.length !== 1 || rest[0]!.kind !== "identifier") {
      throw preprocessorError("#undef requires one macro name", name.span);
    }
    state.macros.delete(rest[0]!.value);
    return;
  }
  if (name.value === "error") {
    const detail = joinTokens(rest).trim();
    throw preprocessorError(
      detail.length === 0 ? "#error" : `#error ${detail}`,
      name.span,
    );
  }
  throw preprocessorError(
    `unsupported preprocessor directive #${name.value}`,
    name.span,
  );
}

function directiveTokens(
  tokens: readonly Cs486CPreprocessorToken[],
): readonly Cs486CPreprocessorToken[] | undefined {
  const first = tokens[0];
  if (first?.raw !== "#") return undefined;
  return tokens.slice(1);
}

function beginConditional(
  state: PreprocessorState,
  stack: ConditionalFrame[],
  directive: Cs486CPreprocessorToken,
  tokens: readonly Cs486CPreprocessorToken[],
): void {
  if (stack.length >= maximumConditionalDepth) {
    throw preprocessorError(
      "conditional nesting limit exceeded",
      directive.span,
    );
  }
  const parentActive = conditionalActive(stack);
  let condition = false;
  if (parentActive) {
    if (directive.value === "ifdef" || directive.value === "ifndef") {
      if (tokens.length !== 1 || tokens[0]!.kind !== "identifier") {
        throw preprocessorError(
          `#${directive.value} requires one macro name`,
          directive.span,
        );
      }
      condition = state.macros.has(tokens[0]!.value);
      if (directive.value === "ifndef") condition = !condition;
    } else {
      condition = evaluateIfExpression(state, tokens, directive.span) !== 0;
    }
  }
  stack.push({
    active: parentActive && condition,
    branchTaken: parentActive && condition,
    elseSeen: false,
    parentActive,
  });
}

function continueConditional(
  state: PreprocessorState,
  stack: ConditionalFrame[],
  directive: Cs486CPreprocessorToken,
  tokens: readonly Cs486CPreprocessorToken[],
): void {
  const frame = stack.at(-1);
  if (frame === undefined)
    throw preprocessorError("#elif without matching #if", directive.span);
  if (frame.elseSeen)
    throw preprocessorError("#elif after #else", directive.span);
  const condition =
    frame.parentActive && !frame.branchTaken
      ? evaluateIfExpression(state, tokens, directive.span) !== 0
      : false;
  frame.active = frame.parentActive && !frame.branchTaken && condition;
  if (frame.active) frame.branchTaken = true;
}

function elseConditional(
  stack: ConditionalFrame[],
  directive: Cs486CPreprocessorToken,
  tokens: readonly Cs486CPreprocessorToken[],
): void {
  const frame = stack.at(-1);
  if (frame === undefined)
    throw preprocessorError("#else without matching #if", directive.span);
  if (tokens.length !== 0)
    throw preprocessorError("tokens after #else", tokens[0]!.span);
  if (frame.elseSeen)
    throw preprocessorError("duplicate #else", directive.span);
  frame.elseSeen = true;
  frame.active = frame.parentActive && !frame.branchTaken;
  if (frame.active) frame.branchTaken = true;
}

function endConditional(
  stack: ConditionalFrame[],
  directive: Cs486CPreprocessorToken,
  tokens: readonly Cs486CPreprocessorToken[],
): void {
  if (tokens.length !== 0)
    throw preprocessorError("tokens after #endif", tokens[0]!.span);
  if (stack.pop() === undefined)
    throw preprocessorError("#endif without matching #if", directive.span);
}

function conditionalActive(stack: readonly ConditionalFrame[]): boolean {
  return stack.at(-1)?.active ?? true;
}

function includeFile(
  state: PreprocessorState,
  sourceTokens: readonly Cs486CPreprocessorToken[],
  sourceName: string,
  depth: number,
  directiveSpan: Cs486SourceSpan,
): void {
  const tokens = expandTokens(state, sourceTokens, new Set<string>(), 0);
  let path: string;
  let quoted: boolean;
  if (tokens.length === 1 && tokens[0]!.kind === "string") {
    path = tokens[0]!.value;
    quoted = true;
  } else if (tokens[0]?.raw === "<" && tokens.at(-1)?.raw === ">") {
    path = tokens
      .slice(1, -1)
      .map((token) => token.raw)
      .join("");
    quoted = false;
  } else {
    throw preprocessorError("invalid #include operand", directiveSpan);
  }
  if (path.length === 0 || path.length > 128) {
    throw preprocessorError("include path limit exceeded", directiveSpan);
  }
  const include = state.options.include?.({
    fromSource: sourceName,
    path,
    quoted,
  });
  if (include === undefined) {
    throw preprocessorError(`include file not found: ${path}`, directiveSpan);
  }
  state.includeFiles += 1;
  if (state.includeFiles > maximumIncludeFiles) {
    throw preprocessorError("include file limit exceeded", directiveSpan);
  }
  processFile(
    state,
    include.source,
    include.sourceName,
    include.identity ?? include.sourceName,
    depth + 1,
    includeDiagnosticNotes(directiveSpan, sourceName),
  );
}

function includeDiagnosticNotes(
  directiveSpan: Cs486SourceSpan,
  sourceName: string,
): readonly Cs486DiagnosticNote[] {
  return [
    {
      message: `included from ${sourceName}`,
      span: directiveSpan,
    },
    ...(directiveSpan.diagnosticNotes ?? []),
  ].slice(0, maximumDiagnosticNotes);
}

function parseDefine(
  state: PreprocessorState,
  tokens: readonly Cs486CPreprocessorToken[],
  directiveSpan: Cs486SourceSpan,
): void {
  const name = tokens[0];
  if (name?.kind !== "identifier") {
    throw preprocessorError("#define requires a macro name", directiveSpan);
  }
  assertMacroName(name.value, name.span);
  let index = 1;
  let functionLike = false;
  const parameters: string[] = [];
  if (tokens[index]?.raw === "(" && tokens[index]!.leadingSpace === false) {
    functionLike = true;
    index += 1;
    if (tokens[index]?.raw !== ")") {
      for (;;) {
        const parameter = tokens[index];
        if (parameter?.kind !== "identifier") {
          throw preprocessorError(
            "macro parameter name expected",
            parameter?.span ?? name.span,
          );
        }
        if (parameters.includes(parameter.value)) {
          throw preprocessorError(
            `duplicate macro parameter ${parameter.value}`,
            parameter.span,
          );
        }
        parameters.push(parameter.value);
        if (parameters.length > maximumMacroParameters) {
          throw preprocessorError(
            "macro parameter limit exceeded",
            parameter.span,
          );
        }
        index += 1;
        if (tokens[index]?.raw === ")") break;
        if (tokens[index]?.raw !== ",") {
          throw preprocessorError(
            "expected ',' or ')' in macro parameters",
            tokens[index]?.span ?? name.span,
          );
        }
        index += 1;
      }
    }
    index += 1;
  }
  const replacement = tokens.slice(index);
  if (replacement.length > maximumMacroReplacementTokens) {
    throw preprocessorError("macro replacement limit exceeded", name.span);
  }
  validateReplacement(parameters, replacement, name.span);
  defineMacro(state, {
    functionLike,
    name: name.value,
    parameters,
    replacement,
    span: name.span,
  });
}

function validateReplacement(
  parameters: readonly string[],
  replacement: readonly Cs486CPreprocessorToken[],
  span: Cs486SourceSpan,
): void {
  for (let index = 0; index < replacement.length; index += 1) {
    const token = replacement[index]!;
    if (token.raw === "#") {
      const next = replacement[index + 1];
      if (next?.kind !== "identifier" || !parameters.includes(next.value)) {
        throw preprocessorError(
          "# must stringify a macro parameter",
          token.span,
        );
      }
    }
    if (
      token.raw === "##" &&
      (index === 0 || index + 1 === replacement.length)
    ) {
      throw preprocessorError("## cannot appear at a replacement edge", span);
    }
  }
}

function defineMacro(
  state: PreprocessorState,
  definition: MacroDefinition,
): void {
  const previous = state.macros.get(definition.name);
  if (previous === undefined && state.macros.size >= maximumMacroDefinitions) {
    throw preprocessorError("macro definition limit exceeded", definition.span);
  }
  if (previous !== undefined && !sameMacro(previous, definition)) {
    throw preprocessorError(
      `incompatible redefinition of ${definition.name}`,
      definition.span,
    );
  }
  state.macros.set(definition.name, definition);
}

function sameMacro(left: MacroDefinition, right: MacroDefinition): boolean {
  return (
    left.functionLike === right.functionLike &&
    left.parameters.join("\0") === right.parameters.join("\0") &&
    left.replacement.map((token) => token.raw).join("\0") ===
      right.replacement.map((token) => token.raw).join("\0")
  );
}

function expandTokens(
  state: PreprocessorState,
  tokens: readonly Cs486CPreprocessorToken[],
  disabled: ReadonlySet<string>,
  depth: number,
): readonly Cs486CPreprocessorToken[] {
  if (depth > maximumMacroExpansionDepth) {
    throw preprocessorError(
      "macro expansion depth limit exceeded",
      tokens[0]?.span ?? pointSpan("<macro>", 1, 1, 0),
    );
  }
  const output: Cs486CPreprocessorToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const macro =
      token.kind === "identifier" && !disabled.has(token.value)
        ? state.macros.get(token.value)
        : undefined;
    if (macro === undefined) {
      appendExpansionTokens(output, [token], token.span);
      continue;
    }
    if (!macro.functionLike) {
      const nextDisabled = new Set(disabled);
      nextDisabled.add(macro.name);
      const expansionSpan = macroExpansionSpan(token.span, macro);
      appendExpansionTokens(
        output,
        expandTokens(
          state,
          cloneForExpansion(macro.replacement, expansionSpan),
          nextDisabled,
          depth + 1,
        ),
        expansionSpan,
      );
      continue;
    }
    if (tokens[index + 1]?.raw !== "(") {
      appendExpansionTokens(output, [token], token.span);
      continue;
    }
    const invocation = parseMacroArguments(tokens, index + 1, token.span);
    index = invocation.endIndex;
    if (
      invocation.arguments.length !== macro.parameters.length &&
      !(
        macro.parameters.length === 0 &&
        invocation.arguments.length === 1 &&
        invocation.arguments[0]!.length === 0
      )
    ) {
      throw preprocessorError(
        `${macro.name} expects ${String(macro.parameters.length)} macro arguments`,
        token.span,
      );
    }
    const arguments_ =
      macro.parameters.length === 0 ? [] : invocation.arguments;
    const substituted = substituteMacro(
      state,
      macro,
      arguments_,
      token.span,
      disabled,
      depth,
    );
    const nextDisabled = new Set(disabled);
    nextDisabled.add(macro.name);
    appendExpansionTokens(
      output,
      expandTokens(state, substituted, nextDisabled, depth + 1),
      token.span,
    );
  }
  return output;
}

function parseMacroArguments(
  tokens: readonly Cs486CPreprocessorToken[],
  openingIndex: number,
  span: Cs486SourceSpan,
): {
  readonly arguments: readonly (readonly Cs486CPreprocessorToken[])[];
  readonly endIndex: number;
} {
  const arguments_: Cs486CPreprocessorToken[][] = [[]];
  let nested = 0;
  for (let index = openingIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.raw === "(") {
      nested += 1;
      arguments_.at(-1)!.push(token);
      continue;
    }
    if (token.raw === ")") {
      if (nested === 0) return { arguments: arguments_, endIndex: index };
      nested -= 1;
      arguments_.at(-1)!.push(token);
      continue;
    }
    if (token.raw === "," && nested === 0) {
      if (arguments_.length >= maximumMacroParameters) {
        throw preprocessorError("macro argument limit exceeded", token.span);
      }
      arguments_.push([]);
      continue;
    }
    arguments_.at(-1)!.push(token);
  }
  throw preprocessorError("unterminated macro invocation", span);
}

function substituteMacro(
  state: PreprocessorState,
  macro: MacroDefinition,
  arguments_: readonly (readonly Cs486CPreprocessorToken[])[],
  invocationSpan: Cs486SourceSpan,
  disabled: ReadonlySet<string>,
  depth: number,
): readonly Cs486CPreprocessorToken[] {
  const expansionSpan = macroExpansionSpan(invocationSpan, macro);
  const rawArguments = new Map<string, readonly Cs486CPreprocessorToken[]>();
  const expandedArguments = new Map<
    string,
    readonly Cs486CPreprocessorToken[]
  >();
  for (const [index, parameter] of macro.parameters.entries()) {
    const raw = arguments_[index] ?? [];
    rawArguments.set(parameter, raw);
    expandedArguments.set(
      parameter,
      expandTokens(state, raw, disabled, depth + 1),
    );
  }
  const substituted: Cs486CPreprocessorToken[] = [];
  for (let index = 0; index < macro.replacement.length; index += 1) {
    const token = macro.replacement[index]!;
    if (token.raw === "#") {
      const parameter = macro.replacement[++index]!;
      const raw = rawArguments.get(parameter.value) ?? [];
      const value = stringifyTokens(raw);
      substituted.push({
        kind: "string",
        leadingSpace: token.leadingSpace,
        raw: JSON.stringify(value),
        span: expansionSpan,
        value,
      });
      continue;
    }
    const parameter =
      token.kind === "identifier" && rawArguments.has(token.value)
        ? token.value
        : undefined;
    const adjacentPaste =
      macro.replacement[index - 1]?.raw === "##" ||
      macro.replacement[index + 1]?.raw === "##";
    if (parameter !== undefined) {
      const replacement = adjacentPaste
        ? rawArguments.get(parameter)!
        : expandedArguments.get(parameter)!;
      appendExpansionTokens(
        substituted,
        cloneForExpansion(replacement, expansionSpan),
        expansionSpan,
      );
    } else {
      appendExpansionTokens(
        substituted,
        cloneForExpansion([token], expansionSpan),
        expansionSpan,
      );
    }
  }
  return pasteTokens(substituted, expansionSpan);
}

function macroExpansionSpan(
  invocationSpan: Cs486SourceSpan,
  macro: MacroDefinition,
): Cs486SourceSpan {
  return withDiagnosticNotes(invocationSpan, [
    {
      message: `expanded from macro ${macro.name} defined here`,
      span: macro.span,
    },
    ...(invocationSpan.diagnosticNotes ?? []),
  ]);
}

function pasteTokens(
  tokens: readonly Cs486CPreprocessorToken[],
  span: Cs486SourceSpan,
): readonly Cs486CPreprocessorToken[] {
  const output: Cs486CPreprocessorToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.raw !== "##") {
      appendExpansionTokens(output, [token], token.span);
      continue;
    }
    const left = output.pop();
    const right = tokens[++index];
    if (left === undefined || right === undefined || right.raw === "##") {
      throw preprocessorError("invalid token paste", span);
    }
    const pasted = tokenizeMappedLine(
      mappedLineFromText(
        `${left.raw}${right.raw}`,
        span.start.source,
        span.start,
      ),
      { blockComment: false },
    );
    if (pasted.length !== 1) {
      throw preprocessorError("token paste must produce one token", span);
    }
    appendExpansionTokens(
      output,
      [{ ...pasted[0]!, leadingSpace: left.leadingSpace, span }],
      span,
    );
  }
  return output;
}

function appendExpansionTokens(
  target: Cs486CPreprocessorToken[],
  tokens: readonly Cs486CPreprocessorToken[],
  span: Cs486SourceSpan,
): void {
  if (target.length + tokens.length > maximumEmittedTokens) {
    throw preprocessorError("macro expansion token limit exceeded", span);
  }
  for (const token of tokens) target.push(token);
}

function cloneForExpansion(
  tokens: readonly Cs486CPreprocessorToken[],
  span: Cs486SourceSpan,
): readonly Cs486CPreprocessorToken[] {
  return tokens.map((token) => ({ ...token, span }));
}

function stringifyTokens(tokens: readonly Cs486CPreprocessorToken[]): string {
  let result = "";
  for (const token of tokens) {
    if (result.length > 0 && token.leadingSpace) result += " ";
    result += token.raw;
  }
  return result;
}

function appendOutput(
  state: PreprocessorState,
  tokens: readonly Cs486CPreprocessorToken[],
): void {
  if (state.emittedTokens + tokens.length > maximumEmittedTokens) {
    throw preprocessorError(
      "C-family lexical token limit exceeded",
      tokens.at(-1)?.span ?? pointSpan("<c-family>", 1, 1, 0),
    );
  }
  state.emittedTokens += tokens.length;
  for (const token of tokens) state.output.push(token);
}

function evaluateIfExpression(
  state: PreprocessorState,
  tokens: readonly Cs486CPreprocessorToken[],
  span: Cs486SourceSpan,
): number {
  const defined: Cs486CPreprocessorToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "identifier" || token.value !== "defined") {
      defined.push(token);
      continue;
    }
    let name: Cs486CPreprocessorToken | undefined;
    if (tokens[index + 1]?.raw === "(") {
      name = tokens[index + 2];
      if (name?.kind !== "identifier" || tokens[index + 3]?.raw !== ")") {
        throw preprocessorError("invalid defined expression", token.span);
      }
      index += 3;
    } else {
      name = tokens[++index];
      if (name?.kind !== "identifier") {
        throw preprocessorError("invalid defined expression", token.span);
      }
    }
    defined.push(numberToken(state.macros.has(name.value) ? 1 : 0, token.span));
  }
  const expanded = expandTokens(state, defined, new Set<string>(), 0).map(
    (token) =>
      token.kind === "identifier" ? numberToken(0, token.span) : token,
  );
  if (expanded.length === 0)
    throw preprocessorError("#if expression is empty", span);
  return new IfExpressionParser(expanded, span).parse();
}

class IfExpressionParser {
  private index = 0;

  constructor(
    private readonly tokens: readonly Cs486CPreprocessorToken[],
    private readonly span: Cs486SourceSpan,
  ) {}

  parse(): number {
    const value = this.binary(0);
    if (this.index !== this.tokens.length) {
      throw preprocessorError(
        `unsupported #if token ${this.tokens[this.index]!.raw}`,
        this.tokens[this.index]!.span,
      );
    }
    return value | 0;
  }

  private binary(minimumPrecedence: number): number {
    let left = this.unary();
    for (;;) {
      const operator = this.tokens[this.index]?.raw;
      const precedence =
        operator === undefined ? undefined : ifPrecedence(operator);
      if (precedence === undefined || precedence < minimumPrecedence) break;
      this.index += 1;
      const right = this.binary(precedence + 1);
      left = applyIfOperator(operator!, left, right, this.span);
    }
    return left;
  }

  private unary(): number {
    const token = this.tokens[this.index];
    if (token === undefined)
      throw preprocessorError("incomplete #if expression", this.span);
    if (
      token.raw === "!" ||
      token.raw === "~" ||
      token.raw === "+" ||
      token.raw === "-"
    ) {
      this.index += 1;
      const value = this.unary();
      if (token.raw === "!") return value === 0 ? 1 : 0;
      if (token.raw === "~") return ~value;
      return token.raw === "-" ? -value : value;
    }
    if (token.raw === "(") {
      this.index += 1;
      const value = this.binary(0);
      if (this.tokens[this.index]?.raw !== ")")
        throw preprocessorError("missing ')' in #if expression", token.span);
      this.index += 1;
      return value;
    }
    if (token.kind !== "number")
      throw preprocessorError(`integer expected in #if expression`, token.span);
    this.index += 1;
    const value = parsePreprocessorInteger(token.value);
    if (value === undefined)
      throw preprocessorError(`invalid #if integer ${token.raw}`, token.span);
    return value;
  }
}

function ifPrecedence(operator: string): number | undefined {
  return ifOperatorPrecedence.get(operator);
}

function applyIfOperator(
  operator: string,
  left: number,
  right: number,
  span: Cs486SourceSpan,
): number {
  switch (operator) {
    case "||":
      return left !== 0 || right !== 0 ? 1 : 0;
    case "&&":
      return left !== 0 && right !== 0 ? 1 : 0;
    case "|":
      return left | right;
    case "^":
      return left ^ right;
    case "&":
      return left & right;
    case "==":
      return left === right ? 1 : 0;
    case "!=":
      return left !== right ? 1 : 0;
    case "<":
      return left < right ? 1 : 0;
    case "<=":
      return left <= right ? 1 : 0;
    case ">":
      return left > right ? 1 : 0;
    case ">=":
      return left >= right ? 1 : 0;
    case "<<":
      return left << (right & 31);
    case ">>":
      return left >> (right & 31);
    case "+":
      return (left + right) | 0;
    case "-":
      return (left - right) | 0;
    case "*":
      return Math.imul(left, right);
    case "/":
      if (right === 0) throw preprocessorError("division by zero in #if", span);
      return Math.trunc(left / right) | 0;
    case "%":
      if (right === 0) throw preprocessorError("division by zero in #if", span);
      return left % right;
    default:
      throw preprocessorError(`unsupported #if operator ${operator}`, span);
  }
}

function tokenizeMappedLine(
  line: MappedLine,
  state: { blockComment: boolean },
): readonly Cs486CPreprocessorToken[] {
  const tokens: Cs486CPreprocessorToken[] = [];
  let index = 0;
  let leadingSpace = true;
  while (index < line.text.length) {
    if (state.blockComment) {
      const end = line.text.indexOf("*/", index);
      if (end < 0) return tokens;
      index = end + 2;
      state.blockComment = false;
      leadingSpace = true;
      continue;
    }
    const character = line.text[index]!;
    if (
      character === " " ||
      character === "\t" ||
      character === "\v" ||
      character === "\f"
    ) {
      leadingSpace = true;
      index += 1;
      continue;
    }
    if (line.text.slice(index, index + 2) === "//") break;
    if (line.text.slice(index, index + 2) === "/*") {
      state.blockComment = true;
      leadingSpace = true;
      index += 2;
      continue;
    }
    const start = index;
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      let escaped = false;
      while (index < line.text.length) {
        const next = line.text[index++]!;
        if (escaped) escaped = false;
        else if (next === "\\") escaped = true;
        else if (next === quote) break;
      }
      if (line.text[index - 1] !== quote) {
        throw preprocessorError(
          `unterminated ${quote === '"' ? "string" : "character"} literal`,
          spanForRange(line, start, index),
        );
      }
      const raw = line.text.slice(start, index);
      if (quote === "'") {
        tokens.push({
          kind: "number",
          leadingSpace,
          raw,
          span: spanForRange(line, start, index),
          value: String(characterConstant(raw)),
        });
      } else {
        let value: string;
        try {
          value = JSON.parse(raw) as string;
        } catch {
          throw preprocessorError(
            "invalid string literal",
            spanForRange(line, start, index),
          );
        }
        tokens.push({
          kind: "string",
          leadingSpace,
          raw,
          span: spanForRange(line, start, index),
          value,
        });
      }
      leadingSpace = false;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      index += 1;
      while (
        index < line.text.length &&
        /[A-Za-z0-9_]/u.test(line.text[index]!)
      )
        index += 1;
      const raw = line.text.slice(start, index);
      if (raw.length > maximumIdentifierCharacters) {
        throw preprocessorError(
          "identifier length limit exceeded",
          spanForRange(line, start, index),
        );
      }
      tokens.push({
        kind: "identifier",
        leadingSpace,
        raw,
        span: spanForRange(line, start, index),
        value: raw,
      });
      leadingSpace = false;
      continue;
    }
    if (/[0-9]/u.test(character)) {
      index += 1;
      while (
        index < line.text.length &&
        /[A-Za-z0-9_.]/u.test(line.text[index]!)
      )
        index += 1;
      const raw = line.text.slice(start, index);
      tokens.push({
        kind: "number",
        leadingSpace,
        raw,
        span: spanForRange(line, start, index),
        value: raw,
      });
      leadingSpace = false;
      continue;
    }
    const punctuation = multiCharacterPunctuation.find((candidate) =>
      line.text.startsWith(candidate, index),
    );
    const raw = punctuation ?? character;
    index += raw.length;
    tokens.push({
      kind: "punctuation",
      leadingSpace,
      raw,
      span: spanForRange(line, start, index),
      value: raw,
    });
    leadingSpace = false;
  }
  return tokens;
}

function mappedLogicalLines(
  source: string,
  sourceName: string,
): readonly MappedLine[] {
  const text: string[] = [];
  const positions: Cs486SourcePosition[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;
  const position = (): Cs486SourcePosition => ({
    column,
    line,
    offset,
    source: sourceName,
  });
  const consumeNewline = (): void => {
    if (source[offset] === "\r" && source[offset + 1] === "\n") offset += 2;
    else offset += 1;
    line += 1;
    column = 1;
  };
  while (offset < source.length) {
    if (
      source[offset] === "\\" &&
      (source[offset + 1] === "\n" || source[offset + 1] === "\r")
    ) {
      offset += 1;
      column += 1;
      consumeNewline();
      continue;
    }
    positions.push(position());
    if (source[offset] === "\n" || source[offset] === "\r") {
      text.push("\n");
      consumeNewline();
    } else {
      text.push(source[offset]!);
      offset += 1;
      column += 1;
    }
  }
  positions.push(position());
  const joined = text.join("");
  const lines: MappedLine[] = [];
  let start = 0;
  for (let index = 0; index <= joined.length; index += 1) {
    if (index < joined.length && joined[index] !== "\n") continue;
    lines.push({
      positions: positions.slice(start, index + 1),
      text: joined.slice(start, index),
    });
    start = index + 1;
  }
  return lines;
}

function mappedLineFromText(
  text: string,
  sourceName: string,
  start: Cs486SourcePosition = {
    column: 1,
    line: 1,
    offset: 0,
    source: sourceName,
  },
): MappedLine {
  const positions = Array.from(
    { length: text.length + 1 },
    (_unused, index) => ({
      column: start.column + index,
      line: start.line,
      offset: start.offset + index,
      source: sourceName,
    }),
  );
  return { positions, text };
}

function spanForRange(
  line: MappedLine,
  start: number,
  end: number,
): Cs486SourceSpan {
  return {
    end: line.positions[Math.min(end, line.positions.length - 1)]!,
    start: line.positions[Math.min(start, line.positions.length - 1)]!,
  };
}

function pointSpan(
  source: string,
  line: number,
  column: number,
  offset: number,
): Cs486SourceSpan {
  const position = { column, line, offset, source };
  return { end: position, start: position };
}

function withDiagnosticNotes(
  span: Cs486SourceSpan,
  notes: readonly Cs486DiagnosticNote[],
): Cs486SourceSpan {
  if (notes.length === 0) return span;
  return {
    ...span,
    diagnosticNotes: notes.slice(0, maximumDiagnosticNotes),
  };
}

function numberToken(
  value: number,
  span: Cs486SourceSpan,
): Cs486CPreprocessorToken {
  return {
    kind: "number",
    leadingSpace: false,
    raw: String(value),
    span,
    value: String(value),
  };
}

function parsePreprocessorInteger(value: string): number | undefined {
  const normalized = value.replace(/[uUlL]+$/u, "");
  if (!/^(?:0[xX][0-9A-Fa-f]+|0[0-7]*|[1-9][0-9]*|0)$/u.test(normalized))
    return undefined;
  const radix = /^0[xX]/u.test(normalized)
    ? 16
    : /^0[0-7]+$/u.test(normalized)
      ? 8
      : 10;
  const parsed = Number.parseInt(normalized, radix);
  return Number.isSafeInteger(parsed) ? parsed | 0 : undefined;
}

function characterConstant(raw: string): number {
  const body = raw.slice(1, -1);
  if (body.length === 1) return body.codePointAt(0)!;
  const escapes: Readonly<Record<string, number>> = {
    "\\0": 0,
    "\\a": 7,
    "\\b": 8,
    "\\f": 12,
    "\\n": 10,
    "\\r": 13,
    "\\t": 9,
    "\\v": 11,
    "\\\\": 92,
    "\\'": 39,
    '\\"': 34,
  };
  const value = escapes[body];
  if (value === undefined)
    throw new Error(`unsupported character constant ${raw}`);
  return value;
}

function assertMacroName(name: string, span: Cs486SourceSpan): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(name)) {
    throw preprocessorError(`invalid macro name ${name}`, span);
  }
}

function joinTokens(tokens: readonly Cs486CPreprocessorToken[]): string {
  let result = "";
  for (const token of tokens) {
    if (result.length > 0 && token.leadingSpace) result += " ";
    result += token.raw;
  }
  return result;
}

function preprocessorError(message: string, span: Cs486SourceSpan): Error {
  return compileErrorAt(message, span, {
    code: "CSC002",
    notes: span.diagnosticNotes,
  });
}

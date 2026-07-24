export type ChainOperator = "&&" | "||" | ";";
export type RedirectMode = "append" | "read" | "write";
export type ShellDescriptor = 0 | 1 | 2;
export type PipelineOperator = "pipe-stdout" | "pipe-stdout-and-stderr";

export interface ShellOpenRedirect {
  readonly descriptor: ShellDescriptor;
  readonly kind: "open";
  readonly mode: RedirectMode;
  readonly path: string;
}

export interface ShellDuplicateRedirect {
  readonly descriptor: 2;
  readonly kind: "duplicate";
  readonly target: 1;
}

/** Redirections remain in source order because descriptor duplication is ordered. */
export type ShellRedirect = ShellDuplicateRedirect | ShellOpenRedirect;

export interface ShellCommandNode {
  readonly redirects: readonly ShellRedirect[];
  readonly words: readonly string[];
}

export interface ShellPipelineNode {
  /** Linux-only trailing `&`; execution policy decides which forms are safe. */
  readonly background?: boolean;
  readonly commands: readonly ShellCommandNode[];
  /** One operator for each edge between adjacent commands. */
  readonly operators: readonly PipelineOperator[];
}

export interface ShellChainNode {
  readonly operator?: ChainOperator;
  readonly pipeline: ShellPipelineNode;
}

export interface ShellProgram {
  readonly chains: readonly ShellChainNode[];
}

export type ShellVariableResolver = (name: string) => string | undefined;

export interface ShellSyntaxFeatures {
  readonly backgroundJobs: boolean;
  readonly chainOperators: ReadonlySet<ChainOperator>;
  readonly comments: boolean;
  readonly descriptorRedirects: boolean;
  readonly pipeStderr: boolean;
  readonly singleQuotes: boolean;
  readonly variables: boolean;
}

export const busyBoxShellSyntaxFeatures: ShellSyntaxFeatures = {
  backgroundJobs: true,
  chainOperators: new Set(["&&", "||", ";"]),
  comments: true,
  descriptorRedirects: true,
  pipeStderr: true,
  singleQuotes: true,
  variables: true,
};

export const dosShellSyntaxFeatures: ShellSyntaxFeatures = {
  backgroundJobs: false,
  chainOperators: new Set(["&&", "||"]),
  comments: false,
  descriptorRedirects: false,
  pipeStderr: false,
  singleQuotes: false,
  variables: false,
};

const maximumSourceLength = 4_096;
const maximumTokens = 256;
const maximumPipelines = 32;
const maximumCommandsPerPipeline = 16;
const maximumRedirectsPerCommand = 16;

type Token =
  | { readonly kind: "operator"; readonly value: string }
  | { readonly kind: "word"; readonly value: string };

export class ShellSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellSyntaxError";
  }
}

export function parseShellProgram(
  source: string,
  resolveVariable: ShellVariableResolver = () => undefined,
  features: ShellSyntaxFeatures = busyBoxShellSyntaxFeatures,
): ShellProgram {
  const tokens = tokenize(source, resolveVariable, features);
  if (tokens.length === 0) return { chains: [] };
  const chains: ShellChainNode[] = [];
  let cursor = 0;
  let nextOperator: ChainOperator | undefined;

  while (cursor < tokens.length) {
    if (chains.length >= maximumPipelines) {
      throw new ShellSyntaxError("too many command groups");
    }
    const commands: ShellCommandNode[] = [];
    const operators: PipelineOperator[] = [];
    while (true) {
      if (commands.length >= maximumCommandsPerPipeline) {
        throw new ShellSyntaxError("pipeline is too long");
      }
      const parsed = parseCommand(tokens, cursor);
      commands.push(parsed.command);
      cursor = parsed.cursor;
      const token = tokens[cursor];
      if (
        token?.kind === "operator" &&
        (token.value === "|" || token.value === "|&")
      ) {
        operators.push(
          token.value === "|" ? "pipe-stdout" : "pipe-stdout-and-stderr",
        );
        cursor += 1;
        if (cursor >= tokens.length) {
          throw new ShellSyntaxError("expected command after '|'");
        }
        continue;
      }
      break;
    }

    let background = false;
    const pipelineTerminator = tokens[cursor];
    if (
      pipelineTerminator?.kind === "operator" &&
      pipelineTerminator.value === "&"
    ) {
      if (!features.backgroundJobs)
        throw new ShellSyntaxError("background jobs are not supported");
      background = true;
      cursor += 1;
      if (cursor < tokens.length) {
        throw new ShellSyntaxError(
          "background operator must terminate the command line",
        );
      }
    }

    chains.push({
      ...(nextOperator === undefined ? {} : { operator: nextOperator }),
      pipeline: {
        commands,
        operators,
        ...(background ? { background: true } : {}),
      },
    });
    if (background) break;
    const separator = tokens[cursor];
    if (separator === undefined) break;
    if (
      separator.kind !== "operator" ||
      !isChainOperator(separator.value) ||
      !features.chainOperators.has(separator.value)
    ) {
      throw new ShellSyntaxError(`unexpected token '${separator.value}'`);
    }
    nextOperator = separator.value;
    cursor += 1;
    if (cursor >= tokens.length) {
      throw new ShellSyntaxError(`expected command after '${separator.value}'`);
    }
  }

  return { chains };
}

function parseCommand(
  tokens: readonly Token[],
  start: number,
): { command: ShellCommandNode; cursor: number } {
  const words: string[] = [];
  const redirects: ShellRedirect[] = [];
  let cursor = start;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token === undefined) break;
    if (token.kind === "word") {
      words.push(token.value);
      cursor += 1;
      continue;
    }
    if (
      token.value === "<" ||
      token.value === ">" ||
      token.value === ">>" ||
      token.value === "2>" ||
      token.value === "2>>"
    ) {
      const target = tokens[cursor + 1];
      if (target?.kind !== "word") {
        throw new ShellSyntaxError(`expected path after '${token.value}'`);
      }
      if (redirects.length >= maximumRedirectsPerCommand) {
        throw new ShellSyntaxError("too many redirects");
      }
      const descriptor = token.value.startsWith("2")
        ? 2
        : token.value === "<"
          ? 0
          : 1;
      redirects.push({
        descriptor,
        kind: "open",
        mode:
          token.value === "<"
            ? "read"
            : token.value === ">>" || token.value === "2>>"
              ? "append"
              : "write",
        path: target.value,
      });
      cursor += 2;
      continue;
    }
    if (token.value === "2>&1") {
      if (redirects.length >= maximumRedirectsPerCommand) {
        throw new ShellSyntaxError("too many redirects");
      }
      redirects.push({ descriptor: 2, kind: "duplicate", target: 1 });
      cursor += 1;
      continue;
    }
    break;
  }
  if (words.length === 0) throw new ShellSyntaxError("expected command");
  return { command: { words, redirects }, cursor };
}

function tokenize(
  source: string,
  resolveVariable: ShellVariableResolver,
  features: ShellSyntaxFeatures,
): Token[] {
  if (source.length > maximumSourceLength) {
    throw new ShellSyntaxError("command line is too long");
  }
  const tokens: Token[] = [];
  let word = "";
  let wordStarted = false;
  let quote: "double" | "single" | undefined;
  let index = 0;

  const pushWord = (): void => {
    if (!wordStarted) return;
    tokens.push({ kind: "word", value: word });
    word = "";
    wordStarted = false;
  };
  const pushOperator = (value: string): void => {
    pushWord();
    tokens.push({ kind: "operator", value });
  };

  while (index < source.length) {
    const character = source[index] ?? "";
    if (quote === "single") {
      if (character === "'") quote = undefined;
      else word += character;
      wordStarted = true;
      index += 1;
      continue;
    }
    if (character === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined) throw new ShellSyntaxError("trailing escape");
      word +=
        quote === "double" && !['"', "$", "`", "\\", "\n"].includes(escaped)
          ? `\\${escaped}`
          : escaped;
      wordStarted = true;
      index += 2;
      continue;
    }
    if (character === '"') {
      quote = quote === "double" ? undefined : "double";
      wordStarted = true;
      index += 1;
      continue;
    }
    if (quote === undefined && character === "'") {
      if (!features.singleQuotes)
        throw new ShellSyntaxError("single quotes are not supported");
      quote = "single";
      wordStarted = true;
      index += 1;
      continue;
    }
    if (character === "$") {
      if (!features.variables)
        throw new ShellSyntaxError("dollar variables are not supported");
      const expansion = expandVariable(source, index, resolveVariable);
      word += expansion.value;
      wordStarted = true;
      index = expansion.index;
      continue;
    }
    if (quote === undefined && /\s/u.test(character)) {
      pushWord();
      index += 1;
      continue;
    }
    if (
      features.comments &&
      quote === undefined &&
      character === "#" &&
      !wordStarted
    )
      break;
    if (quote === undefined) {
      const descriptorRedirect =
        !wordStarted && source.startsWith("2>&1", index)
          ? "2>&1"
          : !wordStarted && source.startsWith("2>>", index)
            ? "2>>"
            : !wordStarted && source.startsWith("2>", index)
              ? "2>"
              : undefined;
      if (descriptorRedirect !== undefined) {
        if (!features.descriptorRedirects) {
          throw new ShellSyntaxError(
            `operator '${descriptorRedirect}' is not supported`,
          );
        }
        pushOperator(descriptorRedirect);
        index += descriptorRedirect.length;
        continue;
      }
      const pair = source.slice(index, index + 2);
      if (pair === "&&" || pair === "||") {
        if (!features.chainOperators.has(pair))
          throw new ShellSyntaxError(`operator '${pair}' is not supported`);
        pushOperator(pair);
        index += 2;
        continue;
      }
      if (pair === ">>") {
        pushOperator(pair);
        index += 2;
        continue;
      }
      if (pair === "|&") {
        if (!features.pipeStderr)
          throw new ShellSyntaxError("operator '|&' is not supported");
        pushOperator(pair);
        index += 2;
        continue;
      }
      if (character === ";") {
        if (!features.chainOperators.has(";"))
          throw new ShellSyntaxError("operator ';' is not supported");
        pushOperator(character);
        index += 1;
        continue;
      }
      if (character === "|" || character === ">" || character === "<") {
        pushOperator(character);
        index += 1;
        continue;
      }
      if (character === "&") {
        if (!features.backgroundJobs)
          throw new ShellSyntaxError("background jobs are not supported");
        pushOperator(character);
        index += 1;
        continue;
      }
    }
    word += character;
    wordStarted = true;
    index += 1;
  }
  if (quote !== undefined) throw new ShellSyntaxError("unterminated quote");
  pushWord();
  if (tokens.length > maximumTokens)
    throw new ShellSyntaxError("too many tokens");
  return tokens;
}

function expandVariable(
  source: string,
  start: number,
  resolveVariable: ShellVariableResolver,
): { readonly index: number; readonly value: string } {
  const next = source[start + 1];
  if (next !== undefined && /[?#@*0-9]/u.test(next)) {
    return { index: start + 2, value: resolveVariable(next) ?? "" };
  }
  if (next === "{") {
    const end = source.indexOf("}", start + 2);
    if (end < 0) throw new ShellSyntaxError("unterminated variable expansion");
    const name = source.slice(start + 2, end);
    if (!isVariableName(name))
      throw new ShellSyntaxError("invalid variable name");
    return { index: end + 1, value: resolveVariable(name) ?? "" };
  }
  const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(start + 1));
  if (match === null) return { index: start + 1, value: "$" };
  const name = match[0];
  return {
    index: start + 1 + name.length,
    value: resolveVariable(name) ?? "",
  };
}

function isVariableName(value: string): boolean {
  return /^(?:[A-Za-z_][A-Za-z0-9_]*|[?#@*]|[0-9]+)$/u.test(value);
}

function isChainOperator(value: string): value is ChainOperator {
  return value === "&&" || value === "||" || value === ";";
}

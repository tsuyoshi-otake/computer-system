export type ChainOperator = "&&" | "||" | ";";
export type RedirectMode = "append" | "read" | "write";

export interface ShellRedirect {
  readonly mode: RedirectMode;
  readonly path: string;
}

export interface ShellCommandNode {
  readonly redirects: readonly ShellRedirect[];
  readonly words: readonly string[];
}

export interface ShellPipelineNode {
  readonly commands: readonly ShellCommandNode[];
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
  readonly chainOperators: ReadonlySet<ChainOperator>;
  readonly comments: boolean;
  readonly singleQuotes: boolean;
  readonly variables: boolean;
}

export const busyBoxShellSyntaxFeatures: ShellSyntaxFeatures = {
  chainOperators: new Set(["&&", "||", ";"]),
  comments: true,
  singleQuotes: true,
  variables: true,
};

export const dosShellSyntaxFeatures: ShellSyntaxFeatures = {
  chainOperators: new Set(["&&", "||"]),
  comments: false,
  singleQuotes: false,
  variables: false,
};

const maximumSourceLength = 4_096;
const maximumTokens = 256;
const maximumPipelines = 32;
const maximumCommandsPerPipeline = 16;

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
    while (true) {
      if (commands.length >= maximumCommandsPerPipeline) {
        throw new ShellSyntaxError("pipeline is too long");
      }
      const parsed = parseCommand(tokens, cursor);
      commands.push(parsed.command);
      cursor = parsed.cursor;
      const token = tokens[cursor];
      if (token?.kind === "operator" && token.value === "|") {
        cursor += 1;
        if (cursor >= tokens.length) {
          throw new ShellSyntaxError("expected command after '|'");
        }
        continue;
      }
      break;
    }

    chains.push({
      ...(nextOperator === undefined ? {} : { operator: nextOperator }),
      pipeline: { commands },
    });
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
    if (token.value === "<" || token.value === ">" || token.value === ">>") {
      const target = tokens[cursor + 1];
      if (target?.kind !== "word") {
        throw new ShellSyntaxError(`expected path after '${token.value}'`);
      }
      redirects.push({
        mode:
          token.value === "<"
            ? "read"
            : token.value === ">>"
              ? "append"
              : "write",
        path: target.value,
      });
      cursor += 2;
      continue;
    }
    break;
  }
  if (words.length === 0) throw new ShellSyntaxError("expected command");
  const inputCount = redirects.filter(({ mode }) => mode === "read").length;
  const outputCount = redirects.length - inputCount;
  if (inputCount > 1) throw new ShellSyntaxError("ambiguous input redirect");
  if (outputCount > 1) throw new ShellSyntaxError("ambiguous output redirect");
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
        throw new ShellSyntaxError("background jobs are not supported");
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

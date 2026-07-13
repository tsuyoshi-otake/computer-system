import {
  cs486RegisterNames,
  type Cs486Executable,
  type Cs486Instruction,
  type Cs486Operand,
  type Cs486Register,
} from "../../domain/cpu/cs486.js";

export class Cs486CompileError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = "CompileError";
  }
}

export function assembleCs486(source: string): Cs486Executable {
  const labels = new Map<string, number>();
  const statements: { line: number; text: string }[] = [];
  for (const [offset, raw] of source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .entries()) {
    let text = raw.replace(/;.*$/u, "").trim();
    if (text.length === 0 || /^section\b/iu.test(text)) continue;
    const label = /^([A-Za-z_][A-Za-z0-9_]*):/u.exec(text);
    if (label !== null) {
      if (labels.has(label[1]!))
        throw new Cs486CompileError(`duplicate label ${label[1]}`, offset + 1);
      labels.set(label[1]!, statements.length);
      text = text.slice(label[0].length).trim();
      if (text.length === 0) continue;
    }
    if (statements.length >= 4_096)
      throw new Cs486CompileError("instruction limit exceeded", offset + 1);
    statements.push({ line: offset + 1, text });
  }

  return {
    format: "cs486-executable",
    version: 1,
    instructions: statements.map(({ line, text }) =>
      parseInstruction(text, line, labels),
    ),
  };
}

function parseInstruction(
  text: string,
  line: number,
  labels: ReadonlyMap<string, number>,
): Cs486Instruction {
  const match = /^(\w+)\s*(.*)$/u.exec(text);
  if (match === null) throw new Cs486CompileError("invalid instruction", line);
  const op = match[1]!.toLowerCase();
  const arguments_ = splitArguments(match[2]!);
  const arity = (count: number): void => {
    if (arguments_.length !== count)
      throw new Cs486CompileError(`${op} expects ${count} operand(s)`, line);
  };
  if (op === "halt" || op === "ret") {
    arity(0);
    return { op };
  }
  if (["jmp", "je", "jne", "jl", "jle", "jg", "jge", "call"].includes(op)) {
    arity(1);
    const target = labels.get(arguments_[0]!);
    if (target === undefined)
      throw new Cs486CompileError(`unknown label ${arguments_[0]}`, line);
    return { op: op as "jmp", target };
  }
  if (op === "push") {
    arity(1);
    return { op, source: operand(arguments_[0]!, line) };
  }
  if (op === "pop") {
    arity(1);
    return { op, destination: register(arguments_[0]!, line) };
  }
  if (op === "print") {
    arity(1);
    const raw = arguments_[0]!;
    return {
      op,
      source: /^".*"$/u.test(raw)
        ? decodeString(raw, line)
        : operand(raw, line),
    };
  }
  if (op === "load") {
    arity(2);
    return {
      op,
      destination: register(arguments_[0]!, line),
      address: memoryOperand(arguments_[1]!, line),
    };
  }
  if (op === "store") {
    arity(2);
    return {
      op,
      address: memoryOperand(arguments_[0]!, line),
      source: register(arguments_[1]!, line),
    };
  }
  if (op === "cmp") {
    arity(2);
    return {
      op,
      left: register(arguments_[0]!, line),
      right: operand(arguments_[1]!, line),
    };
  }
  if (
    [
      "mov",
      "add",
      "sub",
      "mul",
      "div",
      "mod",
      "and",
      "or",
      "xor",
      "shl",
      "shr",
    ].includes(op)
  ) {
    arity(2);
    return {
      op: op as "mov",
      destination: register(arguments_[0]!, line),
      source: operand(arguments_[1]!, line),
    };
  }
  throw new Cs486CompileError(`unknown instruction ${op}`, line);
}

function splitArguments(value: string): string[] {
  const result: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"' && value[index - 1] !== "\\") quoted = !quoted;
    if (value[index] === "," && !quoted) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const final = value.slice(start).trim();
  if (final.length > 0) result.push(final);
  return result;
}

function register(value: string, line: number): Cs486Register {
  const normalized = value.toLowerCase() as Cs486Register;
  if (!cs486RegisterNames.includes(normalized))
    throw new Cs486CompileError(`unknown register ${value}`, line);
  return normalized;
}

function operand(value: string, line: number): Cs486Operand {
  const normalized = value.toLowerCase() as Cs486Register;
  if (cs486RegisterNames.includes(normalized))
    return { kind: "register", register: normalized };
  const number = parseInteger(value);
  if (number === undefined)
    throw new Cs486CompileError(`invalid operand ${value}`, line);
  return { kind: "immediate", value: number };
}

function memoryOperand(value: string, line: number): Cs486Operand {
  const match = /^\[(.+)\]$/u.exec(value.trim());
  if (match === null)
    throw new Cs486CompileError("memory operand must use [address]", line);
  return operand(match[1]!.trim(), line);
}

function parseInteger(value: string): number | undefined {
  if (!/^-?(?:0x[0-9a-f]+|\d+)$/iu.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed >= -2_147_483_648 &&
    parsed <= 0xffffffff
    ? parsed | 0
    : undefined;
}

function decodeString(value: string, line: number): string {
  try {
    return JSON.parse(value) as string;
  } catch {
    throw new Cs486CompileError("invalid string literal", line);
  }
}

import { computerNominalClockHz } from "./timing.js";

export const cs486NominalClockHz = computerNominalClockHz;

export const cs486RegisterNames = [
  "eax",
  "ebx",
  "ecx",
  "edx",
  "esi",
  "edi",
  "esp",
  "ebp",
] as const;

export type Cs486Register = (typeof cs486RegisterNames)[number];
export type Cs486Operand =
  | { readonly kind: "immediate"; readonly value: number }
  | { readonly kind: "register"; readonly register: Cs486Register };

export type Cs486Instruction =
  | {
      readonly op: "mov";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "load";
      readonly destination: Cs486Register;
      readonly address: Cs486Operand;
    }
  | {
      readonly op: "store";
      readonly address: Cs486Operand;
      readonly source: Cs486Register;
    }
  | {
      readonly op: "add" | "sub" | "mul" | "div" | "mod" | "and" | "or" | "xor";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "shl" | "shr";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "cmp";
      readonly left: Cs486Register;
      readonly right: Cs486Operand;
    }
  | {
      readonly op: "jmp" | "je" | "jne" | "jl" | "jle" | "jg" | "jge";
      readonly target: number;
    }
  | { readonly op: "push"; readonly source: Cs486Operand }
  | { readonly op: "pop"; readonly destination: Cs486Register }
  | { readonly op: "call"; readonly target: number }
  | { readonly op: "ret" | "halt" }
  | { readonly op: "print"; readonly source: Cs486Operand | string };

export interface Cs486Executable {
  readonly dataBytes?: number;
  readonly format: "cs486-executable";
  readonly version: 1;
  readonly instructions: readonly Cs486Instruction[];
  readonly symbols?: readonly {
    readonly address: number;
    readonly name: string;
  }[];
}

export interface Cs486RunResult {
  readonly cycles: number;
  readonly executedInstructions: number;
  readonly output: string;
  readonly registers: Readonly<Record<Cs486Register, number>>;
  readonly state: "halted" | "yielded";
}

export class Cs486Fault extends Error {
  constructor(
    readonly typeName: string,
    message: string,
  ) {
    super(message);
    this.name = typeName;
  }
}

const maximumProgramInstructions = 4_096;
const maximumOutputBytes = 64_000;

export function runCs486(
  executable: Cs486Executable,
  options: { readonly memoryBytes: number; readonly instructionLimit?: number },
): Cs486RunResult {
  validateCs486Executable(executable);
  const instructionLimit = options.instructionLimit ?? 100_000;
  if (!Number.isSafeInteger(instructionLimit) || instructionLimit <= 0)
    throw new RangeError("CS486 instruction limit must be positive");
  const memoryBytes = Math.min(options.memoryBytes, 16 * 1_024 * 1_024);
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes < 64 * 1_024)
    throw new RangeError("CS486 requires at least 64 KiB RAM");
  if ((executable.dataBytes ?? 0) > memoryBytes)
    throw new Cs486Fault(
      "MemoryAccessError",
      "executable data exceeds available RAM",
    );

  const memory = new DataView(new ArrayBuffer(memoryBytes));
  const registers = new Int32Array(cs486RegisterNames.length);
  registers[indexOf("esp")] = memoryBytes;
  registers[indexOf("ebp")] = memoryBytes;
  let ip = 0;
  let compared = 0;
  let cycles = 0;
  let executedInstructions = 0;
  let output = "";

  const read = (operand: Cs486Operand): number =>
    operand.kind === "immediate"
      ? operand.value | 0
      : registers[indexOf(operand.register)]!;
  const write = (register: Cs486Register, value: number): void => {
    registers[indexOf(register)] = value | 0;
  };
  const address = (operand: Cs486Operand): number => {
    const value = read(operand);
    if (!Number.isInteger(value) || value < 0 || value + 4 > memoryBytes)
      throw new Cs486Fault(
        "MemoryAccessError",
        `address ${value} is outside RAM`,
      );
    return value;
  };
  const push = (value: number): void => {
    const next = registers[indexOf("esp")]! - 4;
    if (next < 0) throw new Cs486Fault("StackOverflowError", "stack overflow");
    memory.setInt32(next, value, true);
    registers[indexOf("esp")] = next;
  };
  const pop = (): number => {
    const current = registers[indexOf("esp")]!;
    if (current < 0 || current + 4 > memoryBytes)
      throw new Cs486Fault("StackUnderflowError", "stack underflow");
    const value = memory.getInt32(current, true);
    registers[indexOf("esp")] = current + 4;
    return value;
  };

  while (ip < executable.instructions.length) {
    if (executedInstructions >= instructionLimit) return result("yielded");
    const instruction = executable.instructions[ip++]!;
    executedInstructions += 1;
    cycles += cycleCost(instruction);
    switch (instruction.op) {
      case "mov":
        write(instruction.destination, read(instruction.source));
        break;
      case "load":
        write(
          instruction.destination,
          memory.getInt32(address(instruction.address), true),
        );
        break;
      case "store":
        memory.setInt32(
          address(instruction.address),
          registers[indexOf(instruction.source)]!,
          true,
        );
        break;
      case "add":
        write(
          instruction.destination,
          readRegister(instruction.destination) + read(instruction.source),
        );
        break;
      case "sub":
        write(
          instruction.destination,
          readRegister(instruction.destination) - read(instruction.source),
        );
        break;
      case "mul":
        write(
          instruction.destination,
          Math.imul(
            readRegister(instruction.destination),
            read(instruction.source),
          ),
        );
        break;
      case "div": {
        const divisor = read(instruction.source);
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        write(
          instruction.destination,
          Math.trunc(readRegister(instruction.destination) / divisor),
        );
        break;
      }
      case "mod": {
        const divisor = read(instruction.source);
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        write(
          instruction.destination,
          readRegister(instruction.destination) % divisor,
        );
        break;
      }
      case "and":
        write(
          instruction.destination,
          readRegister(instruction.destination) & read(instruction.source),
        );
        break;
      case "or":
        write(
          instruction.destination,
          readRegister(instruction.destination) | read(instruction.source),
        );
        break;
      case "xor":
        write(
          instruction.destination,
          readRegister(instruction.destination) ^ read(instruction.source),
        );
        break;
      case "shl":
        write(
          instruction.destination,
          readRegister(instruction.destination) <<
            (read(instruction.source) & 31),
        );
        break;
      case "shr":
        write(
          instruction.destination,
          readRegister(instruction.destination) >>
            (read(instruction.source) & 31),
        );
        break;
      case "cmp":
        compared = readRegister(instruction.left) - read(instruction.right);
        break;
      case "jmp":
        ip = instruction.target;
        break;
      case "je":
        if (compared === 0) ip = instruction.target;
        break;
      case "jne":
        if (compared !== 0) ip = instruction.target;
        break;
      case "jl":
        if (compared < 0) ip = instruction.target;
        break;
      case "jle":
        if (compared <= 0) ip = instruction.target;
        break;
      case "jg":
        if (compared > 0) ip = instruction.target;
        break;
      case "jge":
        if (compared >= 0) ip = instruction.target;
        break;
      case "push":
        push(read(instruction.source));
        break;
      case "pop":
        write(instruction.destination, pop());
        break;
      case "call":
        push(ip);
        ip = instruction.target;
        break;
      case "ret":
        ip = pop();
        break;
      case "print": {
        const value =
          typeof instruction.source === "string"
            ? instruction.source
            : String(read(instruction.source));
        output += value;
        if (output.length > maximumOutputBytes)
          throw new Cs486Fault("OutputLimitError", "output limit exceeded");
        break;
      }
      case "halt":
        return result("halted");
    }
  }
  return result("halted");

  function readRegister(register: Cs486Register): number {
    return registers[indexOf(register)]!;
  }
  function result(state: "halted" | "yielded"): Cs486RunResult {
    return {
      cycles,
      executedInstructions,
      output,
      registers: Object.fromEntries(
        cs486RegisterNames.map((name, index) => [name, registers[index]!]),
      ) as Record<Cs486Register, number>,
      state,
    };
  }
}

export function validateCs486Executable(
  value: unknown,
): asserts value is Cs486Executable {
  if (typeof value !== "object" || value === null)
    throw new Cs486Fault("ExecutableFormatError", "invalid executable");
  const candidate = value as Partial<Cs486Executable>;
  if (
    candidate.format !== "cs486-executable" ||
    candidate.version !== 1 ||
    !Array.isArray(candidate.instructions)
  )
    throw new Cs486Fault(
      "ExecutableFormatError",
      "unsupported executable format",
    );
  if (candidate.instructions.length > maximumProgramInstructions)
    throw new Cs486Fault(
      "ExecutableFormatError",
      "program instruction limit exceeded",
    );
  if (
    candidate.dataBytes !== undefined &&
    (!Number.isSafeInteger(candidate.dataBytes) ||
      candidate.dataBytes < 0 ||
      candidate.dataBytes > 16 * 1_048_576)
  )
    throw new Cs486Fault("ExecutableFormatError", "invalid data size");
  if (
    candidate.symbols !== undefined &&
    (!Array.isArray(candidate.symbols) ||
      candidate.symbols.length > 2_048 ||
      (candidate.symbols as readonly unknown[]).some((value) => {
        if (typeof value !== "object" || value === null) return true;
        const symbol = value as {
          readonly address?: unknown;
          readonly name?: unknown;
        };
        return (
          typeof symbol.name !== "string" ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(symbol.name) ||
          !Number.isSafeInteger(symbol.address) ||
          (symbol.address as number) < 0 ||
          (symbol.address as number) >= candidate.instructions!.length
        );
      }))
  )
    throw new Cs486Fault("ExecutableFormatError", "invalid symbol table");
  for (const instruction of candidate.instructions) {
    if (typeof instruction !== "object" || instruction === null)
      throw new Cs486Fault("ExecutableFormatError", "invalid instruction");
    const candidateInstruction = instruction as Record<string, unknown>;
    const op = candidateInstruction.op;
    const register = (name: string): boolean =>
      isCs486Register(candidateInstruction[name]);
    const operand = (name: string): boolean =>
      isCs486Operand(candidateInstruction[name]);
    let valid = false;
    if (op === "halt" || op === "ret") valid = true;
    else if (
      op === "jmp" ||
      op === "je" ||
      op === "jne" ||
      op === "jl" ||
      op === "jle" ||
      op === "jg" ||
      op === "jge" ||
      op === "call"
    ) {
      valid =
        Number.isSafeInteger(candidateInstruction.target) &&
        (candidateInstruction.target as number) >= 0 &&
        (candidateInstruction.target as number) < candidate.instructions.length;
    } else if (op === "push") valid = operand("source");
    else if (op === "pop") valid = register("destination");
    else if (op === "print")
      valid =
        typeof candidateInstruction.source === "string" || operand("source");
    else if (op === "load")
      valid = register("destination") && operand("address");
    else if (op === "store") valid = operand("address") && register("source");
    else if (op === "cmp") valid = register("left") && operand("right");
    else if (
      op === "mov" ||
      op === "add" ||
      op === "sub" ||
      op === "mul" ||
      op === "div" ||
      op === "mod" ||
      op === "and" ||
      op === "or" ||
      op === "xor" ||
      op === "shl" ||
      op === "shr"
    ) {
      valid = register("destination") && operand("source");
    }
    if (!valid)
      throw new Cs486Fault(
        "ExecutableFormatError",
        `invalid ${String(op)} instruction`,
      );
  }
}

function isCs486Register(value: unknown): value is Cs486Register {
  return (
    typeof value === "string" &&
    cs486RegisterNames.includes(value as Cs486Register)
  );
}

function isCs486Operand(value: unknown): value is Cs486Operand {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Cs486Operand>;
  return candidate.kind === "register"
    ? isCs486Register(candidate.register)
    : candidate.kind === "immediate" &&
        Number.isSafeInteger(candidate.value) &&
        (candidate.value ?? 0) >= -2_147_483_648 &&
        (candidate.value ?? 0) <= 2_147_483_647;
}

function indexOf(register: Cs486Register): number {
  return cs486RegisterNames.indexOf(register);
}

function cycleCost(instruction: Cs486Instruction): number {
  switch (instruction.op) {
    case "load":
    case "store":
    case "push":
    case "pop":
      return 2;
    case "mul":
      return 9;
    case "div":
    case "mod":
      return 40;
    case "call":
    case "ret":
      return 3;
    case "print":
      return (
        8 +
        (typeof instruction.source === "string"
          ? Math.ceil(instruction.source.length / 4)
          : 1)
      );
    default:
      return 1;
  }
}

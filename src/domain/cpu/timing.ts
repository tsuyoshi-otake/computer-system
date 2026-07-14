import type { Instruction } from "../runtime/bytecode.js";

export const computerNominalClockHz = 33_000_000;

export function cpuCyclesPerTick(
  clockHz: number,
  ticksPerSecond: number,
): number {
  if (!Number.isSafeInteger(clockHz) || clockHz < 1)
    throw new RangeError("CPU clock must be a positive integer");
  if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond < 1)
    throw new RangeError("Tick rate must be a positive integer");
  return Math.max(1, Math.floor(clockHz / ticksPerSecond));
}

export function cpuCyclesToMicroseconds(
  cpuCycles: number,
  clockHz = computerNominalClockHz,
): number {
  if (!Number.isSafeInteger(cpuCycles) || cpuCycles < 0)
    throw new RangeError("CPU cycles must be a non-negative safe integer");
  if (!Number.isSafeInteger(clockHz) || clockHz < 1)
    throw new RangeError("CPU clock must be a positive integer");
  return (cpuCycles * 1_000_000) / clockHz;
}

/**
 * Deterministic 486DX-equivalent cost for one Computer System Python bytecode.
 * These are simulation costs, not host-JavaScript timings. Collection size and
 * call arity remain linear so larger inputs consume proportionally more CPU.
 */
export function pythonBytecodeCpuCycles(instruction: Instruction): number {
  switch (instruction.op) {
    case "BREAKPOINT":
    case "END_BLOCK":
    case "JUMP":
    case "LOOP_CONTROL":
    case "POP_TOP":
      return 96;
    case "LOAD_CONST":
    case "LOAD_NAME":
    case "STORE_NAME":
      return 144;
    case "GET_ITER":
    case "JUMP_IF_FALSE":
    case "JUMP_IF_FALSE_OR_POP":
    case "JUMP_IF_TRUE_OR_POP":
    case "RETURN":
    case "UNARY":
      return 192;
    case "BINARY":
    case "FOR_ITER":
    case "LOAD_ATTRIBUTE":
    case "LOAD_SUBSCRIPT":
    case "STORE_ATTRIBUTE":
    case "STORE_SUBSCRIPT":
      return 288;
    case "BUILD_DICT":
      return 240 + instruction.count * 192;
    case "BUILD_LIST":
    case "BUILD_TUPLE":
    case "FORMAT":
      return 240 + instruction.count * 96;
    case "CALL":
      return 720 + instruction.argumentNames.length * 192;
    case "COMPARE_CHAIN":
      return 240 + instruction.operators.length * 192;
    case "IMPORT":
      return 1_200;
    case "MAKE_FUNCTION":
      return 960 + instruction.defaultCount * 192;
    case "RAISE":
      return 720;
    case "TRY":
      return 480 + instruction.handlers.length * 192;
  }
}

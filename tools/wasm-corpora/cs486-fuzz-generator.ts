import type { CsAbiBatchHeapLayout } from "../../src/application/runtime/csAbi.js";
import type {
  Cs486Executable,
  Cs486Instruction,
  Cs486ProcessImageInitialization,
} from "../../src/domain/cpu/cs486.js";
import { createCs486Flat32MemoryMetadata } from "../../src/domain/cpu/cs486.js";
import { cs486Word32DataModel } from "../../src/domain/cpu/cs486Compatibility.js";
import type { Cs486Register } from "../../src/domain/cpu/instructionSet.js";

/**
 * Deterministic CS486 program fuzzer for the Issue #106 wasm batch-executor
 * differential-equivalence harness. Every program is derived from a seed
 * through a local mulberry32 PRNG (no dependencies, no wall clock), so a
 * reported divergence reproduces from its seed alone.
 *
 * Random programs are built to run long under an instruction budget: memory
 * operands are masked into RAM bounds, register divisors are forced odd, and
 * pushes/pops stay balanced. Fault paths are exercised by the deterministic
 * forced cases instead, so a random program never ends in a surprise fault
 * that would truncate coverage of its later blocks.
 */
export interface Cs486FuzzProgram {
  /**
   * Heap placement of an admitted `run --batch` process. Present exactly when
   * the program is allowed to reach the isolated CS ABI subset; absent programs
   * keep the harness policy that rejects every syscall.
   */
  readonly csAbi?: CsAbiBatchHeapLayout;
  readonly executable: Cs486Executable;
  readonly memoryBytes: number;
  readonly name: string;
  /** Startup image installed before the first instruction, when present. */
  readonly processImage?: Cs486ProcessImageInitialization;
  /** Per-slice instruction budget the equivalence runner should use. */
  readonly recommendedSliceInstructions: number;
}

export const cs486FuzzMemoryBytes = 65_536;
const int32Minimum = -2_147_483_648;

/** Local seeded PRNG (mulberry32); deterministic across hosts. */
export function cs486FuzzRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const generalRegisters: readonly Cs486Register[] = [
  "eax",
  "ebx",
  "ecx",
  "edx",
  "esi",
  "edi",
];

type Rng = () => number;

function pick<T>(rng: Rng, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

function intBetween(rng: Rng, minimum: number, maximum: number): number {
  return minimum + Math.floor(rng() * (maximum - minimum + 1));
}

function randomInt32(rng: Rng): number {
  return (Math.floor(rng() * 4_294_967_296) | 0) === 0
    ? 1
    : Math.floor(rng() * 4_294_967_296) | 0;
}

const immediate = (value: number) => ({ kind: "immediate", value }) as const;
const register = (name: Cs486Register) =>
  ({ kind: "register", register: name }) as const;

const binaryOps = [
  "add",
  "and",
  "div",
  "mod",
  "mul",
  "or",
  "shl",
  "shr",
  "sub",
  "udiv",
  "umod",
  "ushr",
  "xor",
] as const;

function aluInstruction(rng: Rng): readonly Cs486Instruction[] {
  const op = pick(rng, binaryOps);
  const destination = pick(rng, generalRegisters);
  const divides =
    op === "div" || op === "udiv" || op === "mod" || op === "umod";
  if (rng() < 0.5) {
    const shift = op === "shl" || op === "shr" || op === "ushr";
    const value = shift
      ? intBetween(rng, 0, 63)
      : divides
        ? pick(rng, [-1023, -7, -3, -1, 1, 3, 5, 7, 1023])
        : randomInt32(rng);
    return [{ destination, op, source: immediate(value) }];
  }
  const source = pick(rng, generalRegisters);
  if (!divides) return [{ destination, op, source: register(source) }];
  // A zero register divisor would fault and truncate the run; forcing the
  // low bit keeps the divisor nonzero while still reaching -1 and INT_MIN|1.
  return [
    { destination: source, op: "or", source: immediate(1) },
    { destination, op, source: register(source) },
  ];
}

function maskedAddressRegister(
  rng: Rng,
  addressRegister: Cs486Register,
  align2: boolean,
): readonly Cs486Instruction[] {
  return [
    {
      destination: addressRegister,
      op: "and",
      source: immediate(align2 ? 0x3f_fe : 0x3f_ff),
    },
    { destination: addressRegister, op: "add", source: immediate(4_096) },
  ];
}

function memoryInstructions(rng: Rng): readonly Cs486Instruction[] {
  const width = pick(rng, ["8", "16", "32"] as const);
  const value = pick(rng, generalRegisters);
  if (rng() < 0.5) {
    // Immediate addressing; odd addresses are legal for 8/32-bit accesses
    // and exercise the CS386SX two-versus-three transfer split, while
    // 16-bit accesses stay even because odd 16-bit addresses fault.
    const address =
      width === "16"
        ? intBetween(rng, 0, 16_382) * 2
        : intBetween(rng, 0, 32_767);
    const loadOp =
      width === "8"
        ? pick(rng, ["load8s", "load8u"] as const)
        : width === "16"
          ? pick(rng, ["load16s", "load16u"] as const)
          : ("load" as const);
    const storeOp =
      width === "8"
        ? ("store8" as const)
        : width === "16"
          ? ("store16" as const)
          : ("store" as const);
    return rng() < 0.5
      ? [{ address: immediate(address), destination: value, op: loadOp }]
      : [{ address: immediate(address), op: storeOp, source: value }];
  }
  const addressRegister = pick(rng, generalRegisters);
  const mask = maskedAddressRegister(rng, addressRegister, width === "16");
  const loadOp =
    width === "8"
      ? pick(rng, ["load8s", "load8u"] as const)
      : width === "16"
        ? pick(rng, ["load16s", "load16u"] as const)
        : ("load" as const);
  const storeOp =
    width === "8"
      ? ("store8" as const)
      : width === "16"
        ? ("store16" as const)
        : ("store" as const);
  return rng() < 0.5
    ? [
        ...mask,
        { address: register(addressRegister), destination: value, op: loadOp },
      ]
    : [
        ...mask,
        { address: register(addressRegister), op: storeOp, source: value },
      ];
}

function stackInstructions(rng: Rng): readonly Cs486Instruction[] {
  const first = pick(rng, generalRegisters);
  const second = pick(rng, generalRegisters);
  const middle = aluInstruction(rng);
  return [
    rng() < 0.3
      ? { op: "push", source: immediate(randomInt32(rng)) }
      : { op: "push", source: register(first) },
    { op: "push", source: register(second) },
    ...middle,
    { destination: pick(rng, generalRegisters), op: "pop" },
    { destination: pick(rng, generalRegisters), op: "pop" },
  ];
}

interface BranchBlock {
  readonly instructions: readonly Cs486Instruction[];
  /** Offsets (relative to block start) whose target must become block end. */
  readonly forwardPatches: readonly number[];
}

function branchBlock(rng: Rng): BranchBlock {
  const left = pick(rng, generalRegisters);
  const condition = pick(rng, ["je", "jg", "jge", "jl", "jle", "jne"] as const);
  const skipped: Cs486Instruction[] = [];
  const skippedCount = intBetween(rng, 1, 3);
  for (let index = 0; index < skippedCount; index += 1)
    skipped.push(...aluInstruction(rng));
  const instructions: Cs486Instruction[] = [
    rng() < 0.5
      ? {
          left,
          op: "cmp",
          right: immediate(pick(rng, [int32Minimum, -1, 0, 1, 7])),
        }
      : { left, op: "cmp", right: register(pick(rng, generalRegisters)) },
    { op: condition, target: 0 },
    ...skipped,
  ];
  return { forwardPatches: [1], instructions };
}

/** Bounded six-line strided walk hitting one L1 set on CS486DX/DX2. */
function cacheWalkBlock(rng: Rng): readonly Cs486Instruction[] {
  const address = pick(rng, generalRegisters);
  let counter = pick(rng, generalRegisters);
  while (counter === address) counter = pick(rng, generalRegisters);
  let value = pick(rng, generalRegisters);
  while (value === address || value === counter)
    value = pick(rng, generalRegisters);
  const start: Cs486Instruction[] = [
    { destination: address, op: "mov", source: immediate(8_192) },
    { destination: counter, op: "mov", source: immediate(6) },
  ];
  const loop: Cs486Instruction[] = [
    { address: register(address), destination: value, op: "load" },
    { destination: value, op: "add", source: immediate(1) },
    { address: register(address), op: "store", source: value },
    { destination: address, op: "add", source: immediate(2_048) },
    { destination: counter, op: "sub", source: immediate(1) },
    { left: counter, op: "cmp", right: immediate(0) },
    { op: "jg", target: 0 },
  ];
  return [...start, ...loop];
}

/**
 * Generates one seed-deterministic random program: an initialization block,
 * an infinite main loop of mixed blocks (the instruction budget bounds the
 * run), and one to three called subroutines with balanced frames.
 */
export function generateCs486FuzzProgram(seed: number): Cs486FuzzProgram {
  const rng = cs486FuzzRandom(seed);
  const instructions: Cs486Instruction[] = [];
  const branchPatches: { readonly at: number; readonly target: number }[] = [];
  const callPatches: { readonly at: number; readonly subroutine: number }[] =
    [];

  for (const destination of generalRegisters)
    instructions.push({
      destination,
      op: "mov",
      source: immediate(randomInt32(rng)),
    });
  const mainLoopStart = instructions.length;
  const subroutineCount = intBetween(rng, 1, 3);
  const blockCount = intBetween(rng, 4, 8);
  for (let block = 0; block < blockCount; block += 1) {
    const choice = rng();
    if (choice < 0.28) {
      const runLength = intBetween(rng, 4, 10);
      for (let index = 0; index < runLength; index += 1)
        instructions.push(...aluInstruction(rng));
    } else if (choice < 0.5) {
      const runLength = intBetween(rng, 3, 6);
      for (let index = 0; index < runLength; index += 1)
        instructions.push(...memoryInstructions(rng));
    } else if (choice < 0.65) {
      instructions.push(...stackInstructions(rng));
    } else if (choice < 0.8) {
      const block_ = branchBlock(rng);
      const base = instructions.length;
      instructions.push(...block_.instructions);
      for (const offset of block_.forwardPatches)
        branchPatches.push({ at: base + offset, target: instructions.length });
    } else if (choice < 0.9) {
      callPatches.push({
        at: instructions.length,
        subroutine: intBetween(rng, 0, subroutineCount - 1),
      });
      instructions.push({ op: "call", target: 0 });
    } else if (choice < 0.95) {
      const base = instructions.length;
      const walk = cacheWalkBlock(rng);
      instructions.push(...walk);
      // The trailing jg loops back to the walk's load instruction.
      branchPatches.push({ at: instructions.length - 1, target: base + 2 });
    } else {
      instructions.push({
        op: "print",
        source: immediate(intBetween(rng, 0, 255)),
      });
    }
  }
  instructions.push({ op: "jmp", target: mainLoopStart });

  const subroutineStarts: number[] = [];
  for (let index = 0; index < subroutineCount; index += 1) {
    subroutineStarts.push(instructions.length);
    const saved = pick(rng, generalRegisters);
    instructions.push({ op: "push", source: register(saved) });
    const bodyLength = intBetween(rng, 3, 8);
    for (let body = 0; body < bodyLength; body += 1)
      instructions.push(
        ...(rng() < 0.6 ? aluInstruction(rng) : memoryInstructions(rng)),
      );
    instructions.push({ destination: saved, op: "pop" });
    instructions.push({ op: "ret" });
  }
  for (const patch of branchPatches) {
    const instruction = instructions[patch.at]!;
    instructions[patch.at] = { ...instruction, target: patch.target } as never;
  }
  for (const patch of callPatches)
    instructions[patch.at] = {
      op: "call",
      target: subroutineStarts[patch.subroutine]!,
    };

  return {
    executable: fuzzExecutable(instructions),
    memoryBytes: cs486FuzzMemoryBytes,
    name: `fuzz-seed-${String(seed)}`,
    recommendedSliceInstructions: 512,
  };
}

/**
 * Wraps instructions as a version-5 executable: the legacy v2 validator
 * rejects sub-width load/store opcodes, and v5 is the earliest version that
 * admits them under declared cs-flat32 metadata. The default metadata (64
 * KiB stack, no heap, no data) admits exactly the 64 KiB fuzz RAM budget
 * and keeps the stack floor at zero like a legacy zero-data executable.
 */
function fuzzExecutable(
  instructions: readonly Cs486Instruction[],
): Cs486Executable {
  return {
    dataBytes: 0,
    dataModel: cs486Word32DataModel,
    format: "cs486-executable",
    instructions,
    memory: createCs486Flat32MemoryMetadata(),
    version: 5,
  };
}

function forcedProgram(
  name: string,
  instructions: readonly Cs486Instruction[],
  recommendedSliceInstructions = 512,
): Cs486FuzzProgram {
  return {
    executable: fuzzExecutable(instructions),
    memoryBytes: cs486FuzzMemoryBytes,
    name,
    recommendedSliceInstructions,
  };
}

/**
 * Deterministic forced-injection cases from the Issue #106 divergence-risk
 * ledger. Each is tiny and terminal (halt or an intentional fault) so the
 * comparator pins the exact terminal state, fault type, and message.
 */
export function cs486FuzzForcedCases(): readonly Cs486FuzzProgram[] {
  return [
    forcedProgram("forced-int-min-div-neg-one", [
      { destination: "eax", op: "mov", source: immediate(int32Minimum) },
      { destination: "eax", op: "div", source: immediate(-1) },
      { address: immediate(16), op: "store", source: "eax" },
      { destination: "ebx", op: "mov", source: immediate(int32Minimum) },
      { destination: "ebx", op: "mod", source: immediate(-1) },
      { address: immediate(20), op: "store", source: "ebx" },
      { destination: "ecx", op: "mov", source: immediate(int32Minimum) },
      { destination: "edx", op: "mov", source: immediate(-1) },
      { destination: "ecx", op: "div", source: register("edx") },
      { address: immediate(24), op: "store", source: "ecx" },
      { op: "halt" },
    ]),
    forcedProgram("forced-div-by-zero", [
      { destination: "eax", op: "mov", source: immediate(7) },
      { destination: "ebx", op: "mov", source: immediate(0) },
      { destination: "eax", op: "div", source: register("ebx") },
      { op: "halt" },
    ]),
    forcedProgram("forced-mod-by-zero", [
      { destination: "eax", op: "mov", source: immediate(-9) },
      { destination: "ebx", op: "mov", source: immediate(0) },
      { destination: "eax", op: "mod", source: register("ebx") },
      { op: "halt" },
    ]),
    forcedProgram("forced-negative-mod-umod", [
      { destination: "eax", op: "mov", source: immediate(-7) },
      { destination: "eax", op: "mod", source: immediate(3) },
      { address: immediate(16), op: "store", source: "eax" },
      { destination: "ebx", op: "mov", source: immediate(7) },
      { destination: "ebx", op: "mod", source: immediate(-3) },
      { address: immediate(20), op: "store", source: "ebx" },
      { destination: "ecx", op: "mov", source: immediate(-7) },
      { destination: "ecx", op: "umod", source: immediate(3) },
      { address: immediate(24), op: "store", source: "ecx" },
      { destination: "edx", op: "mov", source: immediate(-20) },
      { destination: "edx", op: "udiv", source: immediate(3) },
      { address: immediate(28), op: "store", source: "edx" },
      { op: "halt" },
    ]),
    forcedProgram("forced-shift-beyond-31", [
      { destination: "eax", op: "mov", source: immediate(-1) },
      { destination: "eax", op: "shl", source: immediate(32) },
      { address: immediate(16), op: "store", source: "eax" },
      { destination: "ebx", op: "mov", source: immediate(-256) },
      { destination: "ebx", op: "shr", source: immediate(33) },
      { address: immediate(20), op: "store", source: "ebx" },
      { destination: "ecx", op: "mov", source: immediate(-256) },
      { destination: "ecx", op: "ushr", source: immediate(63) },
      { address: immediate(24), op: "store", source: "ecx" },
      { destination: "edx", op: "mov", source: immediate(-4) },
      { destination: "esi", op: "mov", source: immediate(40) },
      { destination: "edx", op: "shl", source: register("esi") },
      { address: immediate(28), op: "store", source: "edx" },
      { op: "halt" },
    ]),
    forcedProgram("forced-odd-address-8-32", [
      { destination: "eax", op: "mov", source: immediate(-2) },
      { address: immediate(4_097), op: "store8", source: "eax" },
      { address: immediate(4_097), destination: "ebx", op: "load8s" },
      { address: immediate(4_097), destination: "ecx", op: "load8u" },
      { destination: "edx", op: "mov", source: immediate(0x0102_0304) },
      { address: immediate(4_101), op: "store", source: "edx" },
      { address: immediate(4_101), destination: "esi", op: "load" },
      { address: immediate(4_098), destination: "edi", op: "load16u" },
      { op: "halt" },
    ]),
    forcedProgram("forced-odd-16bit-fault", [
      { destination: "eax", op: "mov", source: immediate(1) },
      { address: immediate(4_097), destination: "eax", op: "load16u" },
      { op: "halt" },
    ]),
    forcedProgram("forced-pop-underflow", [
      { destination: "eax", op: "pop" },
      { op: "halt" },
    ]),
    forcedProgram("forced-ret-bad-target", [
      { op: "push", source: immediate(1_000_000) },
      { op: "ret" },
    ]),
    forcedProgram(
      "forced-stack-overflow",
      [
        { op: "push", source: register("eax") },
        { op: "jmp", target: 0 },
      ],
      8_192,
    ),
    forcedProgram("forced-cache-conflict-walk", [
      { destination: "edi", op: "mov", source: immediate(64) },
      // outer: reset the strided pointer, walk six conflicting lines.
      { destination: "esi", op: "mov", source: immediate(8_192) },
      { destination: "ecx", op: "mov", source: immediate(6) },
      { address: register("esi"), destination: "eax", op: "load" },
      { destination: "eax", op: "add", source: register("edi") },
      { address: register("esi"), op: "store", source: "eax" },
      { destination: "esi", op: "add", source: immediate(2_048) },
      { destination: "ecx", op: "sub", source: immediate(1) },
      { left: "ecx", op: "cmp", right: immediate(0) },
      { op: "jg", target: 3 },
      { destination: "edi", op: "sub", source: immediate(1) },
      { left: "edi", op: "cmp", right: immediate(0) },
      { op: "jg", target: 1 },
      { op: "halt" },
    ]),
  ];
}

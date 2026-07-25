import {
  csAbiLimits,
  csAbiSelectors,
  type CsAbiBatchHeapLayout,
} from "../../src/application/runtime/csAbi.js";
import { createCs486Flat32MemoryMetadata } from "../../src/domain/cpu/cs486.js";
import type {
  Cs486Executable,
  Cs486Instruction,
  Cs486ProcessImageInitialization,
  Cs486Register,
} from "../../src/domain/cpu/cs486.js";
import { cs486Word32DataModel } from "../../src/domain/cpu/cs486Compatibility.js";

/**
 * Batch CS ABI corpus for Issue #114.
 *
 * `run --batch` is the one production path where a compute worker services a
 * CS ABI operation instead of refusing it, and those operations read and write
 * guest memory through the syscall context. These programs exercise the whole
 * isolated subset - the startup image, `heapInfo` pointer writes, ordered
 * fd 1/fd 2 writes, the errno paths, and both rejection faults - so a change
 * that narrows or widens the subset shows up as a changed outcome here rather
 * than only in a guest session.
 *
 * Issue #115 removed the second CS486 implementation this corpus was also used
 * to differentially compare against; the programs stay because they are the
 * executable statement of what a batch process may reach.
 */
export interface Cs486BatchCsAbiProgram {
  /** Heap placement of an admitted `run --batch` process. */
  readonly csAbi: CsAbiBatchHeapLayout;
  readonly executable: Cs486Executable;
  readonly memoryBytes: number;
  readonly name: string;
  /** Startup image installed before the first instruction. */
  readonly processImage: Cs486ProcessImageInitialization;
  /** Per-slice instruction budget a runner should use. */
  readonly recommendedSliceInstructions: number;
}
const heapBytes = 16_384;
const stackBytes = 16_384;

export const cs486BatchCsAbiMemoryBytes = 65_536;

/**
 * Heap placement the host would compute for an admitted batch process. The
 * values are distinct and unaligned with any engine-derived quantity, so a
 * `heapInfo` result can only match by being carried through the create payload.
 */
export const cs486BatchCsAbiLayout: CsAbiBatchHeapLayout = Object.freeze({
  heapBaseBytes: 0x0a_00,
  heapWords: 41,
  startupAddress: 0x01_00,
});

const messageAddress = 0x01_00;
/** `batch\n` as word-profile guest characters. */
const messageWords = [0x62, 0x61, 0x74, 0x63, 0x68, 0x0a];
const surrogateAddress = 0x02_00;
const heapWordsOut = 0x00_40;
const startupAddressOut = 0x00_80;

function movImmediate(
  destination: Cs486Register,
  value: number,
): Cs486Instruction {
  return { destination, op: "mov", source: { kind: "immediate", value } };
}

function csAbiCall(
  selector: number,
  registers: Partial<Record<"ecx" | "edx" | "esi", number>>,
): readonly Cs486Instruction[] {
  const setup: Cs486Instruction[] = [movImmediate("ebx", selector)];
  for (const register of ["ecx", "edx", "esi"] as const) {
    const value = registers[register];
    if (value !== undefined) setup.push(movImmediate(register, value));
  }
  return [...setup, { name: "cs", op: "syscall" }];
}

function batchExecutable(
  instructions: readonly Cs486Instruction[],
): Cs486Executable {
  return {
    dataBytes: 0,
    dataModel: cs486Word32DataModel,
    format: "cs486-executable",
    instructions,
    memory: createCs486Flat32MemoryMetadata({ heapBytes, stackBytes }),
    version: 5,
  };
}

/**
 * Startup image an admitted batch process receives: initialized heap words plus
 * right-to-left stack arguments, which also moves ESP away from its default.
 */
const batchProcessImage: Cs486ProcessImageInitialization = Object.freeze({
  segments: Object.freeze([
    Object.freeze({ address: messageAddress, words: messageWords }),
    // A lone unpaired surrogate, which the shared writer must reject as EINVAL
    // rather than emit.
    Object.freeze({ address: surrogateAddress, words: [0x41, 0xd8_00] }),
  ]),
  stackArguments: Object.freeze([1, messageAddress]),
});

function batchProgram(
  name: string,
  instructions: readonly Cs486Instruction[],
): Cs486BatchCsAbiProgram {
  return {
    csAbi: cs486BatchCsAbiLayout,
    executable: batchExecutable(instructions),
    memoryBytes: cs486BatchCsAbiMemoryBytes,
    name,
    processImage: batchProcessImage,
    recommendedSliceInstructions: 512,
  };
}

export function cs486BatchCsAbiForcedCases(): readonly Cs486BatchCsAbiProgram[] {
  return [
    // Reports the create-time placement into registers and guest memory, writes
    // fd 1 and fd 2 into the one ordered stream, then exits with a status the
    // handler normalizes.
    batchProgram("batch-heap-write-exit", [
      ...csAbiCall(csAbiSelectors.heapInfo, {
        ecx: heapWordsOut,
        edx: startupAddressOut,
      }),
      ...csAbiCall(csAbiSelectors.fsWrite, {
        ecx: 1,
        edx: messageAddress,
        esi: messageWords.length,
      }),
      ...csAbiCall(csAbiSelectors.fsWrite, {
        ecx: 2,
        edx: messageAddress,
        esi: 2,
      }),
      ...csAbiCall(csAbiSelectors.exit, { ecx: 300 }),
    ]),
    // Both errno paths return through EAX without producing output, and the
    // exit status carries the last errno so a divergence cannot hide in a
    // register the comparator happens not to read.
    batchProgram("batch-errno-paths", [
      ...csAbiCall(csAbiSelectors.fsWrite, {
        ecx: 1,
        edx: messageAddress,
        esi: csAbiLimits.ioWords + 1,
      }),
      ...csAbiCall(csAbiSelectors.fsWrite, {
        ecx: 1,
        edx: surrogateAddress,
        esi: 2,
      }),
      movImmediate("ebx", csAbiSelectors.exit),
      {
        destination: "ecx",
        op: "mov",
        source: { kind: "register", register: "eax" },
      },
      { name: "cs", op: "syscall" },
    ]),
    // A serviced write followed by an operation the isolated policy cannot own:
    // the retained output before the fault is part of the compared state.
    batchProgram("batch-unsupported-operation", [
      ...csAbiCall(csAbiSelectors.fsWrite, {
        ecx: 1,
        edx: messageAddress,
        esi: 3,
      }),
      ...csAbiCall(csAbiSelectors.termSize, { ecx: 0, edx: 0 }),
    ]),
    batchProgram("batch-unsupported-descriptor", [
      ...csAbiCall(csAbiSelectors.fsWrite, {
        ecx: 3,
        edx: messageAddress,
        esi: 1,
      }),
    ]),
    // A syscall outside the CS ABI name is an errno, not a fault, on both
    // engines, so the program keeps running to its halt.
    batchProgram("batch-foreign-syscall-name", [
      movImmediate("ebx", csAbiSelectors.exit),
      { name: "cs.host.probe", op: "syscall" },
      { op: "halt" },
    ]),
  ];
}

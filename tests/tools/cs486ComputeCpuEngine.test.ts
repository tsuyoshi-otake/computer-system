import { describe, expect, it } from "vitest";

import {
  createCs486TypeScriptComputeEngine,
  cs486ComputeEngineNames,
  defaultCs486ComputeEngineName,
  isCs486ComputeEngineName,
  rejectCs486ComputeSyscall,
  type Cs486ComputeProcessOptions,
} from "../../tools/cs486-compute-worker-cpu-engine.js";
import {
  csAbiSelectors,
  type CsAbiBatchHeapLayout,
} from "../../src/application/runtime/csAbi.js";
import type {
  Cs486Executable,
  Cs486Instruction,
  Cs486Register,
} from "../../src/domain/cpu/cs486.js";

const addingExecutable: Cs486Executable = {
  dataBytes: 0,
  format: "cs486-executable",
  instructions: [
    { destination: "eax", op: "mov", source: { kind: "immediate", value: 7 } },
    {
      destination: "eax",
      op: "add",
      source: { kind: "immediate", value: 35 },
    },
    { op: "halt" },
  ],
  version: 2,
};

const baseOptions: Cs486ComputeProcessOptions = {
  collectMicroarchitectureStats: false,
  cpuModel: "cs486dx2",
  memoryBytes: 65_536,
};

/**
 * Heap placement a `run --batch` admission hands to the worker. The values are
 * arbitrary but distinct, so a `heapInfo` result can only match by being read
 * back from this layout rather than recomputed inside an engine.
 */
const batchLayout: CsAbiBatchHeapLayout = Object.freeze({
  heapBaseBytes: 0x08_00,
  heapWords: 37,
  startupAddress: 0x01_00,
});

const messageAddress = 0x01_00;
const errorAddress = messageAddress + 8;

/** Startup image placing `hi` and `err` as word-profile guest characters. */
const batchProcessImage = Object.freeze({
  segments: [
    Object.freeze({
      address: messageAddress,
      words: [0x68, 0x69, 0x65, 0x72, 0x72],
    }),
  ],
  stackArguments: [1, messageAddress],
});

const batchOptions: Cs486ComputeProcessOptions = {
  ...baseOptions,
  csAbi: batchLayout,
  processImage: batchProcessImage,
};

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

/**
 * A declared-memory executable, which is what `cc` emits and therefore the only
 * shape a batch process ever has. A startup image may only occupy declared heap
 * memory, so the legacy fixtures above cannot carry one.
 */
function batchExecutable(
  instructions: readonly Cs486Instruction[],
): Cs486Executable {
  return {
    dataBytes: 0,
    format: "cs486-executable",
    instructions,
    memory: {
      auxiliaryResidentBytes: 0,
      heapBytes: 16_384,
      model: "cs-flat32-v1",
      stackBytes: 16_384,
    },
    version: 3,
  };
}

const writingBatchExecutable = batchExecutable([
  ...csAbiCall(csAbiSelectors.fsWrite, {
    ecx: 1,
    edx: messageAddress,
    esi: 2,
  }),
  ...csAbiCall(csAbiSelectors.fsWrite, { ecx: 2, edx: errorAddress, esi: 3 }),
  ...csAbiCall(csAbiSelectors.exit, { ecx: 5 }),
]);

/** Exits with the heap word count the create-time layout declared. */
const heapInfoBatchExecutable = batchExecutable([
  ...csAbiCall(csAbiSelectors.heapInfo, { ecx: 0, edx: 0 }),
  movImmediate("ebx", csAbiSelectors.exit),
  {
    destination: "ecx",
    op: "mov",
    source: { kind: "register", register: "edx" },
  },
  { name: "cs", op: "syscall" },
]);

const terminalSizeBatchExecutable = batchExecutable([
  ...csAbiCall(csAbiSelectors.termSize, { ecx: 0, edx: 0 }),
]);

describe("CS486 compute engine registry", () => {
  it("names exactly the engines the worker can construct", () => {
    // Issue #115 removed the second engine, so a name outside this one value
    // must stay unrecognized instead of being accepted and silently mapped
    // back onto the interpreter.
    expect([...cs486ComputeEngineNames]).toEqual(["typescript"]);
    expect(defaultCs486ComputeEngineName).toBe("typescript");
    expect(isCs486ComputeEngineName("wasm-rust")).toBe(false);
    expect(isCs486ComputeEngineName(undefined)).toBe(false);
  });

  it("refuses every syscall with one shared fault", () => {
    expect(() => rejectCs486ComputeSyscall("host.exec")).toThrow(
      /CS486 compute worker rejects syscall host\.exec/u,
    );
  });
});

describe("TypeScript compute engine", () => {
  it("runs a bounded slice to an observable terminal state", () => {
    const engine = createCs486TypeScriptComputeEngine();
    expect(engine.name).toBe("typescript");
    const process = engine.createProcess(addingExecutable, baseOptions);
    const result = process.runCpuSlice(100_000, 1_000);
    expect(result.state).toEqual({ kind: "completed", value: 42 });
    expect(process.memoryLimitBytes).toBe(65_536);
    expect(() => process.runCpuSlice(0, 1)).toThrow(/positive safe integer/u);
  });
});

// A batch process is the only case where a worker services a CS ABI operation
// at all, so this is the whole of what a worker may do on a guest's behalf.
describe("compute engine batch CS ABI", () => {
  const create = createCs486TypeScriptComputeEngine;

  it("keeps fd 1 and fd 2 in one ordered stream and honours the exit status", () => {
    const process = create().createProcess(
      writingBatchExecutable,
      batchOptions,
    );
    const result = process.runCpuSlice(100_000, 1_000);
    expect(result.state).toEqual({ kind: "completed", value: 5 });
    expect(process.output).toBe("hierr");
  });

  it("reports the create-time heap placement without an OS service", () => {
    const process = create().createProcess(
      heapInfoBatchExecutable,
      batchOptions,
    );
    expect(process.runCpuSlice(100_000, 1_000).state).toEqual({
      kind: "completed",
      value: batchLayout.heapWords,
    });
    expect(process.output).toBe("");
  });

  it("fails explicitly on an operation the isolated policy cannot service", () => {
    const process = create().createProcess(
      terminalSizeBatchExecutable,
      batchOptions,
    );
    expect(process.runCpuSlice(100_000, 1_000).state).toMatchObject({
      error: {
        message: `batch process cannot use CS ABI operation ${String(csAbiSelectors.termSize)}; re-run this program without batch mode`,
        typeName: "UnsupportedOperationError",
      },
      kind: "crashed",
    });
    expect(process.output).toBe("");
  });

  it("keeps the terminal rejection for a process the host did not admit as batch", () => {
    // Without `csAbi` the very same program is an ordinary worker process, so
    // the CS ABI name is refused like every other syscall.
    const process = create().createProcess(writingBatchExecutable, baseOptions);
    expect(process.runCpuSlice(100_000, 1_000).state).toMatchObject({
      error: {
        message: "CS486 compute worker rejects syscall cs",
        typeName: "UnsupportedOperationError",
      },
      kind: "crashed",
    });
    expect(process.output).toBe("");
  });
});

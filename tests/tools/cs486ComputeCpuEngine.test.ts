import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createCs486TypeScriptComputeEngine,
  createCs486WasmComputeEngine,
  cs486ComputeEngineNames,
  defaultCs486ComputeEngineName,
  isCs486ComputeEngineName,
  rejectCs486ComputeSyscall,
  type Cs486ComputeCpuEngine,
  type Cs486ComputeProcessOptions,
} from "../../tools/cs486-compute-worker-cpu-engine.js";
import { compileCs486WasmModule } from "../../tools/wasm-engines/wasm-instantiation.js";
import {
  csAbiSelectors,
  type CsAbiBatchHeapLayout,
} from "../../src/application/runtime/csAbi.js";
import type {
  Cs486Executable,
  Cs486Instruction,
  Cs486Register,
} from "../../src/domain/cpu/cs486.js";

// Mirrors `tools/cs486-wasm-batch-executor-loader.mjs`, which is `.mjs` and so
// unavailable to a typed test. `npm run validate` must stay green without
// cargo, so the wasm suite skips rather than fails when the build is absent.
const rustArtifactPath = fileURLToPath(
  new URL("../../wasm/dist/cs486-batch-executor.rust.wasm", import.meta.url),
);
const rustArtifactPresent = existsSync(rustArtifactPath);

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

const floatExecutable: Cs486Executable = {
  dataBytes: 0,
  format: "cs486-executable",
  instructions: [{ name: "cs.fp.f64.add", op: "syscall" }],
  version: 2,
};

const baseOptions: Cs486ComputeProcessOptions = {
  collectMicroarchitectureStats: false,
  cpuModel: "cs486dx2",
  memoryBytes: 65_536,
};

function loadWasmEngine(): Cs486ComputeCpuEngine {
  return createCs486WasmComputeEngine(
    compileCs486WasmModule(readFileSync(rustArtifactPath)),
  );
}

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

const engineCases: readonly {
  readonly create: () => Cs486ComputeCpuEngine;
  readonly name: string;
}[] = [
  { create: createCs486TypeScriptComputeEngine, name: "typescript" },
  ...(rustArtifactPresent
    ? [{ create: loadWasmEngine, name: "wasm-rust" }]
    : []),
];

describe("CS486 compute engine registry", () => {
  it("names exactly the engines the worker can construct", () => {
    expect([...cs486ComputeEngineNames]).toEqual(["typescript", "wasm-rust"]);
    expect(defaultCs486ComputeEngineName).toBe("typescript");
    expect(isCs486ComputeEngineName("wasm-rust")).toBe(true);
    expect(isCs486ComputeEngineName("wasm-unknown")).toBe(false);
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

describe.skipIf(!rustArtifactPresent)(
  "wasm compute engine (requires the built Rust artifact)",
  () => {
    it("reaches the same terminal value and budget contract as the TypeScript engine", () => {
      const engine = loadWasmEngine();
      expect(engine.name).toBe("wasm-rust");
      const wasm = engine.createProcess(addingExecutable, baseOptions);
      const typescript = createCs486TypeScriptComputeEngine().createProcess(
        addingExecutable,
        baseOptions,
      );
      expect(wasm.runCpuSlice(100_000, 1_000)).toEqual(
        typescript.runCpuSlice(100_000, 1_000),
      );
      expect(wasm.memoryLimitBytes).toBe(typescript.memoryLimitBytes);
      expect(wasm.output).toBe(typescript.output);
      expect(() => wasm.runCpuSlice(100_000, 0)).toThrow(
        /positive safe integer/u,
      );
      expect(() => wasm.advanceTick(-1)).toThrow(/monotonically/u);
    });

    it("refuses at create time what it cannot execute faithfully", () => {
      const engine = loadWasmEngine();
      // Deterministic float is BigInt-rational arithmetic owned by the
      // TypeScript model, so a model with an FPU must never silently get an
      // approximation from wasm.
      expect(() => engine.createProcess(floatExecutable, baseOptions)).toThrow(
        /cannot execute deterministic float syscall cs\.fp\.f64\.add on cs486dx2/u,
      );
      // The wasm engine never builds a `Cs486Process`, so it must run the
      // shared executable validator itself instead of inheriting it.
      expect(() =>
        engine.createProcess(
          {
            ...addingExecutable,
            format: "native-executable",
          } as unknown as Cs486Executable,
          baseOptions,
        ),
      ).toThrow();
    });

    it("reproduces the CS386SX missing-coprocessor fault instead of rejecting the syscall", () => {
      // CS386SX has no 80387, so production faults at dispatch. The wasm engine
      // admits the executable and reports the identical fault, exactly as the
      // TypeScript engine does on the same profile.
      const process = loadWasmEngine().createProcess(floatExecutable, {
        ...baseOptions,
        cpuModel: "cs386sx",
      });
      const result = process.runCpuSlice(100_000, 1_000);
      expect(result.state).toMatchObject({
        error: {
          message:
            "cs.fp.f64.add requires an 80387 coprocessor unavailable on CS386SX",
          typeName: "UnsupportedError",
        },
        kind: "crashed",
      });
    });
  },
);

// A batch process is the only case where a worker services a CS ABI operation
// at all, so both engines must reach the identical policy. The wasm cases are
// skipped, not failed, when the Rust artifact was never built.
for (const { create, name } of engineCases) {
  describe(`${name} compute engine batch CS ABI`, () => {
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
      const process = create().createProcess(
        writingBatchExecutable,
        baseOptions,
      );
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
}

describe.skipIf(!rustArtifactPresent)(
  "batch CS ABI engine equivalence (requires the built Rust artifact)",
  () => {
    it("produces the identical batch result on both engines", () => {
      const wasm = loadWasmEngine().createProcess(
        writingBatchExecutable,
        batchOptions,
      );
      const typescript = createCs486TypeScriptComputeEngine().createProcess(
        writingBatchExecutable,
        batchOptions,
      );
      expect(wasm.runCpuSlice(100_000, 1_000)).toEqual(
        typescript.runCpuSlice(100_000, 1_000),
      );
      expect(wasm.output).toBe(typescript.output);
      expect(wasm.memoryLimitBytes).toBe(typescript.memoryLimitBytes);
      // The startup image moves ESP, so an equal usage also proves both engines
      // applied the same stack arguments.
      expect(wasm.memoryUsageBytes).toBe(typescript.memoryUsageBytes);
    });

    it("reports the identical rejection for an unserviceable operation", () => {
      const wasm = loadWasmEngine().createProcess(
        terminalSizeBatchExecutable,
        batchOptions,
      );
      const typescript = createCs486TypeScriptComputeEngine().createProcess(
        terminalSizeBatchExecutable,
        batchOptions,
      );
      expect(wasm.runCpuSlice(100_000, 1_000)).toEqual(
        typescript.runCpuSlice(100_000, 1_000),
      );
    });
  },
);

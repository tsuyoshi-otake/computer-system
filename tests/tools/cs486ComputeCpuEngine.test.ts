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
import type { Cs486Executable } from "../../src/domain/cpu/cs486.js";

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
      expect(() =>
        engine.createProcess(addingExecutable, {
          ...baseOptions,
          processImage: { segments: [], stackArguments: [1] },
        }),
      ).toThrow(/cannot initialize a process image/u);
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

import { describe, expect, it } from "vitest";
import {
  assertDeterministicSamples,
  benchmarkCs486Interpreter,
  parseBenchmarkArguments,
  summarize,
} from "../../tools/benchmark-cs486-interpreter.mjs";

const stableSample = Object.freeze({
  cpuMicroseconds: 10,
  elapsedNanoseconds: 20,
  executedInstructions: 30,
  guestCycles: 40,
  guestRamSha256: "a".repeat(64),
  hasPendingCpuCycles: false,
  instructionPointer: 6,
  instrumentation: "enabled",
  microarchitecture: Object.freeze({
    busTransfers: 1,
    instructionFetches: 2,
    l1Hits: 3,
    l1Misses: 4,
    l2Hits: 5,
    l2Misses: 6,
    pipelineFlushes: 7,
    unalignedAccesses: 8,
  }),
  output: "",
  processState: Object.freeze({ kind: "ready" }),
  registerChecksum: 50,
  registers: Object.freeze({
    eax: 1,
    ebp: 8,
    ebx: 2,
    ecx: 3,
    edi: 6,
    edx: 4,
    esi: 5,
    esp: 7,
  }),
});

const deterministicMismatchCases = [
  [
    "executed instruction count",
    {
      ...stableSample,
      executedInstructions: stableSample.executedInstructions + 1,
    },
  ],
  ["modeled guest cycles", { ...stableSample, guestCycles: 41 }],
  ["legacy register checksum", { ...stableSample, registerChecksum: 51 }],
  [
    "full register snapshot",
    {
      ...stableSample,
      registers: {
        ...stableSample.registers,
        esi: stableSample.registers.esi + 1,
      },
    },
  ],
  ["instruction pointer", { ...stableSample, instructionPointer: 7 }],
  [
    "process state",
    { ...stableSample, processState: { kind: "waiting_event", filter: "key" } },
  ],
  ["output", { ...stableSample, output: "unexpected" }],
  [
    "full guest RAM digest",
    { ...stableSample, guestRamSha256: "b".repeat(64) },
  ],
  ["pending CPU cycles", { ...stableSample, hasPendingCpuCycles: true }],
  [
    "microarchitecture counters",
    {
      ...stableSample,
      microarchitecture: {
        ...stableSample.microarchitecture,
        pipelineFlushes: stableSample.microarchitecture.pipelineFlushes + 1,
      },
    },
  ],
];

describe("CS486 interpreter host-throughput benchmark", () => {
  it("parses bounded reproducible sample options", () => {
    expect(
      parseBenchmarkArguments(["--instructions", "250000", "--samples", "5"]),
    ).toEqual({
      corpus: "alu-branch",
      engine: "ts",
      executionMode: "instruction-slice",
      instrumentation: "enabled",
      instructionCount: 250_000,
      samples: 5,
    });
    expect(parseBenchmarkArguments(["--mode", "cpu-slice"])).toMatchObject({
      executionMode: "cpu-slice",
    });
    expect(
      parseBenchmarkArguments(["--instrumentation", "disabled"]),
    ).toMatchObject({
      instrumentation: "disabled",
    });
    expect(() => parseBenchmarkArguments(["--instructions", "9999"])).toThrow(
      /between 10000 and 50000000/u,
    );
    expect(() => parseBenchmarkArguments(["--samples", "32"])).toThrow(
      /between 3 and 31/u,
    );
    expect(() => parseBenchmarkArguments(["--unknown"])).toThrow(
      /Unknown benchmark argument/u,
    );
    expect(() => parseBenchmarkArguments(["--mode", "unknown"])).toThrow(
      /mode must be one of/u,
    );
    expect(() =>
      parseBenchmarkArguments(["--instrumentation", "unknown"]),
    ).toThrow(/instrumentation must be one of enabled, disabled/u);
    expect(() => parseBenchmarkArguments(["--instrumentation"])).toThrow(
      /instrumentation must be one of enabled, disabled/u,
    );
  });

  it("parses the wasm A/B engine and corpus selections", () => {
    expect(
      parseBenchmarkArguments([
        "--engine",
        "wasm-rust",
        "--corpus",
        "mem-stack",
      ]),
    ).toMatchObject({
      corpus: "mem-stack",
      engine: "wasm-rust",
    });
    expect(
      parseBenchmarkArguments([
        "--engine",
        "wasm-rust",
        "--corpus",
        "hosted-c-mid",
      ]),
    ).toMatchObject({
      corpus: "hosted-c-mid",
      engine: "wasm-rust",
    });
    expect(() => parseBenchmarkArguments(["--engine", "unknown"])).toThrow(
      /engine must be one of ts, wasm-rust/u,
    );
    expect(() => parseBenchmarkArguments(["--corpus", "unknown"])).toThrow(
      /corpus must be one of alu-branch, mem-stack, hosted-c-mid/u,
    );
    expect(() => parseBenchmarkArguments(["--engine"])).toThrow(
      /engine must be one of/u,
    );
    expect(() => parseBenchmarkArguments(["--corpus"])).toThrow(
      /corpus must be one of/u,
    );
  });

  it("reports deterministic nearest-rank median and p95 summaries", () => {
    expect(summarize([90, 10, 50, 20, 30])).toEqual({ median: 30, p95: 90 });
  });

  it("accepts deeply equal guest evidence while host timing varies", () => {
    expect(() =>
      assertDeterministicSamples([
        stableSample,
        {
          ...stableSample,
          cpuMicroseconds: 11,
          elapsedNanoseconds: 21,
          microarchitecture: { ...stableSample.microarchitecture },
          processState: { ...stableSample.processState },
          registers: { ...stableSample.registers },
        },
      ]),
    ).not.toThrow();
  });

  it("compares counters within a mode and accepts their intentional absence across modes", () => {
    const disabledSample = {
      ...stableSample,
      instrumentation: "disabled",
      microarchitecture: null,
    };
    expect(() =>
      assertDeterministicSamples([
        stableSample,
        disabledSample,
        {
          ...disabledSample,
          cpuMicroseconds: 11,
          elapsedNanoseconds: 21,
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertDeterministicSamples([
        disabledSample,
        {
          ...disabledSample,
          microarchitecture: { ...stableSample.microarchitecture },
        },
      ]),
    ).toThrow(/disabled instrumentation with microarchitecture counters/u);
  });

  it.each(deterministicMismatchCases)(
    "rejects a %s mismatch between host samples",
    (_label, changedSample) => {
      expect(() =>
        assertDeterministicSamples([stableSample, changedSample]),
      ).toThrow(/changed deterministic guest results/u);
    },
  );

  it("reports complete authoritative guest evidence apart from host timing", async () => {
    const report = await benchmarkCs486Interpreter({
      executionMode: "instruction-slice",
      instrumentation: "enabled",
      instructionCount: 10_000,
      samples: 3,
    });

    expect(report.instrumentation).toBe("enabled");
    expect(report.results).toHaveLength(3);
    for (const result of report.results) {
      expect(result.guestRamSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(result.hasPendingCpuCycles).toBe(false);
      expect(result.processState).toEqual({ kind: "ready" });
      expect(result.output).toBe("");
      expect(Object.keys(result.registers)).toEqual([
        "eax",
        "ebx",
        "ecx",
        "edx",
        "esi",
        "edi",
        "esp",
        "ebp",
      ]);
      expect(result.microarchitecture).toEqual({
        busTransfers: expect.any(Number),
        instructionFetches: expect.any(Number),
        l1Hits: expect.any(Number),
        l1Misses: expect.any(Number),
        l2Hits: expect.any(Number),
        l2Misses: expect.any(Number),
        pipelineFlushes: expect.any(Number),
        unalignedAccesses: expect.any(Number),
      });
      expect(result.microarchitecture.instructionFetches).toBeGreaterThan(0);
      expect(result.hostCpuMicroseconds).toEqual({
        median: expect.any(Number),
        p95: expect.any(Number),
      });
      expect(result.hostElapsedNanoseconds).toEqual({
        median: expect.any(Number),
        p95: expect.any(Number),
      });
    }
  });

  it("reports unavailable counters as null when instrumentation is disabled", async () => {
    const report = await benchmarkCs486Interpreter({
      executionMode: "instruction-slice",
      instrumentation: "disabled",
      instructionCount: 10_000,
      samples: 3,
    });

    expect(report.instrumentation).toBe("disabled");
    expect(report.results).toHaveLength(3);
    for (const result of report.results) {
      expect(result.microarchitecture).toBeNull();
      expect(result.guestRamSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(result.instructionsPerSample).toBe(10_000);
    }
  });

  it("retains the legacy deterministic comparison fields", () => {
    const legacySample = {
      cpuMicroseconds: 10,
      elapsedNanoseconds: 20,
      executedInstructions: 30,
      guestCycles: 40,
      registerChecksum: 50,
    };
    expect(() =>
      assertDeterministicSamples([
        legacySample,
        {
          ...legacySample,
          cpuMicroseconds: 11,
          elapsedNanoseconds: 21,
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertDeterministicSamples([
        legacySample,
        {
          ...legacySample,
          guestCycles: 41,
        },
      ]),
    ).toThrow(/changed deterministic guest results/u);
  });
});

import { describe, expect, it } from "vitest";

import {
  assertEquivalentComputerEvidence,
  assignComputerShards,
  benchmarkCs486Concurrency,
  parseConcurrencyBenchmarkArguments,
} from "../../tools/benchmark-cs486-concurrency.mjs";

describe("CS486 multi-Computer worker benchmark", () => {
  it("defaults to the approved two-worker capacity profile", () => {
    expect(parseConcurrencyBenchmarkArguments([])).toEqual({
      computers: 10,
      cpuModel: "cs486dx2",
      instructionBudget: 330_000,
      instrumentation: "disabled",
      samples: 21,
      ticks: 10,
      workers: 2,
    });
  });

  it("parses bounded explicit concurrency options", () => {
    expect(
      parseConcurrencyBenchmarkArguments([
        "--computers",
        "4",
        "--workers",
        "2",
        "--ticks",
        "3",
        "--instructions-per-runtime",
        "20000",
        "--samples",
        "5",
        "--cpu-model",
        "cs486dx",
        "--instrumentation",
        "enabled",
      ]),
    ).toEqual({
      computers: 4,
      cpuModel: "cs486dx",
      instructionBudget: 20_000,
      instrumentation: "enabled",
      samples: 5,
      ticks: 3,
      workers: 2,
    });
  });

  it("rejects unbounded work and capacity-plus-one inputs", () => {
    expect(() =>
      parseConcurrencyBenchmarkArguments(["--computers", "65"]),
    ).toThrow(/computers must be between 1 and 64/u);
    expect(() =>
      parseConcurrencyBenchmarkArguments(["--workers", "17"]),
    ).toThrow(/workers must be between 1 and 16/u);
    expect(() =>
      parseConcurrencyBenchmarkArguments([
        "--instructions-per-runtime",
        "1650001",
      ]),
    ).toThrow(/instructions-per-runtime must be between 10000 and 1650000/u);
    expect(() =>
      parseConcurrencyBenchmarkArguments([
        "--computers",
        "2",
        "--workers",
        "3",
      ]),
    ).toThrow(/workers cannot exceed the Computer count/u);
    expect(() =>
      parseConcurrencyBenchmarkArguments([
        "--computers",
        "11",
        "--workers",
        "2",
      ]),
    ).toThrow(/admits at most 10 full-rate Computers/u);
    expect(() =>
      parseConcurrencyBenchmarkArguments([
        "--computers",
        "16",
        "--workers",
        "16",
        "--ticks",
        "100",
        "--instructions-per-runtime",
        "1650000",
        "--samples",
        "31",
      ]),
    ).toThrow(/benchmark work must not exceed 2000000000/u);
    expect(() => parseConcurrencyBenchmarkArguments(["--unknown"])).toThrow(
      /Unknown concurrency benchmark argument/u,
    );
  });

  it("keeps stable Computer affinity and balances shard cardinality", () => {
    expect(
      assignComputerShards(
        [
          "computer-01",
          "computer-02",
          "computer-03",
          "computer-04",
          "computer-05",
        ],
        2,
      ),
    ).toEqual([
      ["computer-01", "computer-03", "computer-05"],
      ["computer-02", "computer-04"],
    ]);
  });

  it("rejects any guest-state difference between worker counts", () => {
    const expected = [
      {
        computerId: "computer-01",
        executedInstructions: 10_000,
        registers: { eax: 1 },
      },
    ];
    expect(() =>
      assertEquivalentComputerEvidence(expected, structuredClone(expected)),
    ).not.toThrow();
    expect(() =>
      assertEquivalentComputerEvidence(expected, [
        {
          ...expected[0],
          executedInstructions: 9_999,
        },
      ]),
    ).toThrow(/changed deterministic multi-Computer guest results/u);
  });

  it("runs the same bounded Computer batch through one and two long-lived workers", async () => {
    const report = await benchmarkCs486Concurrency({
      computers: 2,
      cpuModel: "cs486dx2",
      instructionBudget: 10_000,
      instrumentation: "disabled",
      samples: 3,
      ticks: 1,
      workers: 2,
    });

    expect(report.benchmark).toBe("cs486-multi-computer-worker-throughput-v1");
    expect(report.correctness).toEqual({
      comparedExecutions: 6,
      computerEvidenceSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      deterministicAcrossWorkerCounts: true,
    });
    expect(report.configuration).toMatchObject({
      aggregateInstructionCapacity: 3_300_000,
      computers: 2,
      instructionBudget: 10_000,
      perWorkerInstructionCapacity: 1_650_000,
      totalInstructionsPerSample: 20_000,
      workers: 2,
    });
    expect(report.host.baseline.aggregateInstructionsPerSecond).toBeGreaterThan(
      0,
    );
    expect(
      report.host.candidate.aggregateInstructionsPerSecond,
    ).toBeGreaterThan(0);
    expect(report.host.speedup).toBeGreaterThan(0);
    expect(report.host.executionSpeedup).toBeGreaterThan(0);
    expect(
      report.host.candidate.batchAveragePerTickNanoseconds.median,
    ).toBeGreaterThan(0);
    expect(report.host.availableParallelism).toBeGreaterThanOrEqual(1);
    expect(
      report.host.rssIncreaseWithBenchmarkPoolsBytes,
    ).toBeGreaterThanOrEqual(0);
    expect(report.sharding).toEqual({
      baseline: [["computer-01", "computer-02"]],
      candidate: [["computer-01"], ["computer-02"]],
    });
  }, 30_000);
});

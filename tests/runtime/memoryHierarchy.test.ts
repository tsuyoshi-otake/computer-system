import { describe, expect, it } from "vitest";

import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import {
  Cs486Process,
  cs486ExecutableMemoryRequirements,
  maximumCs486LinearAddressSpaceBytes,
  runCs486,
  type Cs486RunResult,
} from "../../src/domain/cpu/cs486.js";
import {
  cs486FormatLimits,
  currentCs486ExecutableFormatVersion,
} from "../../src/domain/cpu/cs486FormatLimits.js";
import {
  CpuMemoryHierarchy,
  createCache,
} from "../../src/domain/cpu/memoryHierarchy.js";
import {
  cpuModelIds,
  cpuModelSpecification,
  type CpuModel,
} from "../../src/domain/cpu/models.js";

const bytesPerDword = 4;
const maximumProductionInstructionIndex =
  cs486FormatLimits({
    format: "executable",
    version: currentCs486ExecutableFormatVersion,
  }).instructions - 1;
const maximumProductionDataDwordAddress =
  maximumCs486LinearAddressSpaceBytes - bytesPerDword;
const maximumProductionDataByteAddress =
  maximumCs486LinearAddressSpaceBytes - 1;

describe("CS386SX and CS486 memory hierarchy", (): void => {
  it("charges the 386SX third 16-bit transfer only for odd dword addresses", (): void => {
    const aligned = run("load eax, [1024]\nhalt", "cs386sx");
    const unaligned = run("load eax, [1025]\nhalt", "cs386sx");

    expect(unaligned.cycles - aligned.cycles).toBe(2);
    expect(unaligned.microarchitecture.unalignedAccesses).toBe(1);
    expect(unaligned.microarchitecture.busTransfers).toBe(
      aligned.microarchitecture.busTransfers + 1,
    );
    expect(aligned.microarchitecture.l1Hits).toBe(0);
    expect(aligned.microarchitecture.l1Misses).toBe(0);
  });

  it("makes aligned repeated 486 loads cheaper through 16-byte L1 locality", (): void => {
    const local = run(
      "load eax, [1024]\nload ebx, [1024]\nload ecx, [1028]\nhalt",
      "cs486dx",
    );
    const scattered = run(
      "load eax, [1024]\nload ebx, [4096]\nload ecx, [8192]\nhalt",
      "cs486dx",
    );

    expect(local.microarchitecture.l1Hits).toBeGreaterThan(
      scattered.microarchitecture.l1Hits,
    );
    expect(local.microarchitecture.l1Misses).toBeLessThan(
      scattered.microarchitecture.l1Misses,
    );
    expect(local.cycles).toBeLessThan(scattered.cycles);
  });

  it("preserves cycles and statistics across repeated accesses to one L1 line", (): void => {
    const hierarchy = new CpuMemoryHierarchy("cs486dx");
    const specification = cpuModelSpecification("cs486dx").microarchitecture;
    const missCycles =
      (specification.cacheLineBytes / 4) *
      specification.mainMemoryTransferCycles;

    expect(hierarchy.accessData(1024, "read")).toBe(missCycles);
    expect(hierarchy.accessData(1028, "read")).toBe(0);
    expect(hierarchy.accessData(1032, "read")).toBe(0);
    expect(hierarchy.accessData(1024, "read")).toBe(0);
    expect(hierarchy.stats).toEqual({
      busTransfers: 4,
      instructionFetches: 0,
      l1Hits: 3,
      l1Misses: 1,
      l2Hits: 0,
      l2Misses: 0,
      pipelineFlushes: 0,
      unalignedAccesses: 0,
    });
  });

  it("keeps the most-recent-line fast path inside exact cache-line bounds", (): void => {
    const hierarchy = new CpuMemoryHierarchy("cs486dx");
    const specification = cpuModelSpecification("cs486dx").microarchitecture;
    const lineStart = 2048;
    const missCycles =
      (specification.cacheLineBytes / 4) *
      specification.mainMemoryTransferCycles;

    expect(hierarchy.accessData(lineStart, "read")).toBe(missCycles);
    expect(
      hierarchy.accessData(
        lineStart + specification.cacheLineBytes - 4,
        "read",
      ),
    ).toBe(0);
    expect(
      hierarchy.accessData(lineStart + specification.cacheLineBytes, "read"),
    ).toBe(missCycles);
    expect(hierarchy.stats).toMatchObject({
      busTransfers: 8,
      l1Hits: 1,
      l1Misses: 2,
    });
  });

  it("preserves exact hits when alternating between cache sets", (): void => {
    const hierarchy = new CpuMemoryHierarchy("cs486dx");
    const specification = cpuModelSpecification("cs486dx").microarchitecture;
    const first = 4096;
    const second = first + specification.cacheLineBytes;
    const missCycles =
      (specification.cacheLineBytes / 4) *
      specification.mainMemoryTransferCycles;

    expect(hierarchy.accessData(first, "read")).toBe(missCycles);
    expect(hierarchy.accessData(second, "read")).toBe(missCycles);
    expect(hierarchy.accessData(first, "read")).toBe(0);
    expect(hierarchy.accessData(second, "read")).toBe(0);
    expect(hierarchy.stats).toMatchObject({
      busTransfers: 8,
      l1Hits: 2,
      l1Misses: 2,
    });
  });

  it("keeps the refreshed line and evicts the least-recently-used colliding line", (): void => {
    const hierarchy = new CpuMemoryHierarchy("cs486dx");
    const [a, b, c, d, e] = [1024, 3072, 5120, 7168, 9216] as const;
    const missCycles = hierarchy.accessData(a, "read");

    expect(hierarchy.accessData(b, "read")).toBe(missCycles);
    expect(hierarchy.accessData(c, "read")).toBe(missCycles);
    expect(hierarchy.accessData(d, "read")).toBe(missCycles);
    expect(hierarchy.accessData(a, "read")).toBe(0);
    expect(hierarchy.accessData(e, "read")).toBe(missCycles);

    expect(hierarchy.accessData(a, "read")).toBe(0);
    expect(hierarchy.accessData(c, "read")).toBe(0);
    expect(hierarchy.accessData(d, "read")).toBe(0);
    expect(hierarchy.accessData(e, "read")).toBe(0);
    expect(hierarchy.accessData(b, "read")).toBe(missCycles);
    expect(hierarchy.stats).toMatchObject({
      busTransfers: 24,
      l1Hits: 5,
      l1Misses: 6,
    });
  });

  it.each(cpuModelIds)(
    "preserves the highest production instruction fetch for %s",
    (cpuModel: CpuModel): void => {
      const hierarchy = new CpuMemoryHierarchy(cpuModel);
      const specification = cpuModelSpecification(cpuModel).microarchitecture;
      const cacheLineDwordTransfers =
        specification.cacheLineBytes / bytesPerDword;
      const instructionLineTransfers =
        specification.cacheLineBytes /
        (cpuModel === "cs386sx" ? 2 : bytesPerDword);
      const coldCycles =
        cpuModel === "cs386sx"
          ? 0
          : cacheLineDwordTransfers * specification.mainMemoryTransferCycles;

      expect(
        hierarchy.fetchInstruction(maximumProductionInstructionIndex),
      ).toBe(coldCycles);
      expect(
        hierarchy.fetchInstruction(maximumProductionInstructionIndex),
      ).toBe(0);
      hierarchy.recordControlTransfer(true);
      expect(
        hierarchy.fetchInstruction(maximumProductionInstructionIndex),
      ).toBe(0);
      expect(hierarchy.stats).toEqual({
        busTransfers:
          cpuModel === "cs386sx"
            ? instructionLineTransfers * 2
            : cacheLineDwordTransfers,
        instructionFetches: 3,
        l1Hits: cpuModel === "cs386sx" ? 0 : 2,
        l1Misses: cpuModel === "cs386sx" ? 0 : 1,
        l2Hits: 0,
        l2Misses: cpuModel === "cs486dx2" ? 1 : 0,
        pipelineFlushes: 1,
        unalignedAccesses: 0,
      });
    },
  );

  it.each(cpuModelIds)(
    "preserves the highest production data dword for %s",
    (cpuModel: CpuModel): void => {
      const hierarchy = new CpuMemoryHierarchy(cpuModel);
      const specification = cpuModelSpecification(cpuModel).microarchitecture;
      const cacheLineTransfers = specification.cacheLineBytes / bytesPerDword;

      expect(
        hierarchy.accessData(maximumProductionDataDwordAddress, "read"),
      ).toBe(
        cpuModel === "cs386sx"
          ? 0
          : cacheLineTransfers * specification.mainMemoryTransferCycles,
      );
      expect(
        hierarchy.accessData(maximumProductionDataDwordAddress, "write"),
      ).toBe(
        cpuModel === "cs386sx" ? 0 : specification.mainMemoryTransferCycles,
      );
      expect(hierarchy.stats).toEqual({
        busTransfers: cpuModel === "cs386sx" ? 4 : cacheLineTransfers + 1,
        instructionFetches: 0,
        l1Hits: cpuModel === "cs386sx" ? 0 : 1,
        l1Misses: cpuModel === "cs386sx" ? 0 : 1,
        l2Hits: 0,
        l2Misses: cpuModel === "cs486dx2" ? 1 : 0,
        pipelineFlushes: 0,
        unalignedAccesses: 0,
      });
    },
  );

  it.each(cpuModelIds)(
    "preserves the highest production data byte address for %s",
    (cpuModel: CpuModel): void => {
      const hierarchy = new CpuMemoryHierarchy(cpuModel);
      const specification = cpuModelSpecification(cpuModel).microarchitecture;
      const cacheLineTransfers = specification.cacheLineBytes / bytesPerDword;

      expect(
        hierarchy.accessData(maximumProductionDataByteAddress, "read"),
      ).toBe(
        cpuModel === "cs386sx"
          ? specification.mainMemoryTransferCycles
          : 1 + 2 * cacheLineTransfers * specification.mainMemoryTransferCycles,
      );
      expect(hierarchy.stats).toEqual({
        busTransfers: cpuModel === "cs386sx" ? 3 : cacheLineTransfers * 2,
        instructionFetches: 0,
        l1Hits: 0,
        l1Misses: cpuModel === "cs386sx" ? 0 : 2,
        l2Hits: 0,
        l2Misses: cpuModel === "cs486dx2" ? 2 : 0,
        pipelineFlushes: 0,
        unalignedAccesses: 1,
      });
    },
  );

  it.each(cpuModelIds)(
    "preserves exact cross-line read and write costs for %s",
    (cpuModel: CpuModel): void => {
      const hierarchy = new CpuMemoryHierarchy(cpuModel);
      const specification = cpuModelSpecification(cpuModel).microarchitecture;
      const cacheLineTransfers = specification.cacheLineBytes / bytesPerDword;
      const lineEnd = 1024 + specification.cacheLineBytes - 1;

      expect(hierarchy.accessData(lineEnd, "read")).toBe(
        cpuModel === "cs386sx"
          ? specification.mainMemoryTransferCycles
          : 1 + 2 * cacheLineTransfers * specification.mainMemoryTransferCycles,
      );
      expect(hierarchy.accessData(lineEnd, "read")).toBe(
        cpuModel === "cs386sx" ? specification.mainMemoryTransferCycles : 1,
      );
      expect(hierarchy.accessData(lineEnd, "write")).toBe(
        cpuModel === "cs386sx"
          ? specification.mainMemoryTransferCycles
          : 1 + 2 * specification.mainMemoryTransferCycles,
      );
      expect(hierarchy.stats).toEqual({
        busTransfers: cpuModel === "cs386sx" ? 9 : cacheLineTransfers * 2 + 2,
        instructionFetches: 0,
        l1Hits: cpuModel === "cs386sx" ? 0 : 4,
        l1Misses: cpuModel === "cs386sx" ? 0 : 2,
        l2Hits: 0,
        l2Misses: cpuModel === "cs486dx2" ? 2 : 0,
        pipelineFlushes: 0,
        unalignedAccesses: 3,
      });
    },
  );

  it("rejects invalid cache geometry before allocation", (): void => {
    expect(createCache(0, 16)).toBeUndefined();
    expect(createCache(64, 16)).toBeDefined();

    expect(() => createCache(8_192, 12)).toThrowError(RangeError);
    expect(() => createCache(8_192, 12)).toThrowError(/power of two/u);
    expect(() => createCache(8_192, 2)).toThrowError(/at least one dword/u);
    expect(() => createCache(-1, 16)).toThrowError(/non-negative integer/u);
    expect(() => createCache(32, 16)).toThrowError(
      /whole positive number of four-way sets/u,
    );
    expect(() => createCache(192, 16)).toThrowError(/cache set count/u);
  });

  it("charges unaligned 486 dwords and two cache lines when an access crosses one", (): void => {
    const aligned = run("load eax, [1024]\nhalt", "cs486dx");
    const unaligned = run("load eax, [1025]\nhalt", "cs486dx");
    const crossing = run("load eax, [1039]\nhalt", "cs486dx");

    expect(unaligned.cycles).toBe(aligned.cycles + 1);
    expect(unaligned.microarchitecture.unalignedAccesses).toBe(1);
    expect(crossing.microarchitecture.l1Misses).toBe(
      aligned.microarchitecture.l1Misses + 1,
    );
    expect(crossing.cycles).toBeGreaterThan(unaligned.cycles);
  });

  it("uses the DX2 external L2 after five lines evict one four-way L1 set", (): void => {
    const result = run(
      [1024, 3072, 5120, 7168, 9216, 1024]
        .map((address) => `load eax, [${String(address)}]`)
        .concat("halt")
        .join("\n"),
      "cs486dx2",
    );

    expect(result.microarchitecture.l2Misses).toBeGreaterThanOrEqual(5);
    expect(result.microarchitecture.l2Hits).toBeGreaterThanOrEqual(1);
  });

  it("starts every process with cold transient caches", (): void => {
    const source = "load eax, [1024]\nload ebx, [1024]\nhalt";
    const first = run(source, "cs486dx");
    const second = run(source, "cs486dx");

    expect(second.microarchitecture).toEqual(first.microarchitecture);
    expect(second.cycles).toBe(first.cycles);
  });

  it("counts taken control transfers without claiming branch prediction", (): void => {
    const notTaken = run(
      "mov eax, 0\ncmp eax, 1\nje done\ndone:\nhalt",
      "cs486dx",
    );
    const taken = run(
      "mov eax, 1\ncmp eax, 1\nje done\ndone:\nhalt",
      "cs486dx",
    );

    expect(taken.cycles - notTaken.cycles).toBe(2);
    expect(notTaken.microarchitecture.pipelineFlushes).toBe(0);
    expect(taken.microarchitecture.pipelineFlushes).toBe(1);
  });

  it.each(cpuModelIds)(
    "keeps guest timing and state exact when host statistics are disabled for %s",
    (cpuModel: CpuModel): void => {
      const executable = assembleCs486(
        [
          "mov eax, 0",
          "mov ebx, 64",
          "again:",
          "store [1025], eax",
          "load ecx, [1025]",
          "add eax, 1",
          "cmp eax, ebx",
          "jl again",
          "print eax",
          "halt",
        ].join("\n"),
      );
      const requirements = cs486ExecutableMemoryRequirements(executable);
      if (requirements.kind !== "declared") throw new Error("expected v3");
      const measured = new Cs486Process(executable, {
        collectMicroarchitectureStats: true,
        cpuModel,
        memoryBytes: requirements.linearAddressSpaceBytes,
      });
      const unmeasured = new Cs486Process(executable, {
        collectMicroarchitectureStats: false,
        cpuModel,
        memoryBytes: requirements.linearAddressSpaceBytes,
      });

      const measuredSlice = measured.runInstructionSlice(10_000);
      const unmeasuredSlice = unmeasured.runInstructionSlice(10_000);

      expect(unmeasuredSlice).toEqual(measuredSlice);
      expect(unmeasured.output).toBe(measured.output);
      expect(unmeasured.registers).toEqual(measured.registers);
      expect(unmeasured.instructionAddress).toBe(measured.instructionAddress);
      expect(measured.microarchitectureStatsEnabled).toBe(true);
      expect(
        measured.microarchitectureStats.instructionFetches,
      ).toBeGreaterThan(0);
      expect(unmeasured.microarchitectureStatsEnabled).toBe(false);
      expect(() => unmeasured.microarchitectureStats).toThrowError(
        /statistics collection is disabled/u,
      );
    },
  );

  it("rejects invalid statistics modes instead of silently changing observability", (): void => {
    expect(
      () =>
        new CpuMemoryHierarchy("cs486dx", {
          collectMicroarchitectureStats: "disabled",
        } as never),
    ).toThrowError(/must be a boolean/u);
  });

  it("keeps runCs486 instrumented by default and marks explicit opt-out unavailable", (): void => {
    const executable = assembleCs486("mov eax, 42\nprint eax\nhalt");
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared") throw new Error("expected v3");
    const options = {
      cpuModel: "cs486dx" as const,
      memoryBytes: requirements.linearAddressSpaceBytes,
    };

    const measured = runCs486(executable, options);
    const unmeasured = runCs486(executable, {
      ...options,
      collectMicroarchitectureStats: false,
    });

    expect(measured.microarchitecture.instructionFetches).toBe(3);
    expect(unmeasured.microarchitecture).toBeNull();
    expect({
      cycles: unmeasured.cycles,
      executedInstructions: unmeasured.executedInstructions,
      output: unmeasured.output,
      registers: unmeasured.registers,
      state: unmeasured.state,
    }).toEqual({
      cycles: measured.cycles,
      executedInstructions: measured.executedInstructions,
      output: measured.output,
      registers: measured.registers,
      state: measured.state,
    });
  });

  it("defines the intended cache, pipeline, and SIMM profiles", (): void => {
    expect(cpuModelSpecification("cs386sx").microarchitecture).toMatchObject({
      branchPrediction: "none",
      externalCacheBytes: 0,
      l1CacheBytes: 0,
      memoryModules: "2 x 1 MiB 30-pin SIMM DRAM",
      pipeline: "prefetch-overlap",
    });
    expect(cpuModelSpecification("cs486dx").microarchitecture).toMatchObject({
      externalCacheBytes: 0,
      l1CacheBytes: 8_192,
      pipeline: "five-stage",
    });
    expect(cpuModelSpecification("cs486dx2").microarchitecture).toMatchObject({
      externalCacheBytes: 262_144,
      l1CacheBytes: 8_192,
      memoryModules: "2 x 4 MiB 72-pin SIMM DRAM",
    });
  });
});

function run(
  source: string,
  cpuModel: "cs386sx" | "cs486dx" | "cs486dx2",
): Cs486RunResult {
  const executable = assembleCs486(source);
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared") throw new Error("expected v3");
  return runCs486(executable, {
    cpuModel,
    memoryBytes: requirements.linearAddressSpaceBytes,
  });
}

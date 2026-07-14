import { describe, expect, it } from "vitest";

import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import { runCs486, type Cs486RunResult } from "../../src/domain/cpu/cs486.js";
import { cpuModelSpecification } from "../../src/domain/cpu/models.js";

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
  return runCs486(assembleCs486(source), { cpuModel, memoryBytes: 65_536 });
}

import { describe, expect, it } from "vitest";
import {
  computeCs486WasmMemoryLayout,
  cs486WasmCacheGeometry,
  cs486WasmCacheStateBytes,
  cs486WasmExitBytes,
  cs486WasmOpcode,
  cs486WasmParamsBytes,
  cs486WasmRegisterCount,
  cs486WasmRequiredExports,
  cs486WasmStateBytes,
} from "../../tools/cs486-wasm-batch-executor-abi.js";

describe("cs486 wasm batch-executor ABI", () => {
  it("assigns a dense bijective opcode numbering across the full ISA", () => {
    const values = Object.values(cs486WasmOpcode);
    expect(values).toHaveLength(65);
    expect(new Set(values).size).toBe(65);
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(65);
  });

  it("derives cache geometry from the production CPU model catalog", () => {
    expect(cs486WasmCacheGeometry("cs386sx")).toEqual({
      cacheLineShift: 4,
      l1SetCount: 0,
      l2SetCount: 0,
      mainMemoryTransferCycles: 2,
    });
    expect(cs486WasmCacheGeometry("cs486dx")).toEqual({
      cacheLineShift: 4,
      l1SetCount: 128,
      l2SetCount: 0,
      mainMemoryTransferCycles: 3,
    });
    expect(cs486WasmCacheGeometry("cs486dx2")).toEqual({
      cacheLineShift: 4,
      l1SetCount: 128,
      l2SetCount: 4_096,
      mainMemoryTransferCycles: 6,
    });
  });

  it("sizes internal cache state per model with 16-byte padded levels", () => {
    expect(cs486WasmCacheStateBytes(cs486WasmCacheGeometry("cs386sx"))).toBe(
      32,
    );
    expect(cs486WasmCacheStateBytes(cs486WasmCacheGeometry("cs486dx"))).toBe(
      32 + (2_048 + 2_048 + 512),
    );
    expect(cs486WasmCacheStateBytes(cs486WasmCacheGeometry("cs486dx2"))).toBe(
      32 + (2_048 + 2_048 + 512) + (65_536 + 65_536 + 16_384),
    );
  });

  it("lays out ordered non-overlapping 16-byte-aligned regions", () => {
    const geometry = cs486WasmCacheGeometry("cs486dx2");
    const layout = computeCs486WasmMemoryLayout(1_000, 3, 65_536, geometry);
    expect(layout.paramsBase).toBe(1_008);
    expect(layout.cacheBytes).toBe(cs486WasmCacheStateBytes(geometry));
    const orderedRegions: readonly (readonly [number, number])[] = [
      [layout.paramsBase, cs486WasmParamsBytes],
      [layout.stateBase, cs486WasmStateBytes],
      [layout.exitBase, cs486WasmExitBytes],
      [layout.registersBase, cs486WasmRegisterCount * 4],
      [layout.opcodesBase, 3],
      [layout.flagsBase, 3],
      [layout.branchDeltaBase, 3],
      [layout.baseCyclesBase, 3 * 4],
      [layout.operandABase, 3 * 4],
      [layout.operandBBase, 3 * 4],
      [layout.cacheBase, layout.cacheBytes],
      [layout.ramBase, 65_536],
    ];
    let previousEnd = 0;
    for (const [base, bytes] of orderedRegions) {
      expect(base % 16).toBe(0);
      expect(base).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = base + bytes;
    }
    expect(layout.totalBytes % 16).toBe(0);
    expect(layout.totalBytes).toBeGreaterThanOrEqual(previousEnd);
  });

  it("supports empty executables without collapsing regions", () => {
    const geometry = cs486WasmCacheGeometry("cs386sx");
    const layout = computeCs486WasmMemoryLayout(0, 0, 65_536, geometry);
    expect(layout.paramsBase).toBe(0);
    expect(layout.ramBase).toBeGreaterThan(layout.cacheBase);
    expect(layout.totalBytes).toBe(layout.ramBase + 65_536);
  });

  it("rejects invalid layout inputs explicitly", () => {
    const geometry = cs486WasmCacheGeometry("cs486dx");
    expect(() => computeCs486WasmMemoryLayout(-1, 0, 65_536, geometry)).toThrow(
      RangeError,
    );
    expect(() => computeCs486WasmMemoryLayout(0, -1, 65_536, geometry)).toThrow(
      RangeError,
    );
    expect(() => computeCs486WasmMemoryLayout(0, 0, 0, geometry)).toThrow(
      RangeError,
    );
  });

  it("pins the required wasm export surface", () => {
    expect([...cs486WasmRequiredExports]).toEqual([
      "memory",
      "configure",
      "run_cpu_slice",
      "run_instruction_slice",
      "access_data",
      "fetch_instruction",
      "record_control_transfer",
    ]);
  });
});

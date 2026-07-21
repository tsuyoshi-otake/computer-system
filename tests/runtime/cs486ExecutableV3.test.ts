import { describe, expect, it } from "vitest";

import {
  assembleCs486,
  assembleCs486Object,
} from "../../src/application/toolchain/cs486Assembler.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  createCs486Flat32MemoryMetadata,
  Cs486Process,
  defaultCs486StackBytes,
  maximumCs486AuxiliaryResidentBytes,
  maximumCs486LinearAddressSpaceBytes,
  validateCs486Executable,
} from "../../src/domain/cpu/cs486.js";

describe("CS486 structured executable flat-memory metadata", (): void => {
  it("writes v4 objects and v5 executable data-model metadata", (): void => {
    const standalone = assembleCs486("halt");
    const object = assembleCs486Object("global main\nmain:\nhalt");
    const linked = linkCs486Objects([object]);

    expect(object).toMatchObject({
      dataModel: "cs-word32-v1",
      version: 4,
    });
    expect(standalone).toMatchObject({
      memory: {
        auxiliaryResidentBytes: 0,
        heapBytes: 0,
        model: "cs-flat32-v1",
        stackBytes: defaultCs486StackBytes,
      },
      dataModel: "cs-word32-v1",
      version: 5,
    });
    expect(linked).toMatchObject({ dataModel: "cs-word32-v1", version: 5 });
    expect(Object.isFrozen(standalone.memory)).toBe(true);
    expect(cs486ExecutableMemoryRequirements(standalone)).toEqual({
      alignedDataBytes: 0,
      auxiliaryResidentBytes: 0,
      heapBytes: 0,
      kind: "declared",
      linearAddressSpaceBytes: 65_536,
      model: "cs-flat32-v1",
      physicalReservationBytes: 65_536,
      stackBytes: 65_536,
      version: 5,
    });
  });

  it("marks readable v1 and v2 executables as legacy", (): void => {
    for (const version of [1, 2] as const) {
      const executable = {
        format: "cs486-executable",
        instructions: [{ op: "halt" }],
        version,
      };
      validateCs486Executable(executable);
      expect(cs486ExecutableMemoryRequirements(executable)).toEqual({
        kind: "legacy",
        version,
      });
    }
    const typedV2 = {
      format: "cs486-executable",
      instructions: [{ op: "halt" }],
      symbols: [
        {
          address: 0,
          functionSignature: "()->i32",
          name: "main",
          section: "text",
          type: "function",
        },
      ],
      version: 2,
    };
    validateCs486Executable(typedV2);
    expect(cs486ExecutableMemoryRequirements(typedV2)).toEqual({
      kind: "legacy",
      version: 2,
    });
  });

  it("accepts bounded v3 argument signatures but keeps v2 zero-argument-only", (): void => {
    const executable = assembleCs486(
      "global main\ntype main, function\nsignature main, i32, i32\nmain:\nret",
    );
    expect(() => validateCs486Executable(executable)).not.toThrow();
    expect(executable.symbols).toContainEqual(
      expect.objectContaining({ functionSignature: "(i32)->i32" }),
    );
    expect(() =>
      validateCs486Executable({
        dataBytes: 0,
        format: "cs486-executable",
        instructions: [{ op: "ret" }],
        symbols: [
          {
            address: 0,
            functionSignature: "(i32)->i32",
            name: "main",
            type: "function",
          },
        ],
        version: 2,
      }),
    ).toThrow(/symbol table/u);
  });

  it("rejects malformed, unaligned, excessive, and cross-version metadata", (): void => {
    const valid = assembleCs486("halt");
    const malformed: readonly unknown[] = [
      { ...valid, memory: undefined },
      { ...valid, memory: { ...valid.memory, model: "native-x86" } },
      { ...valid, memory: { ...valid.memory, stackBytes: 0 } },
      { ...valid, memory: { ...valid.memory, stackBytes: 65_535 } },
      { ...valid, memory: { ...valid.memory, heapBytes: 2 } },
      { ...valid, memory: { ...valid.memory, heapBytes: 1.5 } },
      {
        ...valid,
        memory: { ...valid.memory, stackBytes: Number.MAX_SAFE_INTEGER },
      },
      {
        ...valid,
        memory: {
          ...valid.memory,
          auxiliaryResidentBytes: Number.MAX_SAFE_INTEGER + 1,
        },
      },
      {
        ...valid,
        dataBytes: maximumCs486LinearAddressSpaceBytes,
      },
      { ...valid, version: 2 },
    ];

    for (const executable of malformed) {
      const before = JSON.parse(JSON.stringify(executable)) as unknown;
      expect(() => validateCs486Executable(executable)).toThrow(
        /memory|stack|heap|address-space|auxiliary|resident|legacy/u,
      );
      expect(executable).toEqual(before);
    }
  });

  it("derives checked linear and physical reservations and enforces the grant", (): void => {
    const { dataModel, ...legacy } = assembleCs486("halt");
    expect(dataModel).toBe("cs-word32-v1");
    const executable = {
      ...legacy,
      dataBytes: 1,
      memory: createCs486Flat32MemoryMetadata({
        auxiliaryResidentBytes: 1_024,
        heapBytes: 4,
      }),
      version: 3 as const,
    };
    const requirements = cs486ExecutableMemoryRequirements(executable);
    expect(requirements).toMatchObject({
      alignedDataBytes: 4,
      auxiliaryResidentBytes: 1_024,
      heapBytes: 4,
      kind: "declared",
      linearAddressSpaceBytes: 65_544,
      physicalReservationBytes: 66_568,
      stackBytes: 65_536,
    });
    if (requirements.kind !== "declared") throw new Error("expected v3");

    expect(
      () =>
        new Cs486Process(executable, {
          memoryBytes: requirements.linearAddressSpaceBytes - 1,
        }),
    ).toThrow(/linear memory requirement exceeds available RAM/u);
    const exact = new Cs486Process(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });
    const oversized = new Cs486Process(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes + 4_096,
    });
    expect(exact.memoryLimitBytes).toBe(requirements.linearAddressSpaceBytes);
    expect(oversized.memoryLimitBytes).toBe(
      requirements.linearAddressSpaceBytes,
    );
    expect(Number.isSafeInteger(requirements.physicalReservationBytes)).toBe(
      true,
    );

    const maximum = cs486ExecutableMemoryRequirements({
      ...legacy,
      memory: createCs486Flat32MemoryMetadata({
        auxiliaryResidentBytes: maximumCs486AuxiliaryResidentBytes,
        heapBytes: maximumCs486LinearAddressSpaceBytes - defaultCs486StackBytes,
      }),
      version: 3,
    });
    expect(maximum).toMatchObject({
      kind: "declared",
      linearAddressSpaceBytes: maximumCs486LinearAddressSpaceBytes,
      physicalReservationBytes:
        maximumCs486LinearAddressSpaceBytes +
        maximumCs486AuxiliaryResidentBytes,
    });
  });
});

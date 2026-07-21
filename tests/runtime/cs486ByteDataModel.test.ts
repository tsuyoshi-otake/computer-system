import { describe, expect, it } from "vitest";

import {
  createCs486Archive,
  validateCs486Archive,
} from "../../src/application/toolchain/cs486Archive.js";
import {
  assembleCs486,
  assembleCs486Object,
} from "../../src/application/toolchain/cs486Assembler.js";
import { Cs486Debugger } from "../../src/application/toolchain/cs486Debugger.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import { compileCs486Source } from "../../src/application/toolchain/highLevelCompilers.js";
import {
  Cs486Process,
  cs486ExecutableMemoryRequirements,
  runCs486,
  validateCs486Executable,
} from "../../src/domain/cpu/cs486.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
  legacyCs486WordDataModel,
} from "../../src/domain/cpu/cs486Compatibility.js";
import { validateCs486Object } from "../../src/domain/cpu/cs486Object.js";
import { instructionCycleCost } from "../../src/domain/cpu/instructionTiming.js";
import { sha256Hex } from "../../src/domain/crypto/sha256.js";

const cpuModels = ["cs386sx", "cs486dx", "cs486dx2"] as const;

describe("CS486 versioned byte data model", (): void => {
  it.each(cpuModels)(
    "round-trips every byte value through narrow memory on %s",
    (cpuModel): void => {
      const stores = Array.from(
        { length: 256 },
        (_, value) =>
          `mov eax, ${String(value)}\nstore8 [${String(value)}], eax`,
      );
      const executable = assembleCs486([...stores, "halt"].join("\n"), {
        dataModel: cs486Byte8DataModel,
      });
      const requirements = cs486ExecutableMemoryRequirements(executable);
      if (requirements.kind !== "declared")
        throw new Error("expected declared memory");
      const process = new Cs486Process(executable, {
        cpuModel,
        memoryBytes: requirements.linearAddressSpaceBytes,
      });

      process.runCpuSlice(1_000_000, 10_000);

      expect(process.state.kind).toBe("completed");
      expect([...process.inspectMemory(0, 256)]).toEqual(
        Array.from({ length: 256 }, (_, value) => value),
      );
      expect(process.microarchitectureStats.instructionFetches).toBe(513);
    },
  );

  it("assigns deterministic narrow instruction costs to each CPU profile", (): void => {
    const address = { kind: "immediate", value: 0 } as const;
    const load8 = { address, destination: "eax", op: "load8u" } as const;
    const load16 = { address, destination: "eax", op: "load16s" } as const;
    const store8 = { address, op: "store8", source: "eax" } as const;
    const store16 = { address, op: "store16", source: "eax" } as const;

    expect(instructionCycleCost("cs386sx", load8)).toBe(4);
    expect(instructionCycleCost("cs386sx", load16)).toBe(4);
    expect(instructionCycleCost("cs386sx", store8)).toBe(3);
    expect(instructionCycleCost("cs386sx", store16)).toBe(3);
    for (const model of ["cs486dx", "cs486dx2"] as const) {
      expect(instructionCycleCost(model, load8)).toBe(2);
      expect(instructionCycleCost(model, load16)).toBe(2);
      expect(instructionCycleCost(model, store8)).toBe(2);
      expect(instructionCycleCost(model, store16)).toBe(2);
    }
  });

  it.each(cpuModels)(
    "sign-extends and zero-extends byte/halfword loads on %s",
    (cpuModel): void => {
      const result = runCs486(
        assembleCs486(
          [
            "mov eax, 255",
            "store8 [4], eax",
            "load8s ebx, [4]",
            "load8u ecx, [4]",
            "mov eax, 65535",
            "store16 [6], eax",
            "load16s edx, [6]",
            "load16u esi, [6]",
            "halt",
          ].join("\n"),
          { dataModel: cs486Byte8DataModel },
        ),
        { cpuModel, memoryBytes: 131_072 },
      );

      expect(result.registers).toMatchObject({
        ebx: -1,
        ecx: 255,
        edx: -1,
        esi: 65_535,
      });
      expect(result.cycles).toBeGreaterThan(result.executedInstructions);
    },
  );

  it("rejects unaligned halfwords, out-of-range bytes, and narrow legacy images", (): void => {
    expect(() =>
      runCs486(
        assembleCs486("load16u eax, [1]\nhalt", {
          dataModel: cs486Byte8DataModel,
        }),
        { memoryBytes: 131_072 },
      ),
    ).toThrow(/not aligned to 2 bytes/u);
    expect(() =>
      runCs486(
        assembleCs486("mov ecx, 70000\nload8u eax, [ecx]\nhalt", {
          dataModel: cs486Byte8DataModel,
        }),
        { memoryBytes: 131_072 },
      ),
    ).toThrow(/outside RAM/u);

    const current = assembleCs486("load8u eax, [0]\nhalt", {
      dataModel: cs486Byte8DataModel,
    });
    const { dataModel: executableModel, ...legacyExecutable } = current;
    expect(executableModel).toBe(cs486Byte8DataModel);
    expect(() =>
      validateCs486Executable({ ...legacyExecutable, version: 4 }),
    ).toThrow(/invalid load8u instruction/u);

    const currentObject = assembleCs486Object("load8u eax, [0]\nhalt", {
      dataModel: cs486Byte8DataModel,
    });
    const { dataModel: objectModel, ...legacyObject } = currentObject;
    expect(objectModel).toBe(cs486Byte8DataModel);
    expect(() => validateCs486Object({ ...legacyObject, version: 3 })).toThrow(
      /invalid CS486 text section/u,
    );
  });

  it("faults rejected narrow stores before mutating any addressed byte", (): void => {
    const unaligned = assembleCs486(
      [
        "mov eax, 17",
        "store8 [1], eax",
        "mov eax, 34",
        "store8 [2], eax",
        "mov eax, 65535",
        "store16 [1], eax",
        "halt",
      ].join("\n"),
      { dataModel: cs486Byte8DataModel },
    );
    const unalignedProcess = new Cs486Process(unaligned, {
      memoryBytes: 131_072,
    });
    const unalignedResult = unalignedProcess.runCpuSlice(1_000_000, 100);
    expect(unalignedResult.state.kind).toBe("crashed");
    expect([...unalignedProcess.inspectMemory(1, 2)]).toEqual([17, 34]);

    const outside = assembleCs486(
      [
        "mov eax, 51",
        "store8 [0], eax",
        "mov ecx, 131072",
        "store8 [ecx], eax",
        "halt",
      ].join("\n"),
      { dataModel: cs486Byte8DataModel },
    );
    const outsideProcess = new Cs486Process(outside, {
      memoryBytes: 131_072,
    });
    const outsideResult = outsideProcess.runCpuSlice(1_000_000, 100);
    expect(outsideResult.state.kind).toBe("crashed");
    expect([...outsideProcess.inspectMemory(0, 1)]).toEqual([51]);
  });

  it("carries identity through object, archive, linker, and debugger surfaces", (): void => {
    const byteObject = assembleCs486Object(
      "global main\ntype main, function\nsignature main, i32\nmain:\nmov eax, 0\nret",
      { dataModel: cs486Byte8DataModel, language: "c" },
    );
    const archive = createCs486Archive([
      { name: "main.o", object: byteObject },
    ]);
    const executable = linkCs486Objects([byteObject]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("expected declared memory");

    expect(byteObject).toMatchObject({
      dataModel: cs486Byte8DataModel,
      version: 4,
    });
    expect(archive).toMatchObject({
      dataModel: cs486Byte8DataModel,
      objectVersions: [4],
      version: 2,
    });
    expect(executable).toMatchObject({
      dataModel: cs486Byte8DataModel,
      version: 5,
    });
    expect(
      Cs486Debugger.load(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).disassemble(0, 1),
    ).toEqual([expect.objectContaining({ text: "call 2" })]);
  });

  it("reads legacy word archives and rejects mixed models before linking", (): void => {
    const payload = {
      abi: "cs486-cc2" as const,
      dataModel: legacyCs486WordDataModel,
      format: "cs486-archive" as const,
      members: [],
      objectFormat: "CS486OBJ" as const,
      objectVersions: [1, 2, 3] as const,
      symbols: [],
      version: 1 as const,
    };
    expect(() =>
      validateCs486Archive({
        ...payload,
        checksum: sha256Hex(JSON.stringify(payload)),
      }),
    ).not.toThrow();

    const word = assembleCs486Object("global main\nmain:\nmov eax, 0\nret", {
      dataModel: cs486Word32DataModel,
    });
    const byte = assembleCs486Object("global helper\nhelper:\nret", {
      dataModel: cs486Byte8DataModel,
    });
    const before = JSON.stringify([word, byte]);

    expect(() => linkCs486Objects([word, byte])).toThrow(
      /mixed CS486 data models/u,
    );
    expect(() =>
      createCs486Archive([
        { name: "word.o", object: word },
        { name: "byte.o", object: byte },
      ]),
    ).toThrow(/mixed CS486 data models/u);
    expect(JSON.stringify([word, byte])).toBe(before);
  });

  it("uses byte-profile scalar, array, pointer, and padded-record layout", (): void => {
    const source = [
      "struct record { char tag; int value; unsigned short code; };",
      "int main(void) {",
      "  unsigned char bytes[3] = { 1, 255, 3 };",
      "  struct record item = { 7, 40, 500 };",
      "  unsigned char *cursor = bytes;",
      "  cursor[2] = cursor[0] + 8;",
      "  return sizeof(char) + sizeof(int) + sizeof(unsigned short)",
      "       + sizeof(bytes) + sizeof(struct record)",
      "       + item.tag + item.value + item.code + cursor[1] + cursor[2];",
      "}",
    ].join("\n");
    const executable = compileCs486Source("c", source, {
      dataModel: cs486Byte8DataModel,
    });
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("expected declared memory");
    const result = runCs486(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });

    expect(executable).toMatchObject({
      dataModel: cs486Byte8DataModel,
      version: 5,
    });
    expect(result.registers.eax).toBe(833);
    expect(executable.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "load8s" }),
        expect.objectContaining({ op: "load16u" }),
        expect.objectContaining({ op: "store8" }),
        expect.objectContaining({ op: "store16" }),
      ]),
    );
  });

  it("keeps the word profile layout and CHAR address stride unchanged", (): void => {
    const executable = compileCs486Source(
      "c",
      "int main(void) { char text[3] = { 4, 5, 6 }; return sizeof(int) + sizeof(text) + text[1]; }",
      { dataModel: cs486Word32DataModel },
    );
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("expected declared memory");
    const result = runCs486(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });

    expect(result.registers.eax).toBe(9);
    expect(executable.instructions.some(({ op }) => op === "load8s")).toBe(
      false,
    );
  });

  it("uses little-endian unions, integer promotion, truncation, strings, and callbacks", (): void => {
    const executable = compileCs486Source(
      "c",
      [
        "union packet { unsigned int word; unsigned char bytes[4]; };",
        "int add_one(int value) { return value + 1; }",
        "int main(void) {",
        "  union packet packet;",
        "  unsigned char wrapped = 250;",
        "  signed char negative = 255;",
        "  short negative_short = 65535;",
        '  char text[3] = "ab";',
        "  int (*callback)(int) = add_one;",
        "  packet.word = 67305985U;",
        "  wrapped = wrapped + 10;",
        "  if (sizeof(union packet) != 4 || packet.bytes[0] != 1 || packet.bytes[3] != 4) return 1;",
        "  if (wrapped != 4) return 2;",
        "  if (negative != -1 || negative_short != -1) return 3;",
        "  if (text[0] != 97) return 4;",
        "  if (text[1] != 98) return 5;",
        "  if (text[2] != 0) return 6;",
        "  return callback(41) == 42 ? 0 : 7;",
        "}",
      ].join("\n"),
      { dataModel: cs486Byte8DataModel },
    );
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("expected declared memory");

    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(0);
  });
});

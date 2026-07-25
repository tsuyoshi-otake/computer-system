import { describe, expect, it } from "vitest";

import { Cs486Fault } from "../../src/domain/cpu/cs486.js";
import type {
  Cs486Register,
  Cs486SyscallContext,
  Cs486SyscallResult,
} from "../../src/domain/cpu/cs486.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
  type Cs486DataModel,
} from "../../src/domain/cpu/cs486Compatibility.js";
import {
  createCsAbiBatchSyscallHandler,
  csAbiErrno,
  csAbiLimits,
  csAbiSelectors,
  isCsAbiBatchSyscallHandler,
  type CsAbiBatchHeapLayout,
} from "../../src/application/runtime/csAbi.js";

const layout: CsAbiBatchHeapLayout = Object.freeze({
  heapBaseBytes: 0x2_00_00,
  heapWords: 512,
  startupAddress: 0x1_00_00,
});

interface FakeContext extends Cs486SyscallContext {
  readonly registers: Map<Cs486Register, number>;
  readonly words: Map<number, number>;
  readonly bytes: Map<number, number>;
}

function createContext(
  registers: Partial<Record<Cs486Register, number>>,
  dataModel: Cs486DataModel = cs486Word32DataModel,
): FakeContext {
  const registerValues = new Map<Cs486Register, number>(
    Object.entries(registers) as readonly (readonly [Cs486Register, number])[],
  );
  const words = new Map<number, number>();
  const bytes = new Map<number, number>();
  return {
    bytes,
    dataModel,
    memoryLimitBytes: 1 << 20,
    readInt32: (address: number): number => words.get(address) ?? 0,
    readRegister: (register: Cs486Register): number =>
      registerValues.get(register) ?? 0,
    readUint8: (address: number): number => bytes.get(address) ?? 0,
    registers: registerValues,
    words,
    writeInt32: (address: number, value: number): void => {
      words.set(address, value | 0);
    },
    writeRegister: (register: Cs486Register, value: number): void => {
      registerValues.set(register, value | 0);
    },
    writeUint8: (address: number, value: number): void => {
      bytes.set(address, value & 0xff);
    },
  };
}

function createHandler(): {
  readonly invoke: (
    name: string,
    context: Cs486SyscallContext,
  ) => Cs486SyscallResult;
  readonly output: () => string;
} {
  let output = "";
  const handler = createCsAbiBatchSyscallHandler(layout, (text) => {
    output += text;
  });
  return { invoke: handler, output: (): string => output };
}

function writeWords(context: FakeContext, pointer: number, text: string): void {
  let index = 0;
  for (const character of text) {
    context.words.set(pointer + index * 4, character.codePointAt(0)!);
    index += 1;
  }
}

function captureFault(run: () => void): Cs486Fault {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof Cs486Fault) return error;
    throw error;
  }
  throw new Error("expected the batch policy to reject the operation");
}

describe("isolated batch CS ABI handler", () => {
  it("is tagged so an ownership boundary can recognize the isolated policy", () => {
    const { invoke } = createHandler();
    expect(isCsAbiBatchSyscallHandler(invoke)).toBe(true);
    expect(isCsAbiBatchSyscallHandler(undefined)).toBe(false);
    expect(
      isCsAbiBatchSyscallHandler((): Cs486SyscallResult => ({
        kind: "continue",
      })),
    ).toBe(false);
  });

  it("completes with the normalized exit status", () => {
    const { invoke } = createHandler();
    expect(
      invoke("cs", createContext({ ebx: csAbiSelectors.exit, ecx: 42 })),
    ).toEqual({ kind: "complete", value: 42 });
    expect(
      invoke("cs", createContext({ ebx: csAbiSelectors.exit, ecx: 300 })),
    ).toEqual({ kind: "complete", value: 44 });
    expect(
      invoke("cs", createContext({ ebx: csAbiSelectors.exit, ecx: -1 })),
    ).toEqual({ kind: "complete", value: 255 });
  });

  it("reports the create-time heap placement without touching a host service", () => {
    const { invoke } = createHandler();
    const context = createContext({
      ebx: csAbiSelectors.heapInfo,
      ecx: 0x40,
      edx: 0x80,
    });
    expect(invoke("cs", context)).toEqual({ kind: "continue" });
    expect(context.words.get(0x40)).toBe(layout.heapWords);
    expect(context.words.get(0x80)).toBe(layout.startupAddress);
    expect(context.registers.get("eax")).toBe(layout.heapBaseBytes);
    expect(context.registers.get("edx")).toBe(layout.heapWords);
    expect(context.registers.get("esi")).toBe(layout.startupAddress);
  });

  it("keeps fd 1 and fd 2 in one ordered stream", () => {
    const { invoke, output } = createHandler();
    const first = createContext({
      ebx: csAbiSelectors.fsWrite,
      ecx: 1,
      edx: 0x100,
      esi: 2,
    });
    writeWords(first, 0x100, "ok");
    expect(invoke("cs", first)).toEqual({ kind: "continue" });
    expect(first.registers.get("eax")).toBe(2);
    const second = createContext({
      ebx: csAbiSelectors.fsWrite,
      ecx: 2,
      edx: 0x100,
      esi: 3,
    });
    writeWords(second, 0x100, "bad");
    expect(invoke("cs", second)).toEqual({ kind: "continue" });
    const third = createContext({
      ebx: csAbiSelectors.fsWrite,
      ecx: 1,
      edx: 0x100,
      esi: 1,
    });
    writeWords(third, 0x100, "!");
    invoke("cs", third);
    expect(output()).toBe("okbad!");
  });

  it("writes byte-profile output through the shared data-model reader", () => {
    const { invoke, output } = createHandler();
    const context = createContext(
      { ebx: csAbiSelectors.fsWrite, ecx: 1, edx: 0x200, esi: 2 },
      cs486Byte8DataModel,
    );
    context.bytes.set(0x200, 0x68);
    context.bytes.set(0x201, 0x69);
    expect(invoke("cs", context)).toEqual({ kind: "continue" });
    expect(output()).toBe("hi");
  });

  it("rejects a malformed code point with EINVAL and writes nothing", () => {
    const { invoke, output } = createHandler();
    const context = createContext({
      ebx: csAbiSelectors.fsWrite,
      ecx: 1,
      edx: 0x100,
      esi: 2,
    });
    context.words.set(0x100, 0x41);
    context.words.set(0x104, 0xd8_00);
    expect(invoke("cs", context)).toEqual({ kind: "continue" });
    expect(context.registers.get("eax")).toBe(-csAbiErrno.einval);
    expect(output()).toBe("");
  });

  it("rejects the write that would exceed the shared output limit", () => {
    const { invoke, output } = createHandler();
    const chunk = csAbiLimits.ioWords;
    const admitted = Math.floor(csAbiLimits.outputWords / chunk);
    for (let write = 0; write < admitted; write += 1) {
      const context = createContext({
        ebx: csAbiSelectors.fsWrite,
        ecx: 1,
        edx: 0x100,
        esi: chunk,
      });
      writeWords(context, 0x100, "a".repeat(chunk));
      invoke("cs", context);
    }
    const remaining = csAbiLimits.outputWords - admitted * chunk;
    const overflow = createContext({
      ebx: csAbiSelectors.fsWrite,
      ecx: 1,
      edx: 0x100,
      esi: remaining + 1,
    });
    writeWords(overflow, 0x100, "b".repeat(remaining + 1));
    expect(invoke("cs", overflow)).toEqual({ kind: "continue" });
    expect(overflow.registers.get("eax")).toBe(-csAbiErrno.enospc);
    expect(output().length).toBe(admitted * chunk);
    const exact = createContext({
      ebx: csAbiSelectors.fsWrite,
      ecx: 1,
      edx: 0x100,
      esi: remaining,
    });
    writeWords(exact, 0x100, "c".repeat(remaining));
    invoke("cs", exact);
    expect(exact.registers.get("eax")).toBe(remaining);
    expect(output().length).toBe(csAbiLimits.outputWords);
  });

  it("rejects an I/O count above the shared limit with EINVAL", () => {
    const { invoke } = createHandler();
    const context = createContext({
      ebx: csAbiSelectors.fsWrite,
      ecx: 1,
      edx: 0x100,
      esi: csAbiLimits.ioWords + 1,
    });
    expect(invoke("cs", context)).toEqual({ kind: "continue" });
    expect(context.registers.get("eax")).toBe(-csAbiErrno.einval);
  });

  it("rejects a descriptor the batch policy cannot own", () => {
    const { invoke, output } = createHandler();
    const context = createContext({
      ebx: csAbiSelectors.fsWrite,
      ecx: 3,
      edx: 0x100,
      esi: 1,
    });
    writeWords(context, 0x100, "x");
    const fault = captureFault(() => invoke("cs", context));
    expect(fault.typeName).toBe("UnsupportedOperationError");
    expect(fault.message).toBe(
      "batch process cannot use file descriptor 3; re-run this program without batch mode",
    );
    expect(output()).toBe("");
  });

  it("rejects every operation that would need an OS service", () => {
    const serviced = new Set<number>([
      csAbiSelectors.exit,
      csAbiSelectors.heapInfo,
      csAbiSelectors.fsWrite,
    ]);
    const { invoke } = createHandler();
    for (const [name, selector] of Object.entries(csAbiSelectors)) {
      if (serviced.has(selector)) continue;
      const fault = captureFault(() =>
        invoke("cs", createContext({ ebx: selector })),
      );
      expect(fault.typeName, name).toBe("UnsupportedOperationError");
      expect(fault.message, name).toBe(
        `batch process cannot use CS ABI operation ${String(selector)}; re-run this program without batch mode`,
      );
    }
    const unknown = captureFault(() =>
      invoke("cs", createContext({ ebx: 4_096 })),
    );
    expect(unknown.typeName).toBe("UnsupportedOperationError");
  });

  it("refuses a syscall outside the CS ABI name", () => {
    const { invoke } = createHandler();
    const context = createContext({ ebx: csAbiSelectors.exit });
    expect(invoke("cs.print.character", context)).toEqual({ kind: "continue" });
    expect(context.registers.get("eax")).toBe(-csAbiErrno.eperm);
  });
});

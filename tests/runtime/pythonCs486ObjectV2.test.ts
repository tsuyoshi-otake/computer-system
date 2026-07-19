import { describe, expect, it } from "vitest";

import { createPythonCs486Program } from "../../src/application/runtime/pythonCs486.js";
import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { assembleCs486Object } from "../../src/application/toolchain/cs486Assembler.js";
import type { Cs486Object } from "../../src/domain/cpu/cs486Object.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

describe("Python CS486OBJ v2 extensions", (): void => {
  it("relocates initialized data for each appended extension", (): void => {
    const filesystem = extensionFilesystem({
      first: dataBackedFunctionObject(11),
      second: dataBackedFunctionObject(42),
    });
    const program = createProgram(
      filesystem,
      "import first\nimport second\nresult = [first.read(), second.read()]\n",
    );

    run(program.process);

    expect(program.process.state.kind).toBe("completed");
    expect(program.runtime.globals.get("result")).toEqual({
      kind: "list",
      values: [11, 42],
    });
    expect(program.executable).toMatchObject({
      memory: {
        auxiliaryResidentBytes: 1_048_576,
        model: "cs-flat32-v1",
      },
      version: 3,
    });
    expect(program.executable.initialData).toEqual([
      { bytes: [11, 0, 0, 0], offset: 0 },
      { bytes: [42, 0, 0, 0], offset: 4 },
    ]);
  });

  it("preserves each extension object's static-section alignment", (): void => {
    const aligned = assembleCs486Object(
      [
        "section .data",
        "align 16",
        "global value",
        "value: dd 42",
        "section .text",
        "global read",
        "type read, function",
        "read:",
        "load eax, [value]",
        "ret",
      ].join("\n"),
    );
    const filesystem = extensionFilesystem({
      first: dataBackedFunctionObject(11),
      aligned,
    });
    const program = createProgram(
      filesystem,
      "import first\nimport aligned\nresult = [first.read(), aligned.read()]\n",
    );

    run(program.process);

    expect(program.runtime.globals.get("result")).toEqual({
      kind: "list",
      values: [11, 42],
    });
    expect(program.executable.initialData).toEqual([
      { bytes: [11, 0, 0, 0], offset: 0 },
      { bytes: [42, 0, 0, 0], offset: 16 },
    ]);
  });

  it("does not expose global data symbols as Python functions", (): void => {
    const object = assembleCs486Object(
      ["section .data", "global value", "value: dd 42"].join("\n"),
    );
    const filesystem = extensionFilesystem({ values: object });

    expect(() => createProgram(filesystem, "import values\n")).toThrow(
      /exports no functions/u,
    );
  });

  it("does not expose a known void function through the integer extension ABI", (): void => {
    const object = assembleCs486Object(
      [
        "section .text",
        "global notify",
        "type notify, function",
        "signature notify, void",
        "notify:",
        "ret",
      ].join("\n"),
    );
    const filesystem = extensionFilesystem({ notifier: object });

    expect(() => createProgram(filesystem, "import notifier\n")).toThrow(
      /exports no zero-argument integer functions/u,
    );
  });

  it("validates decoded object metadata before linking", (): void => {
    const valid = dataBackedFunctionObject(42);
    const filesystem = extensionFilesystem({
      broken: { ...valid, dataBytes: valid.dataBytes + 1 },
    });

    expect(() => createProgram(filesystem, "import broken\n")).toThrow(
      /contains invalid object data/u,
    );
  });

  it("continues to import legacy v1 text-only objects", (): void => {
    const legacy: Cs486Object = {
      assembly: "answer:\nmov eax, 42\nret",
      dataBytes: 0,
      format: "cs486-object",
      language: "c",
      relocations: [],
      symbols: [
        {
          binding: "global",
          name: "answer",
          offset: 0,
          section: "text",
        },
      ],
      version: 1,
    };
    const filesystem = extensionFilesystem({ legacy });
    const program = createProgram(
      filesystem,
      "import legacy\nresult = legacy.answer()\n",
    );

    run(program.process);

    expect(program.process.state.kind).toBe("completed");
    expect(program.runtime.globals.get("result")).toBe(42);
  });
});

function dataBackedFunctionObject(value: number): Cs486Object {
  return assembleCs486Object(
    [
      "section .data",
      "global value",
      "value: dd " + String(value),
      "section .text",
      "global read",
      "type read, function",
      "read:",
      "load eax, [value]",
      "ret",
    ].join("\n"),
  );
}

function extensionFilesystem(
  objects: Readonly<Record<string, Cs486Object>>,
): InMemoryFilesystem {
  const filesystem = new InMemoryFilesystem();
  filesystem.makeDirectory("/lib/python");
  for (const [name, object] of Object.entries(objects)) {
    filesystem.writeFile(
      `/lib/python/${name}.o`,
      `CS486OBJ\n${JSON.stringify(object)}`,
    );
  }
  return filesystem;
}

function createProgram(
  filesystem: InMemoryFilesystem,
  source: string,
): ReturnType<typeof createPythonCs486Program> {
  const environment = createNativeEnvironment({
    computerId: 1,
    filesystem,
    terminal: new TerminalBuffer(40, 8),
  });
  return createPythonCs486Program({
    environment,
    filesystem: environment.filesystem,
    memoryBytes: 1_048_576,
    path: "/main.py",
    source,
  });
}

function run(
  process: ReturnType<typeof createPythonCs486Program>["process"],
): void {
  for (
    let count = 0;
    count < 1_000 &&
    (process.state.kind === "ready" || process.hasPendingCpuCycles);
    count += 1
  )
    process.runCpuSlice(100_000);
}

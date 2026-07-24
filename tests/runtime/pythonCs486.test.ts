import { describe, expect, it } from "vitest";

import {
  createPythonCs486Program,
  preparePythonCs486Program,
} from "../../src/application/runtime/pythonCs486.js";
import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { RoundRobinScheduler } from "../../src/application/runtime/scheduler.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

describe("Computer System Python CS486 backend", (): void => {
  it("prepares v3 once and constructs runtime state only after an exact grant", (): void => {
    const filesystem = new InMemoryFilesystem();
    const environment = createNativeEnvironment({
      computerId: 1,
      filesystem,
      terminal: new TerminalBuffer(40, 8),
    });
    const prepared = preparePythonCs486Program({
      environment,
      filesystem: environment.filesystem,
      managedRuntimeMemoryBytes: 131_072,
      path: "/main.py",
      source: "answer = 6 * 7\n",
    });

    expect(prepared.executable).toMatchObject({
      memory: {
        auxiliaryResidentBytes: 131_072,
        model: "cs-flat32-v1",
      },
      version: 3,
    });
    expect(prepared.requirements.physicalReservationBytes).toBe(
      prepared.requirements.linearAddressSpaceBytes + 131_072,
    );
    expect(() =>
      prepared.create(prepared.requirements.linearAddressSpaceBytes - 1),
    ).toThrow(/linear memory requirement exceeds available RAM/u);

    const program = prepared.create(
      prepared.requirements.linearAddressSpaceBytes,
    );
    expect(program.executable).toBe(prepared.executable);
    run(program.process);
    expect(program.runtime.globals.get("answer")).toBe(42);
  });

  it("propagates host-only statistics policy without changing Python execution", (): void => {
    const filesystem = new InMemoryFilesystem();
    const environment = createNativeEnvironment({
      computerId: 101,
      filesystem,
      terminal: new TerminalBuffer(40, 8),
    });
    const prepared = preparePythonCs486Program({
      collectMicroarchitectureStats: false,
      environment,
      filesystem: environment.filesystem,
      managedRuntimeMemoryBytes: 131_072,
      path: "/main.py",
      source: "answer = 6 * 7\n",
    });
    const program = prepared.create(
      prepared.requirements.linearAddressSpaceBytes,
    );

    expect(program.process.microarchitectureStatsEnabled).toBe(false);
    run(program.process);
    expect(program.runtime.globals.get("answer")).toBe(42);
    expect(() => program.process.microarchitectureStats).toThrowError(
      /statistics collection is disabled/u,
    );
  });

  it("can include a bounded managed runtime inside an owning composite process grant", (): void => {
    const filesystem = new InMemoryFilesystem();
    const environment = createNativeEnvironment({
      computerId: 2,
      filesystem,
      terminal: new TerminalBuffer(40, 8),
    });
    const prepared = preparePythonCs486Program({
      environment,
      filesystem: environment.filesystem,
      managedRuntimeMemoryBytes: 64 * 1_024,
      managedRuntimeResidentBytes: 0,
      path: "/system.py",
      source: "pass\n",
    });

    expect(prepared.executable.memory.auxiliaryResidentBytes).toBe(0);
    expect(prepared.requirements.physicalReservationBytes).toBe(
      prepared.requirements.linearAddressSpaceBytes,
    );
    expect(() =>
      preparePythonCs486Program({
        environment,
        filesystem: environment.filesystem,
        managedRuntimeMemoryBytes: 64 * 1_024,
        managedRuntimeResidentBytes: 64 * 1_024 + 1,
        path: "/invalid.py",
        source: "pass\n",
      }),
    ).toThrow(/managedRuntimeResidentBytes/u);
  });

  it("executes functions, branches, loops, and collections on CS486", (): void => {
    const fixture = createFixture(`
def sum_to(stop):
    total = 0
    for value in range(1, stop + 1):
        if value % 2 == 0:
            total = total + value
    return total
values = [sum_to(6), 9]
print(values[0])
`);

    run(fixture.program.process);

    expect(fixture.program.process.state).toEqual({
      kind: "completed",
      value: null,
    });
    expect(fixture.terminal.line(1).trim()).toBe("12");
    expect(fixture.program.runtime.globals.get("values")).toEqual({
      kind: "list",
      values: [12, 9],
    });
  });

  it("imports a same-directory Python module once", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    filesystem.writeFile(
      "/app/helper.py",
      "value = 40\ndef answer(extra=2):\n    return value + extra\n",
    );
    const fixture = createFixture(
      "import helper\nimport helper as second\nsame = helper is second\nprint(helper.answer())\nprint(second.value)\n",
      filesystem,
      "/app/main.py",
    );

    run(fixture.program.process);

    expect(fixture.program.process.state.kind).toBe("completed");
    expect(fixture.program.runtime.globals.get("same")).toBe(true);
    expect(fixture.terminal.line(1).trim()).toBe("42");
    expect(fixture.terminal.line(2).trim()).toBe("40");
  });

  it("imports and executes a zero-argument C object through the same process", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/lib");
    filesystem.makeDirectory("/lib/python");
    const object = compileCs486Object("c", "int answer(){\nreturn 42;\n}\n");
    filesystem.writeFile(
      "/lib/python/fastmath.o",
      `CS486OBJ\n${JSON.stringify(object)}`,
    );
    const fixture = createFixture(
      "import fastmath\nresult = fastmath.answer()\nprint(result)\n",
      filesystem,
    );

    run(fixture.program.process);

    expect(fixture.program.process.state.kind).toBe("completed");
    expect(fixture.program.runtime.globals.get("result")).toBe(42);
    expect(fixture.terminal.line(1).trim()).toBe("42");
  });

  it("imports a C++ object with the same extension ABI", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/lib/python");
    const object = compileCs486Object(
      "cpp",
      "int optimized(){\nreturn 6 * 7;\n}\n",
    );
    filesystem.writeFile(
      "/lib/python/optimizer.o",
      `CS486OBJ\n${JSON.stringify(object)}`,
    );
    const fixture = createFixture(
      "import optimizer\nresult = optimizer.optimized()\n",
      filesystem,
    );

    run(fixture.program.process);

    expect(fixture.program.process.state.kind).toBe("completed");
    expect(fixture.program.runtime.globals.get("result")).toBe(42);
  });

  it("runs matching exception handlers and finally blocks", (): void => {
    const fixture = createFixture(`
try:
    missing_name
except NameError as error:
    caught = error.type
finally:
    finalized = True
`);

    run(fixture.program.process);

    expect(fixture.program.process.state.kind).toBe("completed");
    expect(fixture.program.runtime.globals.get("caught")).toBe("NameError");
    expect(fixture.program.runtime.globals.get("finalized")).toBe(true);
  });

  it("carries return, break, and continue through finally", (): void => {
    const fixture = createFixture(`
def choose():
    try:
        return 1
    finally:
        return 2
result = choose()
value = 0
finalized = 0
while value < 5:
    value = value + 1
    try:
        if value < 3:
            continue
        break
    finally:
        finalized = finalized + 1
`);

    run(fixture.program.process);

    expect(fixture.program.process.state.kind).toBe("completed");
    expect(fixture.program.runtime.globals.get("result")).toBe(2);
    expect(fixture.program.runtime.globals.get("value")).toBe(3);
    expect(fixture.program.runtime.globals.get("finalized")).toBe(3);
  });

  it("preserves a bare reraise through a nested finally", (): void => {
    const fixture = createFixture(`
try:
    missing_name
except NameError:
    try:
        raise
    finally:
        finalized = True
`);

    run(fixture.program.process);

    expect(fixture.program.process.state.kind).toBe("crashed");
    if (fixture.program.process.state.kind === "crashed")
      expect(fixture.program.process.state.error.typeName).toBe("NameError");
    expect(fixture.program.runtime.globals.get("finalized")).toBe(true);
  });

  it("sleeps and resumes event waits through the shared scheduler", (): void => {
    const scheduler = new RoundRobinScheduler({
      cpuCyclesPerComputer: 100_000,
      cpuCyclesPerTick: 100_000,
      eventCapacity: 8,
      timerCapacity: 8,
    });
    const filesystem = new InMemoryFilesystem();
    const terminal = new TerminalBuffer();
    const environment = createNativeEnvironment({
      computerId: 7,
      currentTick: () => scheduler.tickNumber,
      filesystem,
      terminal,
      ticksPerSecond: 20,
    });
    const program = createPythonCs486Program({
      environment,
      filesystem: environment.filesystem,
      memoryBytes: 1_048_576,
      path: "/main.py",
      source: 'import os\nos.sleep(0.1)\nevent = os.pull_event("ready")\n',
    });
    scheduler.add(7, program.process);

    scheduler.runTick();
    expect(program.process.state).toEqual({ kind: "sleeping", wakeTick: 3 });
    scheduler.runTick();
    expect(program.process.state.kind).toBe("sleeping");
    scheduler.runTick();
    expect(program.process.state).toEqual({
      filter: "ready",
      kind: "waiting_event",
    });
    scheduler.queueEvent(7, "ready", 42);
    scheduler.runTick();

    expect(program.process.state.kind).toBe("completed");
    expect(program.runtime.globals.get("event")).toEqual({
      kind: "tuple",
      values: ["ready", 42],
    });
  });

  it("fails missing imports and preserves partially initialized cycles", (): void => {
    const missing = createFixture("import absent\n");
    run(missing.program.process);
    expect(missing.program.process.state.kind).toBe("crashed");
    if (missing.program.process.state.kind === "crashed")
      expect(missing.program.process.state.error.typeName).toBe("ImportError");

    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    filesystem.writeFile("/app/a.py", "import b\nvalue = 1\n");
    filesystem.writeFile("/app/b.py", "import a\nseen = a.__name__\n");
    const circular = createFixture(
      "import a\nsame = a.b.a is a\n",
      filesystem,
      "/app/main.py",
    );
    run(circular.program.process);
    expect(circular.program.process.state.kind).toBe("completed");
    expect(circular.program.runtime.globals.get("same")).toBe(true);
  });
});

function createFixture(
  source: string,
  filesystem = new InMemoryFilesystem(),
  path = "/main.py",
): {
  program: ReturnType<typeof createPythonCs486Program>;
  terminal: TerminalBuffer;
} {
  const terminal = new TerminalBuffer(40, 8);
  const environment = createNativeEnvironment({
    computerId: 1,
    filesystem,
    terminal,
  });
  return {
    program: createPythonCs486Program({
      environment,
      filesystem: environment.filesystem,
      memoryBytes: 1_048_576,
      path,
      source,
    }),
    terminal,
  };
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

import { describe, expect, it } from "vitest";

import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { RoundRobinScheduler } from "../../src/application/runtime/scheduler.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import type { RuntimeValue } from "../../src/domain/runtime/value.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";
import { PythonCs486Harness } from "../runtime/pythonCs486Harness.js";

describe("independently specified ComputerCraft-style compatibility", (): void => {
  it("supports camelCase terminal and filesystem aliases and color bit masks", (): void => {
    const terminal = new TerminalBuffer(8, 2);
    const filesystem = new InMemoryFilesystem();
    const environment = createNativeEnvironment({
      computerId: 88,
      terminal,
      filesystem,
    });
    const vm = new PythonCs486Harness(
      `
import term
import fs
term.setCursorPos(1, 1)
term.setTextColour(4)
term.setBackgroundColor(8)
term.write("port")
cursor = term.getCursorPos()
size = term.getSize()
color = term.getTextColor()
fs.makeDir("/rom")
fs.writeFile("/rom/startup.py", "pass")
present = fs.exists("/rom/startup.py")
bytes = fs.getSize("/rom/startup.py")
`,
      { environment, filesystem, terminal },
    );
    vm.runCpuSlice(1_000_000);

    expect(vm.state).toEqual({ kind: "completed", value: null });
    expect(terminal.line(1)).toBe("port    ");
    expect(terminal.cell(1, 1)).toMatchObject({ foreground: 2, background: 3 });
    expect(vm.globals.get("cursor")).toEqual({ kind: "tuple", values: [5, 1] });
    expect(vm.globals.get("size")).toEqual({ kind: "tuple", values: [8, 2] });
    expect(vm.globals.get("color")).toBe(4);
    expect(vm.globals.get("present")).toBe(true);
    expect(vm.globals.get("bytes")).toBe(4);
  });

  it("supports camelCase os events without exposing the host runtime", (): void => {
    const scheduler = new RoundRobinScheduler({
      eventCapacity: 4,
      timerCapacity: 4,
      cpuCyclesPerComputer: 100_000,
      cpuCyclesPerTick: 100_000,
    });
    const context = {
      computerId: 17,
      terminal: new TerminalBuffer(),
      filesystem: new InMemoryFilesystem(),
      queueEvent: (
        name: string,
        ...arguments_: readonly RuntimeValue[]
      ): void => scheduler.queueEvent(17, name, ...arguments_),
    };
    const environment = createNativeEnvironment(context);
    const vm = new PythonCs486Harness(
      `
import os
identity = os.getComputerID()
os.queueEvent("portable", identity)
event = os.pullEvent("portable")
`,
      {
        environment,
        filesystem: context.filesystem,
        terminal: context.terminal,
      },
    );
    scheduler.add(17, vm.program.process);
    scheduler.runTick();
    scheduler.runTick();

    expect(vm.state).toEqual({ kind: "completed", value: null });
    expect(vm.globals.get("event")).toEqual({
      kind: "tuple",
      values: ["portable", 17],
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { RoundRobinScheduler } from "../../src/application/runtime/scheduler.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import type { NativeFunction } from "../../src/domain/runtime/value.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";
import { RedstoneState } from "../../src/domain/redstone/redstoneState.js";
import { PythonCs486Harness } from "./pythonCs486Harness.js";

describe("initial native modules", (): void => {
  it("exposes allowlisted os, term, and fs operations to programs", (): void => {
    const terminal = new TerminalBuffer(12, 3);
    const filesystem = new InMemoryFilesystem();
    const environment = createNativeEnvironment({
      computerId: 23,
      terminal,
      filesystem,
    });
    const vm = new PythonCs486Harness(
      `
import os
import term
import fs
term.clear()
term.set_cursor_pos(2, 2)
term.set_text_color(2)
term.write(f"ID={os.get_computer_id()}")
fs.make_dir("/etc")
fs.write_file("/etc/id", "23")
size = fs.get_size("/etc/id")
free = fs.get_free_space()
`,
      {
        environment,
        filesystem,
        terminal,
      },
    );

    run(vm);

    expect(vm.state).toEqual({ kind: "completed", value: null });
    expect(terminal.line(2)).toBe(" ID=23      ");
    expect(terminal.cell(2, 2).foreground).toBe(1);
    expect(filesystem.readFile("/etc/id")).toBe("23");
    expect(vm.globals.get("size")).toBe(2);
    expect(vm.globals.get("free")).toBe(filesystem.getFreeSpace());
  });

  it("integrates os timers and event waits with the scheduler", (): void => {
    const scheduler = new RoundRobinScheduler({
      eventCapacity: 8,
      timerCapacity: 8,
      cpuCyclesPerComputer: 100_000,
      cpuCyclesPerTick: 100_000,
    });
    const terminal = new TerminalBuffer();
    const filesystem = new InMemoryFilesystem();
    const environment = createNativeEnvironment({
      computerId: 5,
      terminal,
      filesystem,
      currentTick: () => scheduler.tickNumber,
      queueEvent: (name, ...arguments_) =>
        scheduler.queueEvent(5, name, ...arguments_),
      startTimer: (delay) => scheduler.startTimer(5, delay),
      cancelTimer: (id) => scheduler.cancelTimer(5, id),
      ticksPerSecond: 20,
    });
    const vm = new PythonCs486Harness(
      `
import os
timer_id = os.start_timer(0.1)
timer_event = os.pull_event("timer")
os.queue_event("custom", 9)
custom_event = os.pull_event("custom")
elapsed = os.clock()
`,
      {
        environment,
        filesystem,
        terminal,
      },
    );
    scheduler.add(5, vm.program.process);

    scheduler.runTick();
    expect(vm.state).toEqual({ kind: "waiting_event", filter: "timer" });
    scheduler.runTick();
    expect(vm.state.kind).toBe("waiting_event");
    scheduler.runTick();
    expect(vm.state).toEqual({ kind: "waiting_event", filter: "custom" });
    scheduler.runTick();

    expect(vm.state).toEqual({ kind: "completed", value: null });
    expect(vm.globals.get("timer_event")).toEqual({
      kind: "tuple",
      values: ["timer", vm.globals.get("timer_id")!],
    });
    expect(vm.globals.get("custom_event")).toEqual({
      kind: "tuple",
      values: ["custom", 9],
    });
    expect(vm.globals.get("elapsed")).toBe(0.2);
  });

  it("rejects modules and host capabilities outside the explicit surface", (): void => {
    const filesystem = new InMemoryFilesystem();
    const terminal = new TerminalBuffer();
    const environment = createNativeEnvironment({
      computerId: 1,
      terminal,
      filesystem,
    });
    const importVm = new PythonCs486Harness("import host\n", {
      environment,
      filesystem,
      terminal,
    });
    run(importVm);
    expect(importVm.state.kind).toBe("crashed");
    if (importVm.state.kind === "crashed") {
      expect(importVm.state.error.typeName).toBe("ImportError");
    }

    const capabilityVm = new PythonCs486Harness(
      'import os\nos.queue_event("hidden")\n',
      { environment, filesystem, terminal },
    );
    run(capabilityVm);
    expect(capabilityVm.state.kind).toBe("crashed");
    if (capabilityVm.state.kind === "crashed") {
      expect(capabilityVm.state.error.typeName).toBe("UnsupportedError");
    }
  });

  it("exposes validated six-sided redstone input and digital output", (): void => {
    const redstone = new RedstoneState();
    redstone.setInput("left", 12);
    const filesystem = new InMemoryFilesystem();
    const terminal = new TerminalBuffer();
    const environment = createNativeEnvironment({
      computerId: 2,
      terminal,
      filesystem,
      redstone,
    });
    const vm = new PythonCs486Harness(
      `
import redstone
level = redstone.get_analog_input("left")
active = redstone.get_input("left")
redstone.set_output("right", active)
output = redstone.get_output("right")
`,
      { environment, filesystem, terminal },
    );
    run(vm);
    expect(vm.state.kind).toBe("completed");
    expect(vm.globals.get("level")).toBe(12);
    expect(vm.globals.get("output")).toBe(true);
    expect(redstone.outputMask).toBe(2);
  });

  it("admits a shell command before executing and rendering it", (): void => {
    const filesystem = new InMemoryFilesystem();
    const terminal = new TerminalBuffer();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    let insideTerminalLane = false;
    let admissionCount = 0;
    const originalSubmit = shell.submit.bind(shell);
    const submitSpy = vi.spyOn(shell, "submit").mockImplementation((line) => {
      expect(insideTerminalLane).toBe(true);
      return originalSubmit(line);
    });
    const environment = createNativeEnvironment({
      computerId: 3,
      filesystem,
      osProfile: "dos",
      shell,
      terminal,
      runHostWork: (lane, units, operation) => {
        expect(lane).toBe("terminal");
        expect(units).toBe(1);
        expect(insideTerminalLane).toBe(false);
        admissionCount += 1;
        insideTerminalLane = true;
        try {
          return operation();
        } finally {
          insideTerminalLane = false;
        }
      },
    });
    const shellModule = environment.modules.get("shell");
    const submit = shellModule?.values.get("submit") as NativeFunction;

    expect(submit.call(["DIR"], new Map())).toMatchObject({ kind: "work" });
    expect(admissionCount).toBe(1);
    expect(submitSpy).toHaveBeenCalledWith("DIR");
  });
});

function run(vm: PythonCs486Harness): void {
  for (
    let count = 0;
    count < 100 && (vm.state.kind === "ready" || vm.hasPendingCpuCycles);
    count += 1
  )
    vm.runCpuSlice(100_000);
}

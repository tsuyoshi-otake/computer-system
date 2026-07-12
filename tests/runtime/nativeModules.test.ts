import { describe, expect, it } from "vitest";

import { compileSource } from "../../src/application/runtime/compiler.js";
import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { RoundRobinScheduler } from "../../src/application/runtime/scheduler.js";
import { StackVm } from "../../src/application/runtime/vm.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";
import { RedstoneState } from "../../src/domain/redstone/redstoneState.js";

describe("initial native modules", (): void => {
  it("exposes allowlisted os, term, and fs operations to programs", (): void => {
    const terminal = new TerminalBuffer(12, 3);
    const filesystem = new InMemoryFilesystem();
    const environment = createNativeEnvironment({
      computerId: 23,
      terminal,
      filesystem,
    });
    const vm = new StackVm(
      {
        code: compileSource(`
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
`),
      },
      environment.moduleLoader,
    );

    run(vm);

    expect(vm.state).toEqual({ kind: "completed", value: null });
    expect(terminal.line(2)).toBe(" ID=23      ");
    expect(terminal.cell(2, 2).foreground).toBe(1);
    expect(filesystem.readFile("/etc/id")).toBe("23");
    expect(vm.globals.get("size")).toBe(2);
    expect(vm.globals.get("free")).toBe(999_998);
  });

  it("integrates os timers and event waits with the scheduler", (): void => {
    const scheduler = new RoundRobinScheduler({
      eventCapacity: 8,
      timerCapacity: 8,
      instructionsPerComputer: 100,
      instructionsPerTick: 100,
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
    const vm = new StackVm(
      {
        code: compileSource(`
import os
timer_id = os.start_timer(0.1)
timer_event = os.pull_event("timer")
os.queue_event("custom", 9)
custom_event = os.pull_event("custom")
elapsed = os.clock()
`),
      },
      environment.moduleLoader,
    );
    scheduler.add(5, vm);

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
    const environment = createNativeEnvironment({
      computerId: 1,
      terminal: new TerminalBuffer(),
      filesystem: new InMemoryFilesystem(),
    });
    const importVm = new StackVm(
      { code: compileSource("import host\n") },
      environment.moduleLoader,
    );
    run(importVm);
    expect(importVm.state.kind).toBe("crashed");
    if (importVm.state.kind === "crashed") {
      expect(importVm.state.error.typeName).toBe("ImportError");
    }

    const capabilityVm = new StackVm(
      { code: compileSource('import os\nos.queue_event("hidden")\n') },
      environment.moduleLoader,
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
    const environment = createNativeEnvironment({
      computerId: 2,
      terminal: new TerminalBuffer(),
      filesystem: new InMemoryFilesystem(),
      redstone,
    });
    const vm = new StackVm(
      {
        code: compileSource(`
import redstone
level = redstone.get_analog_input("left")
active = redstone.get_input("left")
redstone.set_output("right", active)
output = redstone.get_output("right")
`),
      },
      environment.moduleLoader,
    );
    run(vm);
    expect(vm.state.kind).toBe("completed");
    expect(vm.globals.get("level")).toBe(12);
    expect(vm.globals.get("output")).toBe(true);
    expect(redstone.outputMask).toBe(2);
  });
});

function run(vm: StackVm): void {
  for (let count = 0; count < 100 && vm.state.kind === "ready"; count += 1)
    vm.runSlice(100);
}

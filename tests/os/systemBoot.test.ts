import { describe, expect, it } from "vitest";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("default Computer System OS boot", (): void => {
  it("boots the shell, edits startup.py, and remains cooperatively waiting", (): void => {
    const record = new ComputerRecord("computer-30", "standard");
    const runtime = new ComputerRuntime();
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runtime.runTick();
    expect(record.terminal.line(1).trimEnd()).toBe(
      "Computer System OS 0.3 (tty1)",
    );
    expect(record.terminal.line(3).trimEnd()).toBe("~$");
    expect(record.terminal.cell(1, 1).foreground).toBe(0);
    expect(record.terminal.cell(1, 3).foreground).toBe(0);
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
    runtime.queueEvent(record.computerId, "terminal_line", "edit /startup.py");
    runtime.runTick();
    runtime.queueEvent(record.computerId, "terminal_line", 'print("boot")');
    runtime.runTick();
    runtime.queueEvent(record.computerId, "terminal_line", ".save");
    runtime.runTick();
    expect(record.filesystem.readFile("/startup.py")).toBe('print("boot")');
    expect(record.lifecycle.state.kind).toBe("waiting_event");
  });

  it("executes a piped BusyBox command delivered as a terminal event", (): void => {
    const record = new ComputerRecord("computer-31", "standard");
    const runtime = new ComputerRuntime();
    const command =
      "printf 'alpha\\nbeta\\nalpha\\n' | grep alpha | wc -l > count";
    runtime.register(record);
    runtime.powerOn(record.computerId);
    runtime.runTick();

    runtime.queueEvent(record.computerId, "terminal_line", command);
    runtime.runTick();
    runtime.queueEvent(record.computerId, "terminal_line", "cat count");
    runtime.runTick();

    expect(record.filesystem.readFile("/home/computer/count")).toBe(
      "      2\n",
    );
    const rows = record.terminal.snapshot().rows;
    expect(`${rows[2]!.slice(3)}${rows[3]!}`.slice(0, command.length)).toBe(
      command,
    );
    expect(
      record.terminal.snapshot().rows.some((line) => line.includes("2")),
    ).toBe(true);
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
  });

  it("edits and saves vi content through a bounded terminal key batch", (): void => {
    const record = new ComputerRecord("computer-32", "standard");
    const runtime = new ComputerRuntime();
    runtime.register(record);
    runtime.powerOn(record.computerId);
    runtime.runTick();

    runtime.queueEvent(record.computerId, "terminal_line", "vi demo.py");
    runtime.runTick();
    expect(record.terminal.line(1)).toContain("VI  /home/computer/demo.py");
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify([
        "i",
        "p",
        "a",
        "s",
        "s",
        "Escape",
        ":",
        "w",
        "q",
        "Enter",
      ]),
    );
    runtime.runTick();

    expect(record.filesystem.readFile("/home/computer/demo.py")).toBe("pass");
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
  });
});

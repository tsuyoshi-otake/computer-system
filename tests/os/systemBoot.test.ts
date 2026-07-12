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
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: "terminal_line",
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
});

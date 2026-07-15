import { describe, expect, it } from "vitest";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { ShellSession } from "../../src/application/os/shellSession.js";

describe("default Computer System Linux boot", (): void => {
  it("clears the persisted display before rendering one boot banner", (): void => {
    const record = new ComputerRecord("computer-29", "standard");
    record.terminal.write("stale boot banner");
    const runtime = new ComputerRuntime({ requireLinuxLogin: true });
    runtime.register(record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    expect(record.terminal.width).toBe(80);
    expect(record.terminal.height).toBe(25);
    expect(record.terminal.line(2)).toContain("CSBIOS System Configuration");
    expect(record.display.state).toEqual({
      kind: "post",
      modeId: "text-80x25",
    });
    runtime.runTick();

    const screen = record.terminal.snapshot().rows.join("\n");
    expect(screen).not.toContain("stale boot banner");
    expect(screen.match(/Computer System Linux 1\.0/gu)).toHaveLength(1);
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("New password:");
    expect(screen).not.toContain("tty1");
    expect(screen).not.toContain("Computer System Bash");
    expect(screen).not.toContain("CS-Linux first boot:");
    expect(screen).not.toContain("login required");
    expect(screen.match(/New password:/gu)).toHaveLength(1);
    expect(screen).not.toContain("CSBIOS System Configuration");
    expect(record.display.state).toEqual({
      kind: "text",
      modeId: "text-80x25",
    });
  });

  it("hands a Portable CSBIOS POST to CS-DOS without tty1 or Bash", (): void => {
    const record = new ComputerRecord("computer-33", "advanced", {
      displayProfileId: "portable-vga-256k",
      hardware: {
        clockHz: 16_000_000,
        cpuModel: "cs386sx",
        memoryBytes: 2_097_152,
      },
      osProfile: "dos",
    });
    const runtime = new ComputerRuntime();
    runtime.register(record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    const post = record.terminal.snapshot().rows.join("\n");
    expect(post).toContain("Main Processor : CS386SX");
    expect(post).toContain("Video Memory     : 256 KB");
    expect(post).toContain("Display Panel    : 800x480 LCD");
    expect(post).toContain("Starting Computer System DOS 6.2");

    runtime.runTick();
    const dos = record.terminal.snapshot().rows.join("\n");
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System DOS 6.2");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("C:\\>");
    expect(dos).not.toContain("tty1");
    expect(dos).not.toContain("Bash");
    expect(dos).not.toContain("CSBIOS System Configuration");
    expect(record.display.state).toEqual({
      kind: "text",
      modeId: "text-80x25",
    });
  });

  it("shows only the Linux identity, blank line, and password prompt on later boots", (): void => {
    const record = new ComputerRecord("computer-87", "standard");
    const setup = new ShellSession(record.filesystem, {
      osProfile: "linux",
      requireLogin: true,
    });
    setup.submit("correct-horse");
    setup.submit("correct-horse");
    const runtime = new ComputerRuntime({ requireLinuxLogin: true });
    runtime.register(record);

    runtime.powerOn(record.computerId);
    runtime.runTick();

    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("Password:");
    const screen = record.terminal.snapshot().rows.join("\n");
    expect(screen).not.toContain("tty1");
    expect(screen).not.toContain("Computer System Bash");
    expect(screen).not.toContain("login required");
  });

  it("does not duplicate the shell prompt when unrelated events arrive after login", (): void => {
    const record = new ComputerRecord("computer-88", "standard");
    const setup = new ShellSession(record.filesystem, {
      osProfile: "linux",
      requireLogin: true,
    });
    setup.submit("correct-horse");
    setup.submit("correct-horse");
    const runtime = new ComputerRuntime({ requireLinuxLogin: true });
    runtime.register(record);
    runtime.powerOn(record.computerId);
    runtime.runTick();

    runtime.queueEvent(record.computerId, "terminal_line", "correct-horse");
    runtime.runTick();
    expect(record.terminal.line(4).trimEnd()).toBe("Login successful.");
    expect(record.terminal.line(5).trimEnd()).toBe("~$");

    runtime.queueEvent(record.computerId, "redstone", "left");
    runtime.runTick();

    const screen = record.terminal.snapshot().rows.join("\n");
    expect(screen.match(/~\$ /gu)).toHaveLength(1);
    expect(record.terminal.line(5).trimEnd()).toBe("~$");
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
  });

  it("boots the Linux shell, edits startup.py with vi, and remains cooperatively waiting", (): void => {
    const record = new ComputerRecord("computer-30", "standard");
    const runtime = new ComputerRuntime();
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runtime.runTick();
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("~$");
    expect(record.terminal.cell(1, 1).foreground).toBe(0);
    expect(record.terminal.cell(1, 3).foreground).toBe(0);
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
    runtime.queueEvent(record.computerId, "terminal_line", "vi /startup.py");
    runtime.runTick();
    expect(record.terminal.line(1)).toContain("VI  /startup.py");
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify([
        "i",
        ...'print("boot")',
        "Escape",
        ":",
        "w",
        "q",
        "Enter",
      ]),
    );
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

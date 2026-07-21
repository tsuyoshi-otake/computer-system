import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import {
  DosIdeSession,
  type QBasicSessionOptions,
} from "../../src/application/editor/qbasicSession.js";
import { ViSession } from "../../src/application/editor/viSession.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  createTerminalInteractionDescriptor,
  maximumTerminalInteractionHelpTopicLength,
  maximumTerminalInteractionHintKeyLength,
  maximumTerminalInteractionHintLabelLength,
  maximumTerminalInteractionHints,
} from "../../src/application/terminal/terminalInteraction.js";
import { guestToolchainTranscriptFromStreams } from "../../src/application/toolchain/guestToolchainTranscript.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

describe("TerminalInteractionDescriptor", (): void => {
  it("constructs an immutable descriptor and rejects a sixth hint", (): void => {
    const interaction = createTerminalInteractionDescriptor({
      context: "shell",
      cursorShape: "block",
      hints: [{ key: "Enter", label: "Run command" }],
      history: true,
      inputMode: "line",
      interrupt: false,
      pointer: "none",
      presentation: "terminal",
      secretInput: false,
    });

    expect(interaction).toMatchObject({
      context: "shell",
      inputMode: "line",
      schema: 1,
    });
    expect(Object.isFrozen(interaction)).toBe(true);
    expect(Object.isFrozen(interaction.hints)).toBe(true);
    expect(Object.isFrozen(interaction.hints[0])).toBe(true);
    expect(() =>
      createTerminalInteractionDescriptor({
        context: "shell",
        cursorShape: "block",
        hints: Array.from(
          { length: maximumTerminalInteractionHints + 1 },
          (_, index) => ({ key: String(index), label: "Hint" }),
        ),
        inputMode: "line",
        history: true,
        interrupt: false,
        pointer: "none",
        presentation: "terminal",
        secretInput: false,
      }),
    ).toThrow(/hints exceed 5/u);
  });

  it("rejects unbounded text and inconsistent interaction capabilities", (): void => {
    const base = {
      context: "shell" as const,
      cursorShape: "block" as const,
      history: false,
      inputMode: "line" as const,
      interrupt: false,
      pointer: "none" as const,
      presentation: "terminal" as const,
      secretInput: false,
    };
    expect(() =>
      createTerminalInteractionDescriptor({
        ...base,
        helpTopicId: "h".repeat(maximumTerminalInteractionHelpTopicLength + 1),
      }),
    ).toThrow(/help topic/u);
    expect(() =>
      createTerminalInteractionDescriptor({
        ...base,
        hints: [
          {
            key: "k".repeat(maximumTerminalInteractionHintKeyLength + 1),
            label: "Hint",
          },
        ],
      }),
    ).toThrow(/hint text/u);
    expect(() =>
      createTerminalInteractionDescriptor({
        ...base,
        hints: [
          {
            key: "F1",
            label: "l".repeat(maximumTerminalInteractionHintLabelLength + 1),
          },
        ],
      }),
    ).toThrow(/hint text/u);
    expect(() =>
      createTerminalInteractionDescriptor({
        ...base,
        inputMode: "keys",
        pointer: "cell",
      }),
    ).toThrow(/DOS TUI/u);
    expect(() =>
      createTerminalInteractionDescriptor({
        ...base,
        inputMode: "keys",
        secretInput: true,
      }),
    ).toThrow(/secret input/u);
    expect(() =>
      createTerminalInteractionDescriptor({
        ...base,
        cursorShape: "beam" as "block",
      }),
    ).toThrow(/cursor shape/u);
    expect(() =>
      createTerminalInteractionDescriptor({
        ...base,
        history: true,
        secretInput: true,
      }),
    ).toThrow(/history requires/u);
    expect(() =>
      createTerminalInteractionDescriptor({
        ...base,
        history: true,
        inputMode: "keys",
      }),
    ).toThrow(/history requires/u);
  });

  it("derives vi interaction from the authoritative mode and output state", (): void => {
    const vi = new ViSession(undefined, "");

    expect(vi.terminalInteraction()).toMatchObject({
      context: "vi-normal",
      inputMode: "keys",
      pointer: "none",
      presentation: "dos-tui",
    });
    vi.key("i");
    expect(vi.terminalInteraction().context).toBe("vi-insert");
    vi.key("Escape");
    vi.key(":");
    expect(vi.terminalInteraction().context).toBe("vi-command");
    vi.key("Escape");
    vi.completeShellCommand(0, "done\n", "", false);
    expect(vi.terminalInteraction()).toMatchObject({
      context: "vi-output",
      inputMode: "keys",
    });
  });

  it.each<{
    readonly context: "csasm" | "edit" | "pwb" | "qbasic";
    readonly options: QBasicSessionOptions;
  }>([
    { context: "edit", options: { editorMode: true } },
    {
      context: "qbasic",
      options: { language: "basic", product: "qbasic" },
    },
    {
      context: "csasm",
      options: { language: "asm", product: "cs-asm" },
    },
    { context: "pwb", options: { language: "c", product: "cs-cpp" } },
  ])("distinguishes the $context DOS IDE profile", ({ context, options }) => {
    const session = new DosIdeSession(
      "C:\\WORK\\MAIN.TXT",
      "",
      51,
      19,
      "MAIN.TXT",
      options,
    );

    expect(session.terminalInteraction()).toMatchObject({
      context,
      helpTopicId: context,
      inputMode: "keys",
      pointer: "cell",
      presentation: "dos-tui",
      secretInput: false,
    });
    expect(session.terminalInteraction().hints.length).toBeLessThanOrEqual(
      maximumTerminalInteractionHints,
    );
  });

  it("advertises only commands owned by the active DOS IDE surface", (): void => {
    const session = new DosIdeSession(
      "C:\\WORK\\MAIN.C",
      "int main(void) { return 0; }",
      51,
      19,
      "MAIN.C",
      { language: "c", product: "cs-cpp" },
    );

    session.completeCommand(
      "build",
      1,
      guestToolchainTranscriptFromStreams("compile failed\n", ""),
    );
    expect(session.terminalInteraction().hints).toEqual([
      { key: "F4", label: "Source" },
      { key: "Esc", label: "Source" },
      { key: "Up/Down", label: "Scroll" },
      { key: "F3", label: "Next error" },
      { key: "Shift+F3", label: "Previous error" },
    ]);
    session.key("F10");
    expect(session.terminalInteraction().hints).toEqual([
      { key: "Arrows", label: "Navigate" },
      { key: "Enter", label: "Choose" },
      { key: "Esc", label: "Close menu" },
    ]);
  });

  it("derives login secrecy and editor modes through ShellSession", (): void => {
    const login = new ShellSession(new InMemoryFilesystem(), {
      computerName: "c-000901",
      osProfile: "linux",
      passwordSalt: (): string => "fixed-test-salt-01",
      requireLogin: true,
    });
    expect(login.terminalInteraction()).toMatchObject({
      context: "secret",
      inputMode: "line",
      secretInput: true,
    });

    const shell = new ShellSession(new InMemoryFilesystem());
    expect(shell.terminalInteraction().context).toBe("shell");
    shell.submit("vi");
    expect(shell.terminalInteraction().context).toBe("vi-normal");
    shell.keys(["i"]);
    expect(shell.terminalInteraction().context).toBe("vi-insert");
  });

  it("composes actual runtime wait and interrupt ownership", (): void => {
    const computerId = "c-000902";
    const runtime = new ComputerRuntime();
    expect(runtime.terminalInteraction(computerId).context).toBe("unavailable");
    const entry: {
      foreground?: object;
      shell: ShellSession;
      vm: {
        state:
          | { readonly kind: "ready" }
          | { readonly filter?: string; readonly kind: "waiting_event" };
      };
    } = {
      shell: new ShellSession(new InMemoryFilesystem()),
      vm: { state: { kind: "waiting_event" } },
    };
    const entries = (
      runtime as unknown as {
        readonly entries: Map<string, typeof entry>;
      }
    ).entries;
    entries.set(computerId, entry);

    expect(runtime.terminalInteraction(computerId)).toMatchObject({
      context: "shell",
      inputMode: "line",
      interrupt: false,
      presentation: "terminal",
    });
    entry.vm.state = {
      filter: "__cs_foreground_complete:1",
      kind: "waiting_event",
    };
    entry.foreground = {};
    expect(runtime.terminalInteraction(computerId)).toMatchObject({
      context: "busy",
      hints: [{ key: "Ctrl+C", label: "Interrupt" }],
      inputMode: "none",
      interrupt: true,
      pointer: "none",
      presentation: "terminal",
      secretInput: false,
    });

    const edit = new DosIdeSession("C:\\NONAME.TXT", "", 51, 19, "UNTITLED", {
      editorMode: true,
    });
    entry.shell = {
      terminalInteraction: () => edit.terminalInteraction(),
    } as ShellSession;
    expect(runtime.terminalInteraction(computerId)).toMatchObject({
      context: "busy",
      helpTopicId: "edit",
      inputMode: "none",
      interrupt: true,
      presentation: "dos-tui",
      secretInput: false,
    });
  });

  it("aborts only line input without submitting or recording a command", (): void => {
    const computerId = "c-000903";
    const runtime = new ComputerRuntime();
    const shell = new ShellSession(new InMemoryFilesystem());
    shell.submit("echo retained");
    const historyBefore = [
      ...(shell as unknown as { readonly history: readonly string[] }).history,
    ];
    const terminal = new TerminalBuffer(80, 25);
    (
      runtime as unknown as {
        readonly entries: Map<string, unknown>;
      }
    ).entries.set(computerId, {
      record: { terminal },
      shell,
      vm: { state: { kind: "waiting_event" } },
    });

    expect(runtime.abortLine(computerId)).toEqual({
      outcome: "accepted",
      state: "line_aborted",
    });
    expect(terminal.snapshot().rows.join("\n")).toContain("^C");
    expect(terminal.snapshot().rows.join("\n")).toContain(shell.prompt());
    expect(
      (shell as unknown as { readonly history: readonly string[] }).history,
    ).toEqual(historyBefore);

    shell.submit("vi");
    expect(runtime.abortLine(computerId)).toEqual({
      outcome: "ignored",
      reason: "not_running",
    });

    const secretShell = new ShellSession(new InMemoryFilesystem(), {
      computerName: computerId,
      osProfile: "linux",
      requireLogin: true,
    });
    (
      runtime as unknown as {
        readonly entries: Map<string, { shell: ShellSession }>;
      }
    ).entries.get(computerId)!.shell = secretShell;
    expect(secretShell.terminalInteraction().secretInput).toBe(true);
    expect(runtime.abortLine(computerId)).toEqual({
      outcome: "ignored",
      reason: "not_running",
    });
  });
});

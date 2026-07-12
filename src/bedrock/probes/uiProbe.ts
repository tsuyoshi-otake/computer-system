import { system, type Player } from "@minecraft/server";

import { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import { showTerminalView } from "../terminalView.js";

const probeTerminal = new TerminalBuffer();
probeTerminal.write("Computer System terminal ready");
for (let color = 0; color < 16; color += 1) {
  probeTerminal.setCursorPosition(color + 1, 3);
  probeTerminal.setTextColor(15 - color);
  probeTerminal.setBackgroundColor(color);
  probeTerminal.write(color.toString(16));
}
for (let color = 0; color < 16; color += 1) {
  probeTerminal.setCursorPosition(color + 1, 4);
  probeTerminal.setTextColor(color);
  probeTerminal.setBackgroundColor(color);
  probeTerminal.write(color === 15 ? "█" : " ");
}
probeTerminal.setBackgroundColor(15);
probeTerminal.setCursorPosition(18, 3);
probeTerminal.setCursorBlink(true);

export async function showTerminalProbe(player: Player): Promise<void> {
  await showTerminalView(
    player,
    probeTerminal,
    {
      onLine: (line): void => {
        probeTerminal.setCursorPosition(1, 2);
        probeTerminal.clearLine();
        probeTerminal.write(`> ${line}`);
      },
      onTerminate: (): void => undefined,
      onClosed: (kind, detail): void => {
        console.warn(
          `CS_TERMINAL_CLOSE ${JSON.stringify({
            kind,
            ...(detail === undefined ? {} : { detail }),
          })}`,
        );
        if (player.isValid) player.sendMessage(`Terminal closed: ${kind}`);
      },
    },
    "Computer System Terminal",
  );
}

export function startTerminalCompetitionProbe(player: Player): void {
  const runId = `compete-${system.currentTick}`;
  const counts = { holder: 0, challenger: 0 };
  const report = (
    role: keyof typeof counts,
    kind: string,
    detail?: string,
  ): void => {
    counts[role] += 1;
    const record = `CS_TERMINAL_COMPETE ${JSON.stringify({
      runId,
      role,
      kind,
      count: counts[role],
      ...(detail === undefined ? {} : { detail }),
    })}`;
    console.warn(record);
    if (player.isValid) player.sendMessage(record);
  };

  void showTerminalView(
    player,
    competitionTerminal("holder"),
    {
      onLine: (): void => undefined,
      onTerminate: (): void => undefined,
      onClosed: (kind, detail): void => report("holder", kind, detail),
    },
    "Competition Holder",
  );
  system.runTimeout((): void => {
    void showTerminalView(
      player,
      competitionTerminal("challenger"),
      {
        onLine: (): void => undefined,
        onTerminate: (): void => undefined,
        onClosed: (kind, detail): void => report("challenger", kind, detail),
      },
      "Competition Challenger",
    );
  }, 10);
}

export function startTerminalStreamProbe(player: Player): void {
  const terminal = new TerminalBuffer();
  terminal.write("Bounded continuous-output probe");
  const runId = `stream-${system.currentTick}`;
  let updates = 0;
  let state: "running" | "completed" | "closed" = "running";

  const report = (phase: "complete" | "closed", kind?: string): void => {
    const record = `CS_TERMINAL_STREAM ${JSON.stringify({
      runId,
      phase,
      updates,
      state,
      ...(kind === undefined ? {} : { kind }),
    })}`;
    console.warn(record);
    if (player.isValid) player.sendMessage(record);
  };

  const streamRun = system.runInterval((): void => {
    if (state !== "running") return;
    updates += 1;
    const row = ((updates - 1) % terminal.height) + 1;
    terminal.setCursorPosition(1, row);
    terminal.setTextColor(updates % 16);
    terminal.setBackgroundColor((updates + 8) % 16);
    terminal.clearLine();
    terminal.write(
      `frame ${updates.toString().padStart(3, "0")} tick ${system.currentTick}`.padEnd(
        terminal.width,
        ".",
      ),
    );
    if (updates !== 200) return;
    state = "completed";
    system.clearRun(streamRun);
    report("complete");
  }, 1);

  void showTerminalView(
    player,
    terminal,
    {
      onLine: (): void => undefined,
      onTerminate: (): void => undefined,
      onClosed: (kind): void => {
        if (state === "running") {
          state = "closed";
          system.clearRun(streamRun);
        }
        report("closed", kind);
      },
    },
    "Continuous Output Probe",
  );
}

function competitionTerminal(role: string): TerminalBuffer {
  const terminal = new TerminalBuffer();
  terminal.write(`Competition ${role}`);
  terminal.setCursorPosition(1, 2);
  terminal.write("Keep this form open for the competing-form probe.");
  return terminal;
}

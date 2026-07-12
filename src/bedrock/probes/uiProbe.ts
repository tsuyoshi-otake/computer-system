import { type Player, system } from "@minecraft/server";
import {
  CustomForm,
  type DataDrivenScreenClosedReason,
  ObservableString,
} from "@minecraft/server-ui";

import {
  TerminalSession,
  type TerminalCloseReason,
  type TerminalFinalization,
} from "../../phase0/terminalSession.js";

const terminalWidth = 51;
const terminalHeight = 19;

export async function showTerminalProbe(player: Player): Promise<void> {
  const session = new TerminalSession();
  const output = new ObservableString(createTerminalFrame(0, "Ready"));
  const input = new ObservableString("", { clientWritable: true });
  const form = new CustomForm(player, "Computer System Phase 0 Terminal")
    .label(output)
    .textField("Command", input, {
      description: "Enter one line and press Submit.",
    })
    .button("Submit", (): void => {
      const event = session.submitLine(input.getData());
      if (event === undefined) {
        return;
      }
      output.setData(
        createTerminalFrame(0, `event:${event.type} > ${event.line}`),
      );
      input.setData("");
    })
    .button("Terminate", (): void => {
      session.requestTermination();
      output.setData(createTerminalFrame(0, "Terminated"));
      form.close();
    })
    .closeButton();

  let updates = 0;
  const updateRun = system.runInterval((): void => {
    updates += 1;
    output.setData(createTerminalFrame(updates, `Input: ${input.getData()}`));
  }, 10);

  try {
    const reason = await form.show();
    reportFinalization(
      player,
      session.finalizeClose(toTerminalCloseReason(reason)),
      updates,
      input.getData().length,
    );
  } catch (error: unknown) {
    reportFinalization(
      player,
      session.finalizeFailure(error, player.isValid),
      updates,
      input.getData().length,
    );
  } finally {
    system.clearRun(updateRun);
  }
}

function toTerminalCloseReason(
  reason: DataDrivenScreenClosedReason,
): TerminalCloseReason {
  return reason;
}

function reportFinalization(
  player: Player,
  finalization: TerminalFinalization,
  updates: number,
  inputLength: number,
): void {
  if (!player.isValid) {
    console.warn(
      `UI probe finalized: result=${finalization.kind}, updates=${updates}, inputLength=${inputLength}.`,
    );
    return;
  }

  const detail =
    finalization.detail === undefined ? "" : `, detail=${finalization.detail}`;
  player.sendMessage(
    `UI probe finalized: result=${finalization.kind}, updates=${updates}, inputLength=${inputLength}${detail}.`,
  );
}

function createTerminalFrame(updates: number, status: string): string {
  const lines = Array.from({ length: terminalHeight }, () => "");
  lines[0] = "Computer System OS - DDUI feasibility probe";
  lines[1] = `Size: ${terminalWidth}x${terminalHeight}`;
  lines[2] = `Observable updates: ${updates}`;
  lines[3] = status;
  lines[5] = "The lines below exercise fixed terminal dimensions.";
  for (let index = 6; index < terminalHeight; index += 1) {
    lines[index] =
      `${String(index + 1).padStart(2, "0")}: ${".".repeat(terminalWidth - 4)}`;
  }

  return lines
    .map((line) => line.slice(0, terminalWidth).padEnd(terminalWidth, " "))
    .join("\n");
}

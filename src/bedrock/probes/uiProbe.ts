import { type Player, system } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";

const terminalWidth = 51;
const terminalHeight = 19;

export async function showTerminalProbe(player: Player): Promise<void> {
  const output = new ObservableString(createTerminalFrame(0, "Ready"));
  const input = new ObservableString("", { clientWritable: true });
  const form = new CustomForm(player, "Computer System Phase 0 Terminal")
    .label(output)
    .textField("Command", input, {
      description: "Enter one line and press Submit.",
    })
    .button("Submit", (): void => {
      output.setData(createTerminalFrame(0, `> ${input.getData()}`));
      input.setData("");
    })
    .button("Terminate", (): void => {
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
    player.sendMessage(
      `UI probe closed: reason=${String(reason)}, updates=${updates}, inputLength=${input.getData().length}.`,
    );
  } catch (error: unknown) {
    player.sendMessage(
      `UI probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    system.clearRun(updateRun);
  }
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

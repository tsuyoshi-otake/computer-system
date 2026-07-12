import { describe, expect, it } from "vitest";

import {
  createComputerTerminalUi,
  terminalHeight,
  terminalWidth,
} from "../../tools/terminal-ui.mjs";

describe("computer terminal JSON UI generator", () => {
  it("keeps the native CustomForm collection connected", () => {
    const ui = createComputerTerminalUi();

    expect(
      ui["custom_form@common_dialogs.main_panel_no_buttons"],
    ).toMatchObject({
      size: [360, 520],
      $child_control: "server_form.computer_terminal_panel",
    });
    expect(ui.computer_terminal_panel.controls).toEqual([
      { "controls@server_form.computer_terminal_controls": {} },
      { "close@server_form.computer_terminal_close": {} },
    ]);
    expect(ui.computer_terminal_controls.factory.control_ids.label).toBe(
      "@server_form.custom_label",
    );
  });

  it("does not emit the indexed planes rejected by GDK 26.33", () => {
    const serialized = JSON.stringify(createComputerTerminalUi());

    expect(serialized).not.toContain("collection_index");
    expect(serialized).not.toContain("computer_terminal_canvas");
    expect(serialized).not.toContain("computer_terminal_background");
    expect(serialized).not.toContain("computer_terminal_foreground");
  });

  it("preserves the logical terminal contract and primary control bounds", () => {
    const ui = createComputerTerminalUi();

    expect([terminalWidth, terminalHeight]).toEqual([51, 19]);
    expect(ui.computer_terminal_controls.max_size).toEqual(["100% - 4px", 490]);
    expect(
      ui["computer_terminal_close@common_buttons.light_text_button"],
    ).toMatchObject({
      anchor_from: "bottom_middle",
      anchor_to: "bottom_middle",
      size: ["100% - 8px", 30],
    });
  });
});

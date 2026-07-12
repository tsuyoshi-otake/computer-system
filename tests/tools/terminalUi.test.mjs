import { describe, expect, it } from "vitest";

import {
  createComputerTerminalUi,
  terminalHeight,
  terminalPalette,
  terminalWidth,
} from "../../tools/terminal-ui.mjs";

describe("computer terminal JSON UI generator", () => {
  it("uses the dedicated terminal panel for every production CustomForm", () => {
    const ui = createComputerTerminalUi();

    expect(
      ui["custom_form@common_dialogs.main_panel_no_buttons"],
    ).toMatchObject({
      size: [360, 390],
      $child_control: "server_form.computer_terminal_panel",
    });
    expect(ui.computer_terminal_panel.controls).toEqual([
      { "canvas@server_form.computer_terminal_canvas": {} },
      { "controls@server_form.computer_terminal_controls": {} },
      { "close@server_form.computer_terminal_close": {} },
    ]);
  });

  it("renders a fixed 51x19 background grid and indexed foreground", () => {
    const ui = createComputerTerminalUi();
    const backgrounds = ui.computer_terminal_background_grid;
    const foregrounds = ui.computer_terminal_canvas.controls.slice(1);

    expect(backgrounds.grid_dimensions).toEqual([
      terminalWidth,
      terminalHeight,
    ]);
    expect(backgrounds.collection_name).toBe("custom_form");
    expect(backgrounds.controls).toHaveLength(terminalWidth * terminalHeight);
    expect(Object.values(backgrounds.controls[0])[0]).toMatchObject({
      collection_index: 3,
      grid_position: [0, 0],
    });
    expect(
      Object.values(backgrounds.controls[terminalWidth + 1])[0],
    ).toMatchObject({
      collection_index: terminalWidth + 4,
      grid_position: [1, 1],
    });
    expect(
      new Set(
        backgrounds.controls.map(
          (control) => Object.values(control)[0].collection_index,
        ),
      ).size,
    ).toBe(terminalWidth * terminalHeight);
    expect(foregrounds).toHaveLength(terminalPalette.length);
    const foregroundIndices = foregrounds.map(
      (control) => Object.values(control)[0].collection_index,
    );
    expect(foregroundIndices).toEqual(
      terminalPalette.map(
        (_, index) => 3 + terminalWidth * terminalHeight + index,
      ),
    );
  });

  it("maps all palette colors and removes data labels from control layout", () => {
    const ui = createComputerTerminalUi();

    expect(terminalPalette).toHaveLength(16);
    expect(new Set(terminalPalette).size).toBe(16);
    expect(ui.computer_terminal_background_cell.controls).toHaveLength(16);
    expect(
      ui.computer_terminal_canvas.controls
        .slice(1)
        .map((control) => Object.values(control)[0].color),
    ).toEqual(
      terminalPalette.map((value) =>
        [1, 3, 5].map(
          (offset) =>
            Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
        ),
      ),
    );
    expect(ui.computer_terminal_controls.factory.control_ids.label).toBe(
      "@server_form.computer_terminal_hidden_label",
    );
    expect(ui.computer_terminal_hidden_label).toMatchObject({
      ignored: true,
      visible: false,
      size: [0, 0],
    });
    expect(ui.computer_terminal_controls.max_size).toEqual(["100% - 4px", 132]);
    expect(
      ui["computer_terminal_close@common_buttons.light_text_button"],
    ).toMatchObject({
      anchor_from: "bottom_middle",
      anchor_to: "bottom_middle",
      size: ["100% - 8px", 30],
    });
  });
});

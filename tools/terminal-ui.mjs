export const terminalWidth = 51;
export const terminalHeight = 19;
export const terminalCellWidth = 6;
export const terminalCellHeight = 10;

export const terminalPalette = [
  "#F0F0F0",
  "#F2B233",
  "#E57FD8",
  "#99B2F2",
  "#DEDE6C",
  "#7FCC19",
  "#F2B2CC",
  "#4C4C4C",
  "#999999",
  "#4C99B2",
  "#B266E5",
  "#3366CC",
  "#7F664C",
  "#57A64E",
  "#CC4C4C",
  "#111111",
];

const terminalControlCount = 3;
const terminalCellCount = terminalWidth * terminalHeight;
const terminalCanvasWidth = terminalWidth * terminalCellWidth;
const terminalCanvasHeight = terminalHeight * terminalCellHeight;

export function createComputerTerminalUi() {
  const backgroundControls = Array.from(
    { length: terminalCellCount },
    (_, index) => ({
      [`cell_${String(index).padStart(3, "0")}@server_form.computer_terminal_background_cell`]:
        {
          collection_index: terminalControlCount + index,
          grid_position: [
            index % terminalWidth,
            Math.floor(index / terminalWidth),
          ],
        },
    }),
  );
  const foregroundControls = terminalPalette.map((color, index) => ({
    [`foreground_${index}@server_form.computer_terminal_foreground`]: {
      collection_index: terminalControlCount + terminalCellCount + index,
      color: hexToRgb(color),
      layer: 100 + index,
    },
  }));
  return {
    namespace: "server_form",
    "custom_form@common_dialogs.main_panel_no_buttons": {
      $title_panel: "common_dialogs.standard_title_label",
      $title_size: ["100% - 15px", 10],
      $title_max_size: ["100% - 15px", 10],
      size: [360, 390],
      $text_name: "#title_text",
      $title_text_binding_type: "none",
      $child_control: "server_form.computer_terminal_panel",
      layer: 2,
    },
    computer_terminal_panel: {
      type: "panel",
      size: ["100%", "100%"],
      controls: [
        { "canvas@server_form.computer_terminal_canvas": {} },
        { "controls@server_form.computer_terminal_controls": {} },
        { "close@server_form.computer_terminal_close": {} },
      ],
    },
    computer_terminal_canvas: {
      type: "panel",
      anchor_from: "top_middle",
      anchor_to: "top_middle",
      offset: [0, 2],
      size: [terminalCanvasWidth, terminalCanvasHeight],
      controls: [
        { "background@server_form.computer_terminal_background_grid": {} },
        ...foregroundControls,
      ],
    },
    computer_terminal_background_grid: {
      type: "grid",
      collection_name: "custom_form",
      grid_dimensions: [terminalWidth, terminalHeight],
      size: [terminalCanvasWidth, terminalCanvasHeight],
      controls: backgroundControls,
    },
    computer_terminal_background_cell: {
      type: "panel",
      size: [terminalCellWidth, terminalCellHeight],
      bindings: [
        {
          binding_type: "collection_details",
          binding_collection_name: "custom_form",
        },
        {
          binding_name: "#custom_text",
          binding_type: "collection",
          binding_collection_name: "custom_form",
        },
      ],
      controls: terminalPalette.map((color, index) => ({
        [`color_${index}`]: {
          type: "image",
          texture: "textures/ui/White",
          color: hexToRgb(color),
          size: ["100%", "100%"],
          bindings: [
            {
              binding_type: "view",
              source_property_name: `(#custom_text = '${index.toString(16)}')`,
              target_property_name: "#visible",
            },
          ],
        },
      })),
    },
    computer_terminal_foreground: {
      type: "label",
      size: [terminalCanvasWidth, terminalCanvasHeight],
      max_size: [terminalCanvasWidth, terminalCanvasHeight],
      anchor_from: "top_left",
      anchor_to: "top_left",
      font_size: "normal",
      line_padding: 0,
      shadow: false,
      text: "#custom_text",
      text_alignment: "left",
      bindings: [
        {
          binding_type: "collection_details",
          binding_collection_name: "custom_form",
        },
        {
          binding_name: "#custom_text",
          binding_type: "collection",
          binding_collection_name: "custom_form",
        },
      ],
    },
    computer_terminal_controls: {
      type: "stack_panel",
      orientation: "vertical",
      anchor_from: "bottom_middle",
      anchor_to: "bottom_middle",
      size: ["100% - 4px", "100%c"],
      max_size: ["100% - 4px", 132],
      offset: [0, -34],
      factory: {
        name: "buttons",
        control_ids: {
          label: "@server_form.computer_terminal_hidden_label",
          toggle: "@server_form.custom_toggle",
          slider: "@server_form.custom_slider",
          step_slider: "@server_form.custom_step_slider",
          dropdown: "@server_form.custom_dropdown",
          input: "@server_form.custom_input",
          header: "@server_form.custom_header",
          divider: "@settings_common.option_group_section_divider",
        },
      },
      collection_name: "custom_form",
      bindings: [
        {
          binding_name: "#custom_form_length",
          binding_name_override: "#collection_length",
        },
      ],
    },
    computer_terminal_hidden_label: {
      type: "panel",
      ignored: true,
      visible: false,
      size: [0, 0],
    },
    "computer_terminal_close@common_buttons.light_text_button": {
      $pressed_button_name: "button.submit_custom_form",
      anchor_from: "bottom_middle",
      anchor_to: "bottom_middle",
      size: ["100% - 8px", 30],
      offset: [0, -2],
      $button_text: "#submit_text",
      $button_text_binding_type: "global",
      $button_binding_condition: "once",
      bindings: [
        {
          binding_name: "#submit_button_visible",
          binding_name_override: "#visible",
        },
      ],
    },
  };
}

function hexToRgb(value) {
  return [1, 3, 5].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  );
}

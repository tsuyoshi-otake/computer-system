export const terminalWidth = 51;
export const terminalHeight = 19;

export function createComputerTerminalUi() {
  return {
    namespace: "server_form",
    "custom_form@common_dialogs.main_panel_no_buttons": {
      $title_panel: "common_dialogs.standard_title_label",
      $title_size: ["100% - 15px", 10],
      $title_max_size: ["100% - 15px", 10],
      size: [360, 520],
      $text_name: "#title_text",
      $title_text_binding_type: "none",
      $child_control: "server_form.computer_terminal_panel",
      layer: 2,
    },
    computer_terminal_panel: {
      type: "panel",
      size: ["100%", "100%"],
      controls: [
        { "controls@server_form.computer_terminal_controls": {} },
        { "close@server_form.computer_terminal_close": {} },
      ],
    },
    computer_terminal_controls: {
      type: "stack_panel",
      orientation: "vertical",
      anchor_from: "bottom_middle",
      anchor_to: "bottom_middle",
      size: ["100% - 4px", "100%c"],
      max_size: ["100% - 4px", 490],
      offset: [0, -34],
      factory: {
        name: "buttons",
        control_ids: {
          label: "@server_form.custom_label",
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

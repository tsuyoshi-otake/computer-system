export const terminalInteractionSchema = 1 as const;
export const maximumTerminalInteractionHints = 5;
export const maximumTerminalInteractionHelpTopicLength = 64;
export const maximumTerminalInteractionHintKeyLength = 32;
export const maximumTerminalInteractionHintLabelLength = 64;

export type TerminalInteractionInputMode = "keys" | "line" | "none";
export type TerminalInteractionCursorShape = "block" | "underline";
export type TerminalInteractionPointer = "cell" | "none";
export type TerminalInteractionPresentation = "dos-tui" | "terminal";
export type TerminalInteractionContext =
  | "busy"
  | "cs-abi"
  | "csasm"
  | "edit"
  | "less"
  | "login"
  | "more"
  | "pwb"
  | "qbasic"
  | "secret"
  | "shell"
  | "unavailable"
  | "vi-command"
  | "vi-insert"
  | "vi-normal"
  | "vi-output";

export interface TerminalInteractionHint {
  readonly key: string;
  readonly label: string;
}

export interface TerminalInteractionDescriptor {
  readonly context: TerminalInteractionContext;
  readonly cursorShape: TerminalInteractionCursorShape;
  readonly helpTopicId?: string;
  readonly hints: readonly TerminalInteractionHint[];
  readonly history: boolean;
  readonly inputMode: TerminalInteractionInputMode;
  readonly interrupt: boolean;
  readonly pointer: TerminalInteractionPointer;
  readonly presentation: TerminalInteractionPresentation;
  readonly schema: typeof terminalInteractionSchema;
  readonly secretInput: boolean;
}

export type TerminalInteractionDescriptorInput = Omit<
  TerminalInteractionDescriptor,
  "hints" | "schema"
> & {
  readonly hints?: readonly TerminalInteractionHint[];
};

/**
 * Constructs the immutable, bounded interaction contract shared by application
 * state owners and transport adapters.
 */
export function createTerminalInteractionDescriptor(
  input: TerminalInteractionDescriptorInput,
): TerminalInteractionDescriptor {
  const sourceHints = input.hints ?? [];
  if (sourceHints.length > maximumTerminalInteractionHints) {
    throw new RangeError(
      `terminal interaction hints exceed ${String(maximumTerminalInteractionHints)}`,
    );
  }
  if (input.cursorShape !== "block" && input.cursorShape !== "underline") {
    throw new RangeError("terminal cursor shape is invalid");
  }
  if (typeof input.history !== "boolean") {
    throw new RangeError("terminal history flag is invalid");
  }
  if (input.history && (input.inputMode !== "line" || input.secretInput)) {
    throw new RangeError("terminal history requires non-secret line input");
  }
  if (
    input.helpTopicId !== undefined &&
    !isBoundedInteractionText(
      input.helpTopicId,
      maximumTerminalInteractionHelpTopicLength,
    )
  ) {
    throw new RangeError("terminal interaction help topic is invalid");
  }
  if (
    input.pointer === "cell" &&
    (input.inputMode !== "keys" || input.presentation !== "dos-tui")
  ) {
    throw new RangeError(
      "terminal cell pointer requires keys input and DOS TUI presentation",
    );
  }
  if (
    input.secretInput &&
    input.inputMode !== "line" &&
    input.inputMode !== "none"
  ) {
    throw new RangeError("terminal secret input requires line or no input");
  }
  const hints = Object.freeze(
    sourceHints.map((hint) => {
      if (
        !isBoundedInteractionText(
          hint.key,
          maximumTerminalInteractionHintKeyLength,
        ) ||
        !isBoundedInteractionText(
          hint.label,
          maximumTerminalInteractionHintLabelLength,
        )
      ) {
        throw new RangeError("terminal interaction hint text is invalid");
      }
      return Object.freeze({ key: hint.key, label: hint.label });
    }),
  );
  return Object.freeze({
    context: input.context,
    cursorShape: input.cursorShape,
    ...(input.helpTopicId === undefined
      ? {}
      : { helpTopicId: input.helpTopicId }),
    hints,
    history: input.history,
    inputMode: input.inputMode,
    interrupt: input.interrupt,
    pointer: input.pointer,
    presentation: input.presentation,
    schema: terminalInteractionSchema,
    secretInput: input.secretInput,
  });
}

function isBoundedInteractionText(
  value: string,
  maximumLength: number,
): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\0\r\n]/u.test(value)
  );
}

const unavailableInteraction = createTerminalInteractionDescriptor({
  context: "unavailable",
  cursorShape: "underline",
  history: false,
  inputMode: "none",
  interrupt: false,
  pointer: "none",
  presentation: "terminal",
  secretInput: false,
});

export function unavailableTerminalInteraction(): TerminalInteractionDescriptor {
  return unavailableInteraction;
}

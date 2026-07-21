import { DosEditSession, type DosEditAction } from "./dosEditSession.js";
import {
  dosTuiColor,
  dosTuiSingleLineBox as singleLineBox,
  drawDosTuiShadow,
} from "./dosTuiTheme.js";
import type {
  DosFileDialogProvider,
  EditorResult,
  EditorScreen,
} from "./editorScreen.js";
import type { HighlightedCell } from "./syntaxHighlight.js";
import type { ViExternalContextProvider } from "./viCompletion.js";
import type {
  DosEditorConfiguration,
  DosEditorOptions,
  DosEditorProfile,
} from "./dosEditorOptions.js";
import {
  createTerminalInteractionDescriptor,
  type TerminalInteractionDescriptor,
  type TerminalInteractionHint,
} from "../terminal/terminalInteraction.js";
import {
  guestToolchainTranscriptFromStreams,
  renderGuestToolchainTranscript,
  type GuestToolchainTranscript,
  type NavigableGuestDiagnostic,
} from "../toolchain/guestToolchainTranscript.js";

export type DosIdeLanguage = "asm" | "basic" | "c" | "cpp";
export type DosIdeProduct = "cs-asm" | "cs-cpp" | "qbasic";
export type DosIdeCommand =
  | "build"
  | "build-run"
  | "clean"
  | "compile-file"
  | "debug-clear-breakpoint"
  | "debug-continue"
  | "debug-set-breakpoint"
  | "debug-start"
  | "debug-step"
  | "debug-stop"
  | "rebuild"
  | "run";

export const csAsmProductName = "CS ASM 1.0";
export const csCFamilyProductName = "CS C/C++ 1.0";
export const csQBasicProductName = "CS QBASIC 1.0";

export type QBasicSessionResult =
  | EditorResult
  | {
      readonly command: DosIdeCommand;
      readonly kind: "command";
      readonly screen: EditorScreen;
    }
  | {
      readonly fileName: string;
      readonly kind: "program-list";
      readonly screen: EditorScreen;
    }
  | {
      readonly column: number;
      readonly fileName: string;
      readonly kind: "diagnostic";
      readonly line: number;
      readonly screen: EditorScreen;
    };

export interface QBasicSessionOptions {
  readonly diagnosticSourceDisplay?: (source: string) => string;
  readonly editorConfiguration?: DosEditorConfiguration;
  readonly editorMode?: boolean;
  readonly externalContext?: ViExternalContextProvider;
  readonly fileDialog?: DosFileDialogProvider;
  readonly language?: DosIdeLanguage;
  readonly product?: DosIdeProduct;
  readonly showWelcome?: boolean;
  readonly sourceExists?: boolean;
  readonly targetName?: string;
}

export interface TerminalMouseEvent {
  readonly action: "down" | "move" | "up";
  readonly button: 0 | 1 | 2;
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
}

type WorkBenchMenuName =
  | "debug"
  | "edit"
  | "file"
  | "help"
  | "make"
  | "options"
  | "run"
  | "search"
  | "view";
type WorkBenchMode = "about" | "editing" | "help" | "menu" | "program-list";
type WorkBenchOverlay =
  "about" | "help" | "menu" | "none" | "program-list" | "welcome";
type WorkBenchViewState =
  | {
      readonly overlay: WorkBenchOverlay;
      readonly primary: "source";
    }
  | {
      readonly overlay: "none";
      readonly primary: "output";
    }
  | {
      readonly overlay: "menu" | "none" | "program-list";
      readonly primary: "debugger";
    };
type WorkBenchAction =
  | DosEditAction
  | "about"
  | "build"
  | "build-run"
  | "clean"
  | "compile-file"
  | "debug-clear-breakpoint"
  | "debug-continue"
  | "debug-set-breakpoint"
  | "debug-show"
  | "debug-start"
  | "debug-step"
  | "debug-stop"
  | "next-error"
  | "output"
  | "previous-error"
  | "rebuild"
  | "run-last"
  | "set-program-list"
  | "workbench-help";

interface WorkBenchMenuEntry {
  readonly action: WorkBenchAction;
  readonly label: string;
  readonly mnemonic?: string;
  readonly shortcut: string;
}

interface DosIdeCommandCatalog {
  readonly menuOrder: readonly WorkBenchMenuName[];
  readonly sourceRunOnly: boolean;
  readonly supportedCommands: readonly DosIdeCommand[];
}

const workBenchMenuOrder = [
  "file",
  "edit",
  "view",
  "search",
  "make",
  "run",
  "debug",
  "options",
  "help",
] as const;
const workBenchMenuLabels: Readonly<Record<WorkBenchMenuName, string>> = {
  debug: "Debug",
  edit: "Edit",
  file: "File",
  help: "Help",
  make: "Make",
  options: "Options",
  run: "Run",
  search: "Search",
  view: "View",
};
const qBasicMenuOrder = [
  "file",
  "edit",
  "view",
  "search",
  "run",
  "options",
  "help",
] as const;
const fullWorkBenchCommands: readonly DosIdeCommand[] = [
  "build",
  "build-run",
  "clean",
  "compile-file",
  "debug-clear-breakpoint",
  "debug-continue",
  "debug-set-breakpoint",
  "debug-start",
  "debug-step",
  "debug-stop",
  "rebuild",
  "run",
];
const dosIdeCommandCatalogs: Readonly<
  Record<DosEditorProfile, DosIdeCommandCatalog>
> = {
  csasm: {
    menuOrder: workBenchMenuOrder,
    sourceRunOnly: false,
    supportedCommands: fullWorkBenchCommands,
  },
  edit: {
    menuOrder: [],
    sourceRunOnly: false,
    supportedCommands: [],
  },
  pwb: {
    menuOrder: workBenchMenuOrder,
    sourceRunOnly: false,
    supportedCommands: fullWorkBenchCommands,
  },
  qbasic: {
    menuOrder: qBasicMenuOrder,
    sourceRunOnly: true,
    supportedCommands: ["build-run"],
  },
};
const workBenchMenus: Readonly<
  Record<WorkBenchMenuName, readonly WorkBenchMenuEntry[]>
> = {
  file: [
    { action: "new", label: "New", mnemonic: "n", shortcut: "Ctrl+N" },
    { action: "open", label: "Open...", mnemonic: "o", shortcut: "Ctrl+O" },
    { action: "save", label: "Save", mnemonic: "s", shortcut: "F2" },
    {
      action: "save-as",
      label: "Save As...",
      mnemonic: "a",
      shortcut: "Ctrl+Shift+S",
    },
    { action: "exit", label: "Exit", mnemonic: "x", shortcut: "Alt+F X" },
  ],
  edit: [
    { action: "undo", label: "Undo", shortcut: "Ctrl+Z" },
    { action: "cut", label: "Cut", shortcut: "Ctrl+X" },
    { action: "copy", label: "Copy", shortcut: "Ctrl+C" },
    { action: "paste", label: "Paste", shortcut: "Ctrl+V" },
    { action: "select-all", label: "Select All", shortcut: "Ctrl+A" },
  ],
  view: [
    { action: "output", label: "Output", shortcut: "F4" },
    { action: "next-error", label: "Next Error", shortcut: "F3" },
    {
      action: "previous-error",
      label: "Previous Error",
      shortcut: "Shift+F3",
    },
    { action: "debug-show", label: "Debugger", shortcut: "" },
  ],
  search: [
    { action: "find", label: "Find", shortcut: "Ctrl+F" },
    { action: "find-next", label: "Find Next", shortcut: "F3" },
    { action: "replace", label: "Replace...", shortcut: "Ctrl+H" },
    {
      action: "symbols",
      label: "Document Symbols...",
      shortcut: "Ctrl+Shift+O",
    },
    { action: "goto-definition", label: "Go To Definition", shortcut: "F12" },
    { action: "goto-back", label: "Go Back", shortcut: "Alt+Left" },
  ],
  make: [
    {
      action: "compile-file",
      label: "Compile File",
      mnemonic: "c",
      shortcut: "Alt+F7",
    },
    {
      action: "set-program-list",
      label: "Set Program List...",
      mnemonic: "p",
      shortcut: "",
    },
    { action: "build", label: "Build", mnemonic: "b", shortcut: "F7" },
    {
      action: "rebuild",
      label: "Rebuild All",
      mnemonic: "r",
      shortcut: "Ctrl+F7",
    },
    { action: "clean", label: "Clean", mnemonic: "l", shortcut: "" },
  ],
  run: [
    { action: "run-last", label: "Run Last Build", shortcut: "Ctrl+F5" },
    { action: "build-run", label: "Build and Run", shortcut: "Shift+F5" },
    { action: "dos-command", label: "DOS Command...", shortcut: "" },
    {
      action: "repeat-dos-command",
      label: "Repeat DOS Command",
      shortcut: "",
    },
    {
      action: "insert-command-output",
      label: "Insert Command Output...",
      shortcut: "",
    },
  ],
  debug: [
    { action: "debug-start", label: "Start / Restart", shortcut: "F5" },
    { action: "debug-continue", label: "Continue", shortcut: "F5" },
    { action: "debug-step", label: "Trace Instruction", shortcut: "F8" },
    { action: "debug-set-breakpoint", label: "Set Breakpoint", shortcut: "F9" },
    {
      action: "debug-clear-breakpoint",
      label: "Clear Breakpoint",
      shortcut: "F9",
    },
    { action: "debug-stop", label: "Stop Debugging", shortcut: "Shift+F5" },
  ],
  options: [
    { action: "display-options", label: "Display...", shortcut: "" },
    { action: "editing-options", label: "Editing...", shortcut: "" },
    {
      action: "completion-options",
      label: "Completion...",
      shortcut: "Ctrl+Space",
    },
    { action: "language-options", label: "Language...", shortcut: "" },
    {
      action: "toggle-insert",
      label: "Insert/Overwrite",
      shortcut: "Ins",
    },
    { action: "save-settings", label: "Save Settings", shortcut: "" },
    { action: "reload-settings", label: "Reload Settings", shortcut: "" },
    { action: "default-settings", label: "Restore Defaults", shortcut: "" },
  ],
  help: [
    { action: "workbench-help", label: "WorkBench Help", shortcut: "F1" },
    { action: "about", label: "About", shortcut: "" },
  ],
};
const editActions: readonly DosEditAction[] = [
  "completion-options",
  "copy",
  "cut",
  "default-settings",
  "display-options",
  "dos-command",
  "editing-options",
  "exit",
  "find",
  "find-next",
  "goto-back",
  "goto-definition",
  "insert-command-output",
  "language-options",
  "help",
  "new",
  "open",
  "paste",
  "replace",
  "repeat-dos-command",
  "reload-settings",
  "save",
  "save-as",
  "select-all",
  "save-settings",
  "symbols",
  "toggle-insert",
  "undo",
];

/** Shared DOS workbench controller used by CS QBASIC, CS ASM, CS C/C++, and EDIT. */
export class DosIdeSession {
  private readonly commandCatalog: DosIdeCommandCatalog;
  private readonly debuggerBreakpoints = new Set<number>();
  private readonly editor: DosEditSession;
  private readonly editorProfileValue: DosEditorProfile;
  private readonly pressedButtons = new Set<0 | 1 | 2>();
  private lastRenderedScreen?: EditorScreen;
  private debuggerActiveValue = false;
  private debuggerAddressValue = 0;
  private debuggerOutput = "";
  private menuIndex = 0;
  private menuItemIndex = 0;
  private outputDiagnosticIndex = -1;
  private outputDiagnostics: readonly NavigableGuestDiagnostic[] = [];
  private outputRows: readonly string[] = [];
  private outputTop = 0;
  private pendingAfterSave?: DosIdeCommand;
  private primaryDrag = false;
  private programListInput = "";
  private programListPathValue?: string;
  private lastArtifactOwnerFile?: string;
  private lastArtifactPathValue?: string;
  private lastBuildStaleValue = true;
  private status = "Ready";
  private screenBatch?: EditorScreen;
  private viewState: WorkBenchViewState = {
    overlay: "none",
    primary: "source",
  };

  constructor(
    fileName: string,
    contents: string,
    width = 51,
    height = 19,
    displayName = fileName,
    readonly options: QBasicSessionOptions = {},
  ) {
    const editorProfile: DosEditorProfile =
      options.editorMode === true
        ? "edit"
        : options.product === "qbasic" || options.product === undefined
          ? "qbasic"
          : options.language === "asm"
            ? "csasm"
            : "pwb";
    this.editorProfileValue = editorProfile;
    this.commandCatalog = dosIdeCommandCatalogs[editorProfile];
    this.editor = new DosEditSession(
      fileName,
      contents,
      width,
      height,
      displayName,
      options.sourceExists ?? true,
      options.fileDialog,
      {
        configuration: options.editorConfiguration,
        externalContext: options.externalContext,
        profile: editorProfile,
      },
    );
    this.welcomeVisible = options.showWelcome ?? false;
  }

  private get debuggerVisible(): boolean {
    return this.viewState.primary === "debugger";
  }

  private set debuggerVisible(visible: boolean) {
    if (visible) {
      this.viewState = { overlay: "none", primary: "debugger" };
    } else if (this.viewState.primary === "debugger") {
      this.viewState = { overlay: "none", primary: "source" };
    }
  }

  private get modeValue(): WorkBenchMode {
    const overlay = this.viewState.overlay;
    return overlay === "none" || overlay === "welcome" ? "editing" : overlay;
  }

  private set modeValue(mode: WorkBenchMode) {
    if (mode === "editing") {
      this.viewState =
        this.viewState.primary === "debugger"
          ? { overlay: "none", primary: "debugger" }
          : this.viewState.primary === "output"
            ? { overlay: "none", primary: "output" }
            : { overlay: "none", primary: "source" };
      return;
    }
    if (mode === "menu" || mode === "program-list") {
      this.viewState =
        this.viewState.primary === "debugger"
          ? { overlay: mode, primary: "debugger" }
          : { overlay: mode, primary: "source" };
      return;
    }
    this.viewState = { overlay: mode, primary: "source" };
  }

  private get outputVisible(): boolean {
    return this.viewState.primary === "output";
  }

  private set outputVisible(visible: boolean) {
    if (visible) {
      this.viewState = { overlay: "none", primary: "output" };
    } else if (this.viewState.primary === "output") {
      this.viewState = { overlay: "none", primary: "source" };
    }
  }

  private get welcomeVisible(): boolean {
    return (
      this.viewState.primary === "source" &&
      this.viewState.overlay === "welcome"
    );
  }

  private set welcomeVisible(visible: boolean) {
    if (visible) {
      this.viewState = { overlay: "welcome", primary: "source" };
    } else if (this.viewState.overlay === "welcome") {
      this.viewState = { overlay: "none", primary: "source" };
    }
  }

  get contents(): string {
    return this.editor.contents;
  }

  get displayName(): string {
    return this.editor.displayName;
  }

  get fileName(): string {
    return this.editor.fileName;
  }

  get modified(): boolean {
    return this.editor.modified;
  }

  get editorOptions(): DosEditorOptions {
    return this.editor.options;
  }

  get programListPath(): string | undefined {
    return this.programListPathValue;
  }

  get lastArtifactPath(): string | undefined {
    return this.lastBuildUsable ? this.lastArtifactPathValue : undefined;
  }

  get lastBuildStale(): boolean {
    return !this.lastBuildUsable;
  }

  private get lastBuildUsable(): boolean {
    return (
      !this.lastBuildStaleValue &&
      !this.editor.modified &&
      this.lastArtifactPathValue !== undefined &&
      this.lastArtifactOwnerFile === this.editor.fileName
    );
  }

  get debuggerActive(): boolean {
    return this.debuggerActiveValue;
  }

  get debuggerAddress(): number {
    return this.debuggerAddressValue;
  }

  get state(): "closed" | "editing" {
    return this.editor.state;
  }

  get editorProfile(): DosEditorProfile {
    return this.editorProfileValue;
  }

  terminalInteraction(): TerminalInteractionDescriptor {
    if (this.editor.state === "closed") {
      return createTerminalInteractionDescriptor({
        context: "unavailable",
        cursorShape: "underline",
        helpTopicId: this.editorProfileValue,
        history: false,
        inputMode: "none",
        interrupt: false,
        pointer: "none",
        presentation: "dos-tui",
        secretInput: false,
      });
    }
    return createTerminalInteractionDescriptor({
      context: this.editorProfileValue,
      cursorShape: this.editor.isInsertMode ? "block" : "underline",
      helpTopicId: this.editorProfileValue,
      history: false,
      hints: this.interactionHints(),
      inputMode: "keys",
      interrupt: false,
      pointer: "cell",
      presentation: "dos-tui",
      secretInput: false,
    });
  }

  private interactionHints(): readonly TerminalInteractionHint[] {
    if (this.welcomeVisible) {
      return [
        { key: "Enter", label: "Open editor" },
        { key: "F1", label: "Help" },
        { key: "Esc", label: "Open editor" },
      ];
    }
    if (this.options.editorMode === true) {
      return this.editor.mode === "editing"
        ? [
            { key: "F1", label: "Help" },
            { key: "F2", label: "Save" },
            { key: "F3", label: "Find next" },
            { key: "F10", label: "Menu" },
            { key: "Alt+X", label: "Exit" },
          ]
        : [{ key: "Esc", label: "Close dialog" }];
    }
    if (this.modeValue === "program-list") {
      return [
        { key: "Enter", label: "Set program list" },
        { key: "Esc", label: "Cancel" },
      ];
    }
    if (this.modeValue === "help" || this.modeValue === "about") {
      return [
        { key: "F1", label: "Close" },
        { key: "Enter", label: "Close" },
        { key: "Esc", label: "Close" },
      ];
    }
    if (this.modeValue === "menu") {
      return [
        { key: "Arrows", label: "Navigate" },
        { key: "Enter", label: "Choose" },
        { key: "Esc", label: "Close menu" },
      ];
    }
    if (this.editor.mode !== "editing") {
      return [{ key: "Esc", label: "Close dialog" }];
    }
    if (this.outputVisible) {
      return [
        { key: "F4", label: "Source" },
        { key: "Esc", label: "Source" },
        { key: "Up/Down", label: "Scroll" },
        { key: "F3", label: "Next error" },
        { key: "Shift+F3", label: "Previous error" },
      ];
    }
    if (this.debuggerVisible) {
      return this.debuggerActiveValue
        ? [
            { key: "Esc", label: "Source" },
            { key: "F5", label: "Continue" },
            { key: "F8", label: "Step" },
            { key: "F9", label: "Breakpoint" },
            { key: "Shift+F5", label: "Stop" },
          ]
        : [
            { key: "Esc", label: "Source" },
            { key: "F5", label: "Start debugger" },
            { key: "F10", label: "Menu" },
          ];
    }
    if (this.editorProfileValue === "qbasic") {
      return [
        { key: "F1", label: "Help" },
        { key: "F2", label: "Save" },
        { key: "F4", label: "Output" },
        { key: "F5", label: "Run" },
        { key: "F10", label: "Menu" },
      ];
    }
    return [
      { key: "F1", label: "Help" },
      { key: "F2", label: "Save" },
      { key: "F5", label: "Debug" },
      { key: "F7", label: "Build" },
      { key: "F10", label: "Menu" },
    ];
  }

  get language(): DosIdeLanguage {
    return this.options.language ?? "basic";
  }

  get product(): DosIdeProduct {
    return this.options.product ?? "qbasic";
  }

  get targetName(): string {
    return this.options.targetName ?? "CS486";
  }

  get closeLabel(): string {
    if (this.options.editorMode === true) return "EDIT";
    if (this.product === "cs-asm") return "CSASM";
    if (this.product === "cs-cpp") return "PWB";
    return "QBASIC";
  }

  completeCommand(
    command:
      "build" | "build-run" | "clean" | "compile-file" | "rebuild" | "run",
    exitCode: number,
    transcript: GuestToolchainTranscript,
    artifactDisplayName = this.artifactDisplayName(),
  ): EditorScreen {
    const rendered = renderGuestToolchainTranscript(transcript, {
      displaySource: this.options.diagnosticSourceDisplay,
      profile: "dos",
    });
    this.outputRows = rendered.orderedRows;
    this.outputDiagnostics = rendered.navigableDiagnostics;
    this.outputDiagnosticIndex = -1;
    this.outputTop = 0;
    if (this.product === "qbasic") {
      this.status =
        exitCode === 0
          ? "Program finished; no executable was installed"
          : `Source run stopped with status ${String(exitCode)}`;
    } else if (command === "build" || command === "rebuild") {
      this.status =
        exitCode === 0
          ? `${command === "rebuild" ? "Rebuilt" : "Built"} ${artifactDisplayName}`
          : `Build failed with status ${String(exitCode)}`;
    } else if (command === "compile-file") {
      this.status =
        exitCode === 0
          ? "Compiled current file"
          : `Compile failed with status ${String(exitCode)}`;
    } else if (command === "clean") {
      this.status =
        exitCode === 0
          ? "Clean completed"
          : `Clean failed with status ${String(exitCode)}`;
    } else if (command === "build-run") {
      this.status =
        exitCode === 0
          ? `Program finished; built ${artifactDisplayName}`
          : `Build or program stopped with status ${String(exitCode)}`;
    } else {
      this.status =
        exitCode === 0
          ? "Program finished"
          : `Program stopped with status ${String(exitCode)}`;
    }
    // A program may deliberately return a non-zero status. That does not make
    // the executable stale; only a failed producer operation does.
    if (exitCode !== 0 && command !== "run" && command !== "build-run") {
      this.lastBuildStaleValue = true;
    }
    this.outputVisible = exitCode !== 0;
    this.debuggerVisible = false;
    return this.screen();
  }

  completeSettingsSave(): QBasicSessionResult {
    return this.transform(this.editor.completeSettingsSave());
  }

  failSettingsSave(detail: string): QBasicSessionResult {
    return this.transform(this.editor.failSettingsSave(detail));
  }

  completeSettingsReload(
    configuration: DosEditorConfiguration,
  ): QBasicSessionResult {
    return this.transform(this.editor.completeSettingsReload(configuration));
  }

  failSettingsReload(detail: string): QBasicSessionResult {
    return this.transform(this.editor.failSettingsReload(detail));
  }

  completeShellCommand(
    exitCode: number,
    stdout: string,
    stderr: string,
    insertOutput: boolean,
  ): QBasicSessionResult {
    return this.transform(
      this.editor.completeShellCommand(exitCode, stdout, stderr, insertOutput),
    );
  }

  completeNavigation(
    path: string,
    contents: string,
    displayName: string,
    line: number,
    column: number,
  ): QBasicSessionResult {
    return this.transform(
      this.editor.completeNavigation(path, contents, displayName, line, column),
    );
  }

  failNavigation(detail: string): QBasicSessionResult {
    return this.transform(this.editor.failNavigation(detail));
  }

  completeRun(exitCode: number, output = ""): EditorScreen {
    return this.completeCommand(
      "build-run",
      exitCode,
      guestToolchainTranscriptFromStreams(output, ""),
    );
  }

  completeDebuggerCommand(
    command: Exclude<
      DosIdeCommand,
      "build" | "build-run" | "clean" | "compile-file" | "rebuild" | "run"
    >,
    exitCode: number,
    output = "",
  ): EditorScreen {
    const breakpointAddress = this.debuggerAddressValue;
    this.debuggerOutput = output.slice(0, 256_000);
    const address = debuggerAddressFrom(output);
    if (address !== undefined) this.debuggerAddressValue = address;
    if (command === "debug-stop") {
      this.debuggerActiveValue = false;
      this.debuggerVisible = false;
      this.debuggerBreakpoints.clear();
      this.status =
        exitCode === 0 ? "Debugging stopped" : "Debugger stop failed";
      return this.screen();
    }
    if (command === "debug-start") {
      this.debuggerActiveValue = exitCode === 0;
      this.debuggerBreakpoints.clear();
      this.status =
        exitCode === 0
          ? `Debugger loaded at ${formatDebuggerAddress(this.debuggerAddressValue)}`
          : "Debugger start failed";
    } else if (command === "debug-set-breakpoint") {
      if (exitCode === 0) this.debuggerBreakpoints.add(breakpointAddress);
      this.status =
        exitCode === 0
          ? `Breakpoint set at ${formatDebuggerAddress(breakpointAddress)}`
          : "Could not set breakpoint";
    } else if (command === "debug-clear-breakpoint") {
      if (exitCode === 0) this.debuggerBreakpoints.delete(breakpointAddress);
      this.status =
        exitCode === 0
          ? `Breakpoint cleared at ${formatDebuggerAddress(breakpointAddress)}`
          : "Could not clear breakpoint";
    } else {
      this.status =
        exitCode === 0
          ? `Paused at ${formatDebuggerAddress(this.debuggerAddressValue)}`
          : `Debugger stopped with status ${String(exitCode)}`;
    }
    if (/\b(?:Faulted|Halted)\s+at\b/iu.test(output)) {
      this.debuggerActiveValue = false;
    }
    this.outputVisible = false;
    this.debuggerVisible = true;
    return this.screen();
  }

  completeSave(
    closeAfter: boolean,
    savedFileName?: string,
    savedDisplayName?: string,
  ): QBasicSessionResult {
    const completed = this.editor.completeSave(
      closeAfter,
      savedFileName,
      savedDisplayName,
    );
    if (completed.kind === "continue" && this.pendingAfterSave !== undefined) {
      const command = this.pendingAfterSave;
      this.pendingAfterSave = undefined;
      return this.command(command);
    }
    this.pendingAfterSave = undefined;
    return this.transform(completed);
  }

  failSave(detail: string): QBasicSessionResult {
    this.pendingAfterSave = undefined;
    return this.transform(this.editor.failSave(detail));
  }

  offerSaveDecision(
    kind: "external-change" | "replace",
    request: Extract<EditorResult, { readonly kind: "save" }>,
    resolvedFileName: string,
    targetSnapshot?: string,
  ): QBasicSessionResult {
    return this.transform(
      this.editor.offerSaveDecision(
        kind,
        request,
        resolvedFileName,
        targetSnapshot,
      ),
    );
  }

  completeOpen(
    fileName: string,
    contents: string,
    displayName?: string,
  ): QBasicSessionResult {
    return this.transform(
      this.editor.completeOpen(fileName, contents, displayName),
    );
  }

  failOpen(detail: string): QBasicSessionResult {
    return this.transform(this.editor.failOpen(detail));
  }

  completeProgramList(fileName: string): QBasicSessionResult {
    this.programListPathValue = fileName;
    this.programListInput = "";
    this.modeValue = "editing";
    this.lastBuildStaleValue = true;
    this.status = `Program List: ${fileName}`;
    return this.continue();
  }

  failProgramList(detail: string): QBasicSessionResult {
    this.modeValue = "program-list";
    this.status = `Program List failed: ${detail}`;
    return this.continue();
  }

  recordSuccessfulArtifact(path: string): void {
    this.lastArtifactPathValue = path;
    this.lastArtifactOwnerFile = this.editor.fileName;
    this.lastBuildStaleValue = false;
  }

  invalidateBuild(): void {
    this.lastBuildStaleValue = true;
  }

  resize(width: number, height: number): EditorScreen {
    this.editor.resize(width, height);
    return this.screen();
  }

  beginKeyBatch(): void {
    if (this.screenBatch !== undefined) {
      throw new Error("DOS IDE key batch is already active");
    }
    const previous = this.lastRenderedScreen ?? this.screen();
    this.editor.beginKeyBatch();
    this.screenBatch = previous;
  }

  endKeyBatch(): EditorScreen {
    if (this.screenBatch === undefined) {
      throw new Error("DOS IDE key batch is not active");
    }
    const finalScreen = this.editor.endKeyBatch();
    this.screenBatch = undefined;
    if (this.options.editorMode === true) {
      this.lastRenderedScreen = finalScreen;
      return finalScreen;
    }
    return this.screen();
  }

  screen(): EditorScreen {
    if (this.screenBatch !== undefined) return this.screenBatch;
    const base = this.editor.screen();
    if (this.options.editorMode === true) {
      this.lastRenderedScreen = base;
      return base;
    }
    const rows = base.rows.map((source) => source.map((cell) => ({ ...cell })));
    const width = base.rows[0]?.length ?? 51;
    rows[0] = row(
      this.menuBarText,
      width,
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    if (this.editor.mode === "editing") {
      rows[rows.length - 1] = row(
        this.workBenchStatus(),
        width,
        dosTuiColor.white,
        dosTuiColor.status,
      );
    }
    if (this.viewState.primary === "output") this.drawOutput(rows);
    else if (this.viewState.primary === "debugger") this.drawDebugger(rows);
    if (this.viewState.overlay === "menu") {
      this.drawActiveMenuHeading(rows);
      this.drawMenu(rows);
    }
    if (this.viewState.overlay === "help") this.drawHelp(rows);
    if (this.viewState.overlay === "about") this.drawAbout(rows);
    if (this.viewState.overlay === "program-list") this.drawProgramList(rows);
    if (this.viewState.overlay === "welcome") this.drawWelcome(rows);
    const screen = {
      cursor:
        this.viewState.primary !== "source" || this.viewState.overlay !== "none"
          ? { x: 1, y: 1 }
          : base.cursor,
      rows,
    };
    this.lastRenderedScreen = screen;
    return screen;
  }

  key(key: string): QBasicSessionResult {
    if (this.welcomeVisible) {
      if (key === "Enter" || key === "Escape" || key === "F1") {
        this.welcomeVisible = false;
        if (key === "F1") {
          this.modeValue = "help";
          this.status = "WorkBench Help";
        } else {
          this.status = "Ready";
        }
      }
      return this.continue();
    }
    if (this.options.editorMode === true) {
      return this.transform(this.editor.key(key));
    }
    if (this.modeValue === "program-list") return this.programListKey(key);
    if (this.modeValue === "help" || this.modeValue === "about") {
      if (key === "Escape" || key === "Enter" || key === "F1") {
        this.modeValue = "editing";
        this.status = "Ready";
      } else {
        this.status = "F1, Enter, or Esc closes this window";
      }
      return this.continue();
    }
    if (this.modeValue === "menu") return this.menuKey(key);
    if (this.editor.mode !== "editing") {
      return this.transform(this.editor.key(key));
    }
    if (key === "F4") return this.toggleOutput();
    if (this.outputVisible) {
      if (key === "Escape") return this.toggleOutput();
      if (key === "F1") return this.openHelp();
      if (key === "F10") return this.openMenu("file");
      if (key === "F3") return this.navigateDiagnostic(1);
      if (key === "Shift+F3") return this.navigateDiagnostic(-1);
      const viewportLines = this.editor.height - 4;
      const maximumTop = Math.max(0, this.outputRows.length - viewportLines);
      if (key === "ArrowUp") this.outputTop -= 1;
      else if (key === "ArrowDown") this.outputTop += 1;
      else if (key === "PageUp") this.outputTop -= viewportLines;
      else if (key === "PageDown") this.outputTop += viewportLines;
      else if (key === "Home") this.outputTop = 0;
      else if (key === "End") this.outputTop = maximumTop;
      else {
        const outputAlternate = /^Alt\+(.+)$/iu.exec(key)?.[1]?.toLowerCase();
        if (outputAlternate !== undefined) {
          const menu = this.visibleMenuOrder.find(
            (name) =>
              workBenchMenuLabels[name][0]?.toLowerCase() === outputAlternate,
          );
          if (menu !== undefined) return this.openMenu(menu);
        }
        this.status = "Output is read-only; arrows scroll and Esc closes it";
        return this.continue();
      }
      this.outputTop = Math.max(0, Math.min(maximumTop, this.outputTop));
      this.status = `Output line ${String(this.outputTop + 1)}`;
      return this.continue();
    }
    if (this.debuggerVisible && key === "Escape") {
      this.debuggerVisible = false;
      this.status = this.debuggerActiveValue
        ? "Debugger paused; F5 continues"
        : "Ready";
      return this.continue();
    }
    if (key === "F1") return this.openHelp();
    if (
      this.commandCatalog.sourceRunOnly &&
      (key === "F5" || key === "Ctrl+F5" || key === "Shift+F5")
    ) {
      return this.command("build-run");
    }
    if (
      this.commandCatalog.sourceRunOnly &&
      (key === "F7" || key === "F8" || key === "F9")
    ) {
      this.status =
        "CS QBASIC runs source directly; no build artifact is created";
      return this.continue();
    }
    if (key === "Alt+F7") return this.command("compile-file");
    if (key === "Ctrl+F7") return this.command("rebuild");
    if (key === "F5") {
      return this.command(
        this.debuggerActiveValue ? "debug-continue" : "debug-start",
      );
    }
    if (key === "Ctrl+F5") return this.command("run");
    if (key === "F7") return this.command("build");
    if (key === "Shift+F5") {
      return this.command(
        this.debuggerActiveValue ? "debug-stop" : "build-run",
      );
    }
    if (key === "F8") {
      if (this.debuggerActiveValue) return this.command("debug-step");
      this.status = "Press F5 to start debugging";
      return this.continue();
    }
    if (key === "F9") {
      if (!this.debuggerActiveValue) {
        this.status = "Press F5 to start debugging";
        return this.continue();
      }
      return this.command(
        this.debuggerBreakpoints.has(this.debuggerAddressValue)
          ? "debug-clear-breakpoint"
          : "debug-set-breakpoint",
      );
    }
    if (key === "F10") return this.openMenu("file");
    const alternate = /^Alt\+(.+)$/iu.exec(key)?.[1]?.toLowerCase();
    if (alternate !== undefined) {
      const menu = this.visibleMenuOrder.find(
        (name) => workBenchMenuLabels[name][0]?.toLowerCase() === alternate,
      );
      if (menu !== undefined) return this.openMenu(menu);
    }
    if (this.debuggerVisible) {
      this.status = "Debugger is read-only; Esc returns to source";
      return this.continue();
    }
    return this.transform(this.editor.key(key));
  }

  mouse(event: TerminalMouseEvent): QBasicSessionResult {
    if (event.action === "up") {
      this.pressedButtons.delete(event.button);
      if (event.button === 0) this.primaryDrag = false;
      return this.continue();
    }
    if (event.action === "move") {
      if (this.primaryDrag && this.pressedButtons.has(0)) {
        return this.transform(this.editor.pointerMove(event.x, event.y));
      }
      return this.continue();
    }
    this.pressedButtons.add(event.button);
    if (event.button !== 0) {
      this.primaryDrag = false;
      this.status = "Only the primary button is used by the WorkBench";
      return this.continue();
    }
    if (this.options.editorMode === true) {
      this.primaryDrag = event.y >= 3 && event.y <= this.editor.height - 2;
      return this.transform(this.editor.pointerDown(event.x, event.y));
    }
    if (this.modeValue === "program-list") {
      this.primaryDrag = false;
      this.status = "Program List dialog: use Enter or Esc";
      return this.continue();
    }
    if (this.editor.mode !== "editing") {
      this.primaryDrag = false;
      return this.transform(this.editor.pointerDown(event.x, event.y));
    }
    this.primaryDrag = false;
    if (this.welcomeVisible) {
      this.welcomeVisible = false;
      this.status = "Ready";
      if (event.y === 1) {
        const heading = this.workBenchHeadingAt(event.x);
        if (heading !== undefined) return this.openMenu(heading);
      }
      return this.continue();
    }
    if (this.modeValue === "help" || this.modeValue === "about") {
      this.modeValue = "editing";
      this.status = "Ready";
      return this.continue();
    }
    if (event.y === 1) {
      const heading = this.workBenchHeadingAt(event.x);
      if (heading === undefined) {
        this.modeValue = "editing";
        return this.continue();
      }
      return this.openMenu(heading);
    }
    if (this.modeValue === "menu") {
      const box = this.menuBox();
      const itemIndex = event.y - 3;
      const column = event.x - 1;
      if (
        column >= box.left &&
        column < box.left + box.width &&
        itemIndex >= 0 &&
        itemIndex < box.entries.length
      ) {
        this.menuItemIndex = itemIndex;
        return this.applyMenuAction(box.entries[this.menuItemIndex]!.action);
      }
      this.modeValue = "editing";
      this.status = "Ready";
      return this.continue();
    }
    if (this.outputVisible) {
      this.status = "Output window is read-only; press Esc to close it";
      return this.continue();
    }
    if (this.debuggerVisible) {
      this.status = "Debugger is read-only; press Esc to return to source";
      return this.continue();
    }
    this.primaryDrag = event.y >= 3 && event.y <= this.editor.height - 2;
    return this.transform(this.editor.pointerDown(event.x, event.y));
  }

  private artifactDisplayName(): string {
    if (this.product === "qbasic") return "transient source run";
    const display =
      this.displayName.toUpperCase() === "UNTITLED"
        ? `UNTITLED.${this.language === "asm" ? "ASM" : this.language === "cpp" ? "CPP" : this.language === "basic" ? "BAS" : "C"}`
        : this.displayName;
    const slash = Math.max(display.lastIndexOf("\\"), display.lastIndexOf("/"));
    const dot = display.lastIndexOf(".");
    return `${dot > slash ? display.slice(0, dot) : display}.CSX`;
  }

  private workBenchStatus(): string {
    if (this.modeValue === "menu") {
      return " F1=Help  Enter=Execute  Esc=Cancel  Arrow=Next Item";
    }
    if (
      this.welcomeVisible ||
      this.modeValue === "help" ||
      this.modeValue === "about"
    ) {
      return " F1=Help  Enter=Execute  Esc=Cancel";
    }
    if (this.modeValue === "program-list") {
      return " Enter=Set Program List  Esc=Cancel  Backspace=Edit";
    }
    if (this.outputVisible) {
      const detail =
        this.status === "Output window" ||
        this.status.startsWith("Output line ") ||
        this.status.includes("read-only")
          ? ""
          : `${this.status}  `;
      return ` ${detail}F1=Help  F3=Next Error  Esc=Cancel  Arrow=Scroll`;
    }
    if (this.debuggerVisible) {
      const detail =
        this.status === "Debugger window" || this.status.includes("read-only")
          ? ""
          : `${this.status}  `;
      return ` ${detail}F1=Help  F5=Continue  F8=Trace  F9=Breakpoint  Esc=Cancel`;
    }
    const identity = productIdentity(this.product, this.targetName);
    const left =
      this.status === "Ready"
        ? this.product === "qbasic"
          ? `${identity.name}  <F1=Help> <F5=Run> Press ALT to activate menus`
          : `${identity.name}  <F1=Help> <F7=Build> Press ALT to activate menus`
        : this.status;
    const right = this.editor.statusPosition;
    const available = this.editor.width - [...right].length - 2;
    if (available <= 0) return right.slice(0, this.editor.width);
    return ` ${[...left].slice(0, available).join("").padEnd(available)} ${right}`;
  }

  private continue(): QBasicSessionResult {
    return { kind: "continue", screen: this.screen() };
  }

  private transform(result: EditorResult): QBasicSessionResult {
    if (
      this.editor.modified ||
      (this.lastArtifactOwnerFile !== undefined &&
        this.lastArtifactOwnerFile !== this.editor.fileName)
    ) {
      this.lastBuildStaleValue = true;
    }
    if (this.screenBatch !== undefined) {
      return { ...result, screen: this.screenBatch };
    }
    if (this.options.editorMode === true) {
      this.lastRenderedScreen = result.screen;
      return result;
    }
    return { ...result, screen: this.screen() };
  }

  private command(command: DosIdeCommand): QBasicSessionResult {
    if (!this.commandCatalog.supportedCommands.includes(command)) {
      this.status = this.commandCatalog.sourceRunOnly
        ? "CS QBASIC runs source directly; no build artifact is created"
        : this.closeLabel + " does not support " + command;
      return this.continue();
    }
    if (
      (command === "build" ||
        command === "build-run" ||
        command === "compile-file" ||
        command === "debug-start" ||
        command === "rebuild") &&
      (this.editor.modified || this.displayName.toUpperCase() === "UNTITLED")
    ) {
      this.pendingAfterSave = command;
      return this.transform(
        this.editor.invoke(
          this.displayName.toUpperCase() === "UNTITLED" ? "save-as" : "save",
        ),
      );
    }
    this.modeValue = "editing";
    this.outputVisible = false;
    this.status =
      command === "build"
        ? "Building..."
        : command === "compile-file"
          ? "Compiling current file..."
          : command === "rebuild"
            ? "Rebuilding all..."
            : command === "clean"
              ? "Cleaning project-owned outputs..."
              : command === "run"
                ? "Running last build..."
                : command === "build-run"
                  ? "Building and running..."
                  : command === "debug-start"
                    ? "Building and starting debugger..."
                    : command === "debug-continue"
                      ? "Continuing..."
                      : command === "debug-step"
                        ? "Tracing one instruction..."
                        : command === "debug-stop"
                          ? "Stopping debugger..."
                          : command === "debug-set-breakpoint"
                            ? "Setting breakpoint..."
                            : "Clearing breakpoint...";
    return { command, kind: "command", screen: this.screen() };
  }

  private toggleOutput(): QBasicSessionResult {
    this.modeValue = "editing";
    this.outputVisible = !this.outputVisible;
    this.debuggerVisible = false;
    this.status = this.outputVisible ? "Output window" : "Ready";
    return this.continue();
  }

  private navigateDiagnostic(direction: -1 | 1): QBasicSessionResult {
    if (this.outputDiagnostics.length === 0) {
      this.status = "No source diagnostics in the output";
      return this.continue();
    }
    this.outputDiagnosticIndex =
      (this.outputDiagnosticIndex + direction + this.outputDiagnostics.length) %
      this.outputDiagnostics.length;
    const diagnostic = this.outputDiagnostics[this.outputDiagnosticIndex]!;
    this.outputTop = diagnostic.outputLine;
    this.status =
      `${direction > 0 ? "Next" : "Previous"} error: ` +
      `${diagnostic.fileName}(${String(diagnostic.line)},${String(diagnostic.column)})`;
    return {
      column: diagnostic.column,
      fileName: diagnostic.fileName,
      kind: "diagnostic",
      line: diagnostic.line,
      screen: this.screen(),
    };
  }

  completeDiagnostic(
    fileName: string,
    contents: string | undefined,
    displayName: string,
    line: number,
    column: number,
  ): QBasicSessionResult {
    if (fileName !== this.editor.fileName) {
      if (this.editor.modified) {
        this.status =
          "Save or discard changes before opening another source file";
        return this.continue();
      }
      if (contents === undefined) {
        this.status = "Diagnostic source could not be read";
        return this.continue();
      }
      this.editor.completeOpen(fileName, contents, displayName);
    }
    this.outputVisible = false;
    this.debuggerVisible = false;
    this.modeValue = "editing";
    return this.transform(this.editor.goTo(line, column));
  }

  failDiagnostic(detail: string): QBasicSessionResult {
    this.status = `Diagnostic navigation failed: ${detail}`;
    return this.continue();
  }

  private showDebugger(): QBasicSessionResult {
    this.modeValue = "editing";
    this.outputVisible = false;
    this.debuggerVisible = true;
    this.status = this.debuggerActiveValue
      ? `Debugger paused at ${formatDebuggerAddress(this.debuggerAddressValue)}`
      : "No active debugger; press F5 to start";
    return this.continue();
  }

  private openHelp(): QBasicSessionResult {
    this.outputVisible = false;
    this.debuggerVisible = false;
    this.modeValue = "help";
    this.status = "WorkBench Help";
    return this.continue();
  }

  private openMenu(name: WorkBenchMenuName): QBasicSessionResult {
    this.outputVisible = false;
    this.menuIndex = this.visibleMenuOrder.indexOf(name);
    this.menuItemIndex = 0;
    this.modeValue = "menu";
    this.status = `${workBenchMenuLabels[name]} menu`;
    return this.continue();
  }

  private beginProgramList(): QBasicSessionResult {
    this.modeValue = "program-list";
    this.programListInput =
      this.programListPathValue ??
      this.fileName.replace(/\.[^\\/.]+$/u, ".CSP");
    this.status = "Set Program List";
    return this.continue();
  }

  private programListKey(key: string): QBasicSessionResult {
    if (key === "Escape") {
      this.modeValue = "editing";
      this.status = "Program List unchanged";
      return this.continue();
    }
    if (key === "Backspace") {
      this.programListInput = [...this.programListInput].slice(0, -1).join("");
      return this.continue();
    }
    if (key === "Enter") {
      const fileName = this.programListInput.trim();
      if (fileName.length === 0) {
        this.status = "Program List path is required";
        return this.continue();
      }
      this.modeValue = "editing";
      return { fileName, kind: "program-list", screen: this.screen() };
    }
    if ([...key].length === 1 && [...this.programListInput].length < 128) {
      this.programListInput += key;
    }
    return this.continue();
  }

  private menuKey(key: string): QBasicSessionResult {
    const entries = this.activeMenuEntries();
    if (key === "Escape") {
      this.modeValue = "editing";
      this.status = "Ready";
      return this.continue();
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const direction = key === "ArrowLeft" ? -1 : 1;
      const order = this.visibleMenuOrder;
      this.menuIndex =
        (this.menuIndex + direction + order.length) % order.length;
      this.menuItemIndex = 0;
      this.status = `${workBenchMenuLabels[order[this.menuIndex]!]} menu`;
      return this.continue();
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      const direction = key === "ArrowUp" ? -1 : 1;
      this.menuItemIndex =
        (this.menuItemIndex + direction + entries.length) % entries.length;
      return this.continue();
    }
    if (key === "Enter") {
      return this.applyMenuAction(entries[this.menuItemIndex]!.action);
    }
    const letter = [...key.toLowerCase()];
    if (letter.length === 1) {
      const entry = entries.find(
        ({ label, mnemonic }) =>
          (mnemonic ?? label[0])?.toLowerCase() === letter[0],
      );
      if (entry !== undefined) return this.applyMenuAction(entry.action);
      const match = this.visibleMenuOrder.find(
        (name) => workBenchMenuLabels[name][0]?.toLowerCase() === letter[0],
      );
      if (match !== undefined) return this.openMenu(match);
    }
    return this.continue();
  }

  private applyMenuAction(action: WorkBenchAction): QBasicSessionResult {
    this.modeValue = "editing";
    if (isDosEditAction(action)) {
      this.debuggerVisible = false;
      return this.transform(this.editor.invoke(action));
    }
    if (action === "output") return this.toggleOutput();
    if (action === "next-error") return this.navigateDiagnostic(1);
    if (action === "previous-error") return this.navigateDiagnostic(-1);
    if (action === "debug-show") return this.showDebugger();
    if (action === "build") return this.command("build");
    if (action === "compile-file") return this.command("compile-file");
    if (action === "rebuild") return this.command("rebuild");
    if (action === "clean") return this.command("clean");
    if (action === "set-program-list") return this.beginProgramList();
    if (action === "run-last") return this.command("run");
    if (action === "build-run") return this.command("build-run");
    if (action === "debug-start") return this.command("debug-start");
    if (action === "debug-continue") {
      return this.command(
        this.debuggerActiveValue ? "debug-continue" : "debug-start",
      );
    }
    if (action === "debug-step") {
      if (this.debuggerActiveValue) return this.command("debug-step");
      this.status = "Press F5 to start debugging";
      return this.continue();
    }
    if (
      action === "debug-set-breakpoint" ||
      action === "debug-clear-breakpoint"
    ) {
      if (!this.debuggerActiveValue) {
        this.status = "Press F5 to start debugging";
        return this.continue();
      }
      return this.command(action);
    }
    if (action === "debug-stop") {
      if (this.debuggerActiveValue) return this.command("debug-stop");
      this.status = "No active debugger";
      return this.continue();
    }
    if (action === "workbench-help") return this.openHelp();
    this.modeValue = "about";
    this.status = "About";
    return this.continue();
  }

  private activeMenuEntries(): readonly WorkBenchMenuEntry[] {
    const name = this.visibleMenuOrder[this.menuIndex]!;
    if (this.commandCatalog.sourceRunOnly && name === "view") {
      return workBenchMenus.view.filter(
        ({ action }) => action !== "debug-show",
      );
    }
    if (this.commandCatalog.sourceRunOnly && name === "run") {
      return [
        {
          action: "build-run",
          label: "Run / Restart Source",
          mnemonic: "r",
          shortcut: "F5",
        },
        { action: "dos-command", label: "DOS Command...", shortcut: "" },
        {
          action: "repeat-dos-command",
          label: "Repeat DOS Command",
          shortcut: "",
        },
        {
          action: "insert-command-output",
          label: "Insert Command Output...",
          shortcut: "",
        },
      ];
    }
    return workBenchMenus[name];
  }

  private menuBox(): {
    readonly entries: readonly WorkBenchMenuEntry[];
    readonly labels: readonly string[];
    readonly left: number;
    readonly width: number;
  } {
    const entries = this.activeMenuEntries();
    const labels = entries.map(({ label, shortcut }) =>
      shortcut.length === 0 ? label : `${label}  ${shortcut}`,
    );
    const width = Math.min(
      this.editor.width,
      Math.max(...labels.map((label) => [...label].length)) + 4,
    );
    const name = this.visibleMenuOrder[this.menuIndex]!;
    const headingStart = this.menuBarText
      .toLowerCase()
      .indexOf(workBenchMenuLabels[name].toLowerCase());
    const left = Math.max(
      0,
      Math.min(headingStart - 1, this.editor.width - width),
    );
    return { entries, labels, left, width };
  }

  private get visibleMenuOrder(): readonly WorkBenchMenuName[] {
    return this.commandCatalog.menuOrder;
  }

  private get menuBarText(): string {
    const leftMenus = this.visibleMenuOrder.filter((name) => name !== "help");
    const left = `  ${leftMenus
      .map((name) => workBenchMenuLabels[name])
      .join(" ")}`;
    const help = "Help ";
    return `${left.padEnd(Math.max(left.length, this.editor.width - help.length))}${help}`.slice(
      0,
      this.editor.width,
    );
  }

  private drawActiveMenuHeading(rows: HighlightedCell[][]): void {
    const name = this.visibleMenuOrder[this.menuIndex]!;
    const label = workBenchMenuLabels[name];
    const start = this.menuBarText.toLowerCase().indexOf(label.toLowerCase());
    overlay(
      rows,
      0,
      Math.max(0, start),
      label,
      dosTuiColor.white,
      dosTuiColor.black,
    );
  }

  private workBenchHeadingAt(x: number): WorkBenchMenuName | undefined {
    const column = x - 1;
    return this.visibleMenuOrder.find((name) => {
      const label = workBenchMenuLabels[name].toLowerCase();
      const start = this.menuBarText.toLowerCase().indexOf(label);
      return column >= start && column < start + label.length;
    });
  }

  private drawMenu(rows: HighlightedCell[][]): void {
    const { entries, labels, left, width } = this.menuBox();
    const horizontal = singleLineBox.horizontal.repeat(width - 2);
    overlay(
      rows,
      1,
      left,
      `${singleLineBox.topLeft}${horizontal}${singleLineBox.topRight}`,
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    for (const [index] of entries.entries()) {
      const selected = index === this.menuItemIndex;
      const label = labels[index] ?? "";
      const text = `${singleLineBox.vertical} ${label.padEnd(width - 4).slice(0, width - 4)} ${singleLineBox.vertical}`;
      overlay(
        rows,
        index + 2,
        left,
        text,
        selected ? dosTuiColor.chrome : dosTuiColor.black,
        selected ? dosTuiColor.black : dosTuiColor.chrome,
      );
    }
    const bottom = entries.length + 2;
    overlay(
      rows,
      bottom,
      left,
      `${singleLineBox.bottomLeft}${horizontal}${singleLineBox.bottomRight}`,
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    drawDosTuiShadow(rows, 1, left, width, bottom);
  }

  private drawOutput(rows: HighlightedCell[][]): void {
    const width = rows[0]?.length ?? 0;
    const height = rows.length;
    for (let y = 2; y < Math.max(2, height - 2); y += 1) {
      rows[y] = row("", width, dosTuiColor.white, dosTuiColor.document);
    }
    const lines =
      this.outputRows.length === 0 ? ["(No program output)"] : this.outputRows;
    for (
      let index = 0;
      index < Math.min(lines.length - this.outputTop, height - 4);
      index += 1
    ) {
      rows[index + 2] = row(
        lines[this.outputTop + index] ?? "",
        width,
        dosTuiColor.white,
        dosTuiColor.document,
      );
    }
  }

  private drawProgramList(rows: HighlightedCell[][]): void {
    const width = rows[0]?.length ?? 0;
    const available = Math.max(1, Math.min(54, width - 8));
    const visible = [...this.programListInput].slice(-available).join("");
    this.drawDialog(rows, "Set Program List", [
      "Enter a bounded CS-DOS .CSP guest path:",
      visible,
      this.status.startsWith("Program List failed:")
        ? this.status
        : "Enter accepts; Esc keeps the current Program List",
    ]);
  }

  private drawDebugger(rows: HighlightedCell[][]): void {
    const width = rows[0]?.length ?? 0;
    const height = rows.length;
    for (let y = 2; y < Math.max(2, height - 2); y += 1) {
      rows[y] = row("", width, dosTuiColor.white, dosTuiColor.document);
    }
    const marker = this.debuggerBreakpoints.has(this.debuggerAddressValue)
      ? " breakpoint"
      : "";
    const lines = [
      `CS Debugger 1.0 | EIP=${formatDebuggerAddress(this.debuggerAddressValue)}${marker}`,
      ...this.debuggerOutput.replaceAll("\r\n", "\n").split("\n"),
    ];
    for (
      let index = 0;
      index < Math.min(lines.length, height - 4);
      index += 1
    ) {
      rows[index + 2] = row(
        lines[index] ?? "",
        width,
        dosTuiColor.white,
        dosTuiColor.document,
      );
    }
  }

  private drawHelp(rows: HighlightedCell[][]): void {
    this.drawDialog(
      rows,
      "WorkBench Help",
      this.product === "qbasic"
        ? [
            "F2 / Ctrl+S       Save BASIC source",
            "F4                Show bounded program output",
            "F5 / Ctrl+F5     Run / restart source transiently",
            "F7 / F8 / F9     No build artifact or debugger",
            "Ctrl+O            Browse A: or C: files",
            "F10 / Alt+letter  Open menus",
            "F1 / Enter / Esc  Close Help",
          ]
        : [
            "F2 / Ctrl+S       Save source",
            "F3 / Shift+F3    Next / previous compiler error",
            "F4                Show build/program output",
            "F5                Start / continue debugger",
            "Ctrl+F5           Run exact last .CSX build",
            "F7 / Ctrl+F7     Build / rebuild Program List",
            "F8 / F9          Trace / toggle breakpoint",
            "Shift+F5          Build/run, or stop debugger",
            "Make menu         Set Program List or Clean",
            "F10 / Alt+letter  Open menus",
            "F1 / Enter / Esc  Close Help",
          ],
    );
  }

  private drawAbout(rows: HighlightedCell[][]): void {
    const identity = productIdentity(this.product, this.targetName);
    this.drawDialog(rows, `About ${identity.name}`, [
      identity.description,
      `Target: ${this.targetName}`,
      "CS-DOS 1.0 development environment",
      "Enter or Esc closes this window",
    ]);
  }

  private drawDialog(
    rows: HighlightedCell[][],
    title: string,
    body: readonly string[],
  ): void {
    const screenWidth = rows[0]?.length ?? 0;
    const width = Math.max(30, Math.min(62, screenWidth - 4));
    const left = Math.max(0, Math.floor((screenWidth - width) / 2));
    const top = Math.max(1, Math.floor((rows.length - body.length - 2) / 2));
    const innerWidth = Math.max(1, width - 2);
    overlay(
      rows,
      top,
      left,
      `${singleLineBox.topLeft}${` ${title} `
        .padEnd(innerWidth, singleLineBox.horizontal)
        .slice(0, innerWidth)}${singleLineBox.topRight}`,
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    for (const [index, source] of body.entries()) {
      overlay(
        rows,
        top + index + 1,
        left,
        `${singleLineBox.vertical}${source.padEnd(innerWidth).slice(0, innerWidth)}${singleLineBox.vertical}`,
        dosTuiColor.black,
        dosTuiColor.chrome,
      );
    }
    overlay(
      rows,
      top + body.length + 1,
      left,
      `${singleLineBox.bottomLeft}${singleLineBox.horizontal.repeat(innerWidth)}${singleLineBox.bottomRight}`,
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    const bottom = top + body.length + 1;
    drawDosTuiShadow(rows, top, left, width, bottom);
  }

  private drawWelcome(rows: HighlightedCell[][]): void {
    const identity = productIdentity(this.product, this.targetName);
    this.drawDialog(rows, identity.name, [
      identity.description,
      `Target: ${this.targetName}`,
      "",
      "Enter  Continue    F1  Help",
    ]);
  }
}

/** Backward-compatible class name for the DOS-only CS QBASIC frontend. */
export class QBasicSession extends DosIdeSession {}

function productIdentity(
  product: DosIdeProduct,
  targetName: string,
): {
  readonly description: string;
  readonly name: string;
} {
  if (product === "cs-asm") {
    return {
      description: `${targetName} Assembly WorkBench`,
      name: csAsmProductName,
    };
  }
  if (product === "cs-cpp") {
    return {
      description: `${targetName} Programmer's WorkBench`,
      name: csCFamilyProductName,
    };
  }
  return {
    description: "QBasic-compatible DOS IDE",
    name: csQBasicProductName,
  };
}

function debuggerAddressFrom(output: string): number | undefined {
  const matches = [
    ...output.matchAll(
      /(?:EIP=|(?:Paused|Halted|Faulted|Continue limit reached)\s+at\s+|^)([0-9A-F]{8})(?=\s|$)/gimu,
    ),
  ];
  const value = matches.at(-1)?.[1];
  if (value === undefined) return undefined;
  const address = Number.parseInt(value, 16);
  return Number.isSafeInteger(address) ? address : undefined;
}

function formatDebuggerAddress(address: number): string {
  return address.toString(16).toUpperCase().padStart(8, "0");
}

function isDosEditAction(action: WorkBenchAction): action is DosEditAction {
  return editActions.includes(action as DosEditAction);
}

export function parseTerminalMouseEvent(value: string): TerminalMouseEvent {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new RangeError("Invalid terminal mouse event");
  }
  if (typeof decoded !== "object" || decoded === null)
    throw new RangeError("Invalid terminal mouse event");
  const event = decoded as Record<string, unknown>;
  if (
    (event.action !== "down" &&
      event.action !== "move" &&
      event.action !== "up") ||
    (event.button !== 0 && event.button !== 1 && event.button !== 2) ||
    !Number.isSafeInteger(event.sequence) ||
    (event.sequence as number) < 0 ||
    !Number.isSafeInteger(event.x) ||
    (event.x as number) < 1 ||
    (event.x as number) > 80 ||
    !Number.isSafeInteger(event.y) ||
    (event.y as number) < 1 ||
    (event.y as number) > 25
  ) {
    throw new RangeError("Invalid terminal mouse event");
  }
  return event as unknown as TerminalMouseEvent;
}

function row(
  value: string,
  width: number,
  foreground: number,
  background: number,
): HighlightedCell[] {
  const result = [...value].slice(0, width).map((character) => ({
    background,
    character,
    foreground,
  }));
  while (result.length < width)
    result.push({ background, character: " ", foreground });
  return result;
}

function overlay(
  rows: HighlightedCell[][],
  y: number,
  x: number,
  value: string,
  foreground: number,
  background: number,
): void {
  const target = rows[y];
  if (target === undefined) return;
  for (const [offset, character] of [...value].entries()) {
    if (x + offset < 0 || x + offset >= target.length) continue;
    target[x + offset] = { background, character, foreground };
  }
}

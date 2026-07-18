import {
  BoundedEditorKeyQueue,
  editorKeyFromKeyboardEvent,
  hasCopySelection,
  insertPastedCommand,
  isEditorTerminalScreen,
  keyboardLockStatesFromEvent,
} from "/terminal-input.js";
import { manualChapters, manualParts, searchManual } from "/manual.js";
import { calculateFixedGridFontSize } from "/terminal-layout.js";
import { WebFloppyDriveAudio } from "/floppy-audio.js";

const palette = [
  "#f0f0f0",
  "#f2b233",
  "#e57fd8",
  "#99b2f2",
  "#dede6c",
  "#7fcc19",
  "#f2b2cc",
  "#4c4c4c",
  "#999999",
  "#4c99b2",
  "#b266e5",
  "#3366cc",
  "#7f664c",
  "#57a64e",
  "#cc4c4c",
  "#111111",
];
const dosTuiPalette = [...palette];
dosTuiPalette[0] = "#AAAAAA";
dosTuiPalette[8] = "#AAAAAA";
dosTuiPalette[9] = "#00AAAA";
dosTuiPalette[11] = "#0000AA";
dosTuiPalette[15] = "#000000";
const manualApplicabilityLabels = {
  "cs-linux": "CS-Linux",
  "cs-dos": "CS-DOS",
  cs486dx: "CS486DX",
  cs486dx2: "CS486DX2",
  cs386sx: "CS386SX",
};
const manualKindLabels = {
  tutorial: "Tutorial",
  "how-to": "How-to",
  concept: "Concept",
  reference: "Reference",
};
const manualSearchTypeLabels = {
  command: "Command",
  api: "API",
  instruction: "Instruction",
  error: "Error",
  concept: "Concept",
};

const elements = {
  computerName: document.querySelector("#computer-name"),
  computerId: document.querySelector("#computer-id"),
  statusLight: document.querySelector("#status-light"),
  statusText: document.querySelector("#status-text"),
  terminalStage: document.querySelector("#terminal-stage"),
  terminalOutput: document.querySelector("#terminal-output"),
  terminalScreen: document.querySelector("#terminal-screen"),
  terminalSize: document.querySelector("#terminal-size"),
  commandForm: document.querySelector("#command-form"),
  commandInput: document.querySelector("#command-input"),
  completionMenu: document.querySelector("#completion-menu"),
  takeControlButton: document.querySelector("#take-control-button"),
  reconnectButton: document.querySelector("#reconnect-button"),
  lifecycleState: document.querySelector("#lifecycle-state"),
  errorDialog: document.querySelector("#error-dialog"),
  errorMessage: document.querySelector("#error-message"),
  errorTitle: document.querySelector("#error-title"),
  handoffForm: document.querySelector("#handoff-form"),
  handoffCode: document.querySelector("#handoff-code"),
  errorDismiss: document.querySelector("#error-dismiss"),
  inputState: document.querySelector("#input-state"),
  accessState: document.querySelector("#access-state"),
  capsLockIndicator: document.querySelector("#caps-lock-indicator"),
  numLockIndicator: document.querySelector("#num-lock-indicator"),
  scrollLockIndicator: document.querySelector("#scroll-lock-indicator"),
  copyButton: document.querySelector("#copy-button"),
  powerIndicator: document.querySelector("#power-indicator"),
  hddIndicator: document.querySelector("#hdd-indicator"),
  fddIndicator: document.querySelector("#fdd-indicator"),
  ejectButton: document.querySelector("#eject-button"),
  ejectFeedback: document.querySelector("#eject-feedback"),
  powerButton: document.querySelector("#power-button"),
  powerFeedback: document.querySelector("#power-feedback"),
  manualButton: document.querySelector("#manual-button"),
  manualDialog: document.querySelector("#manual-dialog"),
  manualToc: document.querySelector("#manual-toc"),
  manualPage: document.querySelector("#manual-page"),
  manualSearch: document.querySelector("#manual-search"),
  manualSearchStatus: document.querySelector("#manual-search-status"),
  manualPosition: document.querySelector("#manual-position"),
  manualPrevious: document.querySelector("#manual-previous"),
  manualNext: document.querySelector("#manual-next"),
};

const tokenStorageKey = "computer-system.web-terminal-token";
const codeStorageKey = "computer-system.web-terminal-code";
const hardwareTextColumns = 80;
const hardwareTextRows = 25;
const initialSearch = new URLSearchParams(location.search);
const queryCode = initialSearch.get("computer") ?? "";
const handoffRequested = initialSearch.get("handoff") === "1";
let token =
  location.hash.slice(1) || sessionStorage.getItem(tokenStorageKey) || "";
if (handoffRequested) {
  token = location.hash.slice(1);
  sessionStorage.removeItem(tokenStorageKey);
}
let connectionCode = /^[0-9]{4}$/u.test(queryCode)
  ? queryCode
  : localStorage.getItem(codeStorageKey) || "";
let streamGeneration = 0;
let reconnectGeneration = 0;
let sessionClosed = false;
let commandPending = false;
let completionPending = false;
let copyResetTimer = 0;
let ejectPending = false;
let floppyDriveState = "absent";
let powerPending = false;
let machineLifecycle = "unknown";
let takeoverPending = false;
let connectionState = "loading";
let accessMode = "unknown";
let editorActive = false;
let secretInput = false;
let editorKeyPending = false;
let editorInputGeneration = 0;
let mouseRequestPending = false;
let pendingMouseMove;
let mouseSequence = Date.now() * 1_000;
let historyCursor = 0;
let historyDraft = "";
let resizeFrame = 0;
let terminalRenderFrame = 0;
let pendingTerminalPayload;
let renderedTerminalGeometry = "";
let renderedTerminalMode = "";
let renderedTerminalRowElements = [];
let renderedTerminalRowSignatures = [];
let hardwareTextModePending = false;
let hardwareTextModeConfirmed = false;
let manualChapterIndex = 0;
let manualSectionId = "";
const commandHistory = [];
const editorKeyQueue = new BoundedEditorKeyQueue();
const mouseTransitionQueue = [];
const floppyAudio = new WebFloppyDriveAudio();

const unlockFloppyAudio = () => void floppyAudio.unlock();
window.addEventListener("pointerdown", unlockFloppyAudio, { passive: true });
window.addEventListener("keydown", unlockFloppyAudio);
window.addEventListener("keydown", updateKeyboardLockIndicators);
window.addEventListener("keyup", updateKeyboardLockIndicators);
window.addEventListener("blur", resetKeyboardLockIndicators);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) resetKeyboardLockIndicators();
});
window.addEventListener("pagehide", () => void floppyAudio.close(), {
  once: true,
});

if (location.hash.length > 1) sessionStorage.setItem(tokenStorageKey, token);
const stableUrl = new URL(location.href);
stableUrl.hash = "";
stableUrl.searchParams.delete("handoff");
window.history.replaceState(
  null,
  "",
  `${stableUrl.pathname}${stableUrl.search}`,
);

elements.commandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendLine();
});
elements.commandInput.addEventListener("keydown", (event) => {
  if (editorActive) {
    if (
      event.ctrlKey &&
      event.key.toLowerCase() === "c" &&
      hasCopySelection(elements.commandInput, window.getSelection())
    ) {
      return;
    }
    event.preventDefault();
    if (event.key === "Alt") {
      if (!event.repeat) queueEditorKeys(["F10"]);
      return;
    }
    const key = editorKeyFromKeyboardEvent(event);
    if (key !== undefined) queueEditorKeys([key]);
    return;
  }
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    void sendLine();
    return;
  }
  if (event.key === "Tab" && !event.isComposing) {
    event.preventDefault();
    if (!secretInput) void completeCommandLine();
    return;
  }
  if (event.ctrlKey) {
    const key = event.key.toLowerCase();
    if (key === "c") {
      if (hasCopySelection(elements.commandInput, window.getSelection()))
        return;
      event.preventDefault();
      void sendInput({ kind: "interrupt" });
      return;
    }
    if (key === "a" || key === "e") {
      event.preventDefault();
      const position = key === "a" ? 0 : elements.commandInput.value.length;
      elements.commandInput.setSelectionRange(position, position);
      return;
    }
    if (key === "u" || key === "k" || key === "w") {
      event.preventDefault();
      editCommandLine(key);
      return;
    }
    if (key === "d") {
      event.preventDefault();
      if (elements.commandInput.value.length === 0) void closeSession();
      else deleteAtCursor();
      return;
    }
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!secretInput) moveHistory(-1);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!secretInput) moveHistory(1);
  }
});
elements.commandInput.addEventListener("input", () => {
  hideCompletions();
  if (!secretInput && historyCursor === commandHistory.length) {
    historyDraft = elements.commandInput.value;
  }
  elements.commandInput.removeAttribute("aria-invalid");
});
elements.commandInput.addEventListener("paste", (event) => {
  const pastedText = event.clipboardData?.getData("text/plain");
  if (pastedText === undefined || elements.commandInput.disabled) return;
  if (editorActive) {
    event.preventDefault();
    queueEditorKeys(
      [...pastedText.replaceAll("\r\n", "\n")].map((key) =>
        key === "\n" ? "Enter" : key,
      ),
    );
    return;
  }
  event.preventDefault();
  const inserted = insertPastedCommand(
    elements.commandInput.value,
    pastedText,
    elements.commandInput.selectionStart,
    elements.commandInput.selectionEnd,
    elements.commandInput.maxLength,
  );
  elements.commandInput.value = inserted.value;
  elements.commandInput.setSelectionRange(inserted.cursor, inserted.cursor);
  elements.commandInput.dispatchEvent(new Event("input", { bubbles: true }));
});
elements.commandInput.addEventListener("focus", () => {
  if (!elements.commandInput.disabled)
    elements.inputState.textContent = "INPUT";
});
elements.commandInput.addEventListener("blur", () => {
  if (!sessionClosed && accessMode === "writer") {
    elements.inputState.textContent = "COMMAND";
  }
});
elements.terminalStage.addEventListener("click", () => {
  if (window.getSelection()?.isCollapsed === false) return;
  if (!elements.commandInput.disabled) elements.commandInput.focus();
});
elements.terminalScreen.addEventListener("pointerdown", (event) => {
  if (!terminalMouseAvailable()) return;
  const point = terminalMousePoint(event);
  if (point === undefined) return;
  event.preventDefault();
  elements.terminalScreen.setPointerCapture?.(event.pointerId);
  queueTerminalMouse("down", event.button, point);
  if (!elements.commandInput.disabled) elements.commandInput.focus();
});
elements.terminalScreen.addEventListener("pointermove", (event) => {
  if (!terminalMouseAvailable()) return;
  const point = terminalMousePoint(event);
  if (point === undefined) return;
  queueTerminalMouse("move", pointerMoveButton(event.buttons), point);
});
elements.terminalScreen.addEventListener("pointerup", (event) => {
  if (!terminalMouseAvailable()) return;
  const point = terminalMousePoint(event);
  if (point === undefined) return;
  event.preventDefault();
  queueTerminalMouse("up", event.button, point);
  if (elements.terminalScreen.hasPointerCapture?.(event.pointerId)) {
    elements.terminalScreen.releasePointerCapture(event.pointerId);
  }
});
elements.terminalScreen.addEventListener("pointercancel", (event) => {
  if (!terminalMouseAvailable()) return;
  const point = terminalMousePoint(event);
  if (point !== undefined) queueTerminalMouse("up", event.button, point);
});
elements.terminalScreen.addEventListener("contextmenu", (event) => {
  if (terminalMouseAvailable()) event.preventDefault();
});
elements.reconnectButton.addEventListener("click", () => {
  elements.reconnectButton.hidden = true;
  void connectStream();
});
elements.takeControlButton.addEventListener("click", () => {
  void takeControl();
});
elements.handoffCode.addEventListener("input", () => {
  elements.handoffCode.value = elements.handoffCode.value
    .replace(/[^0-9]/gu, "")
    .slice(0, 4);
});
elements.handoffForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void connectWithCode();
});
elements.errorDismiss.addEventListener("click", () => {
  elements.errorDialog.close();
});
elements.copyButton.addEventListener("click", () => {
  void copyTerminalText();
});
elements.powerButton.addEventListener("click", () => {
  void requestPower();
});
elements.ejectButton.addEventListener("click", () => {
  void requestFloppyEject();
});
elements.manualButton.addEventListener("click", () => {
  if (elements.manualDialog.open) return;
  elements.manualDialog.showModal();
  renderManualChapter(manualChapterIndex, true);
});
elements.manualPrevious.addEventListener("click", () => {
  renderManualChapter(manualChapterIndex - 1, true);
});
elements.manualNext.addEventListener("click", () => {
  renderManualChapter(manualChapterIndex + 1, true);
});
elements.manualSearch.addEventListener("input", renderManualNavigation);
elements.manualDialog.addEventListener("keydown", (event) => {
  if (event.target === elements.manualSearch) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    renderManualChapter(manualChapterIndex - 1, true);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    renderManualChapter(manualChapterIndex + 1, true);
  }
});
renderManualNavigation();
window.addEventListener("resize", scheduleTerminalFit);
if (typeof ResizeObserver === "function") {
  new ResizeObserver(scheduleTerminalFit).observe(elements.terminalStage);
}
if (document.fonts?.ready !== undefined) {
  void document.fonts.ready.then(scheduleTerminalFit);
}
if (
  !/^[A-Za-z0-9_-]{20,}$/u.test(token) &&
  handoffRequested &&
  /^[0-9]{4}$/u.test(queryCode)
) {
  void connectWithCode(queryCode, true);
} else if (
  !/^[A-Za-z0-9_-]{20,}$/u.test(token) &&
  /^[0-9]{4}$/u.test(queryCode)
) {
  void reconnectWithCode(queryCode);
} else if (!/^[A-Za-z0-9_-]{20,}$/u.test(token)) {
  showHandoffPrompt(
    "Enter this Computer's permanent four-digit number from Minecraft. Each activation lasts two minutes.",
  );
} else {
  void bootstrap();
}

function renderManualNavigation() {
  const query = elements.manualSearch.value.trim();
  if (query.length > 0) renderManualSearchResults(query);
  else renderManualParts();
}

function renderManualParts() {
  const fragment = document.createDocumentFragment();
  for (const part of manualParts) {
    const section = document.createElement("section");
    section.className = "manual-part";
    const heading = document.createElement("h3");
    heading.className = "manual-part-title";
    heading.textContent = `Part ${part.number} · ${part.title}`;
    const entries = document.createElement("div");
    entries.className = "manual-part-chapters";
    for (const chapterId of part.chapterIds) {
      const chapterIndex = manualChapters.findIndex(
        ({ id }) => id === chapterId,
      );
      if (chapterIndex < 0) continue;
      entries.append(createManualChapterButton(chapterIndex));
    }
    section.append(heading, entries);
    fragment.append(section);
  }
  elements.manualToc.replaceChildren(fragment);
  elements.manualToc.setAttribute("aria-label", "Publication chapters by part");
  elements.manualSearchStatus.textContent = `${String(manualChapters.length)} chapters in ${String(manualParts.length)} parts.`;
}

function createManualChapterButton(chapterIndex) {
  const chapter = manualChapters[chapterIndex];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "manual-toc-entry";
  button.dataset.chapter = chapter.id;
  if (chapterIndex === manualChapterIndex) {
    button.setAttribute("aria-current", "page");
  }
  const number = document.createElement("span");
  number.textContent = chapter.number;
  const label = document.createElement("span");
  const title = document.createElement("b");
  title.textContent = chapter.title;
  const summary = document.createElement("small");
  summary.textContent = chapter.summary;
  label.append(title, summary);
  if (chapterIndex === manualChapterIndex) appendCurrentMarker(label);
  button.append(number, label);
  button.addEventListener("click", () =>
    renderManualChapter(chapterIndex, true),
  );
  return button;
}

function renderManualSearchResults(query) {
  const results = searchManual(query, { limit: 24 });
  const fragment = document.createDocumentFragment();
  for (const result of results) {
    const chapterIndex = manualChapters.findIndex(
      ({ id }) => id === result.chapterId,
    );
    if (chapterIndex < 0) continue;
    const chapter = manualChapters[chapterIndex];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "manual-search-result";
    button.dataset.chapter = chapter.id;
    button.dataset.section = result.sectionId;
    const isCurrent =
      chapterIndex === manualChapterIndex &&
      result.sectionId === manualSectionId;
    if (isCurrent) button.setAttribute("aria-current", "location");

    const meta = document.createElement("span");
    meta.className = "manual-search-meta";
    const type = document.createElement("span");
    type.className = "manual-search-type";
    type.textContent = manualSearchTypeLabels[result.type] ?? result.type;
    const applicability = document.createElement("span");
    applicability.className = "manual-search-applicability";
    applicability.textContent = formatManualApplicability(result.appliesTo);
    meta.append(type, applicability);
    if (isCurrent) appendCurrentMarker(meta);

    const breadcrumb = document.createElement("span");
    breadcrumb.className = "manual-search-breadcrumb";
    breadcrumb.textContent = `${result.chapterNumber} · ${result.chapterTitle} / ${result.sectionTitle}`;
    const snippet = document.createElement("small");
    snippet.className = "manual-search-snippet";
    snippet.textContent = result.snippet;
    button.append(meta, breadcrumb, snippet);
    button.addEventListener("click", () =>
      renderManualChapter(chapterIndex, true, result.sectionId),
    );
    fragment.append(button);
  }
  elements.manualToc.replaceChildren(fragment);
  elements.manualToc.setAttribute("aria-label", `Search results for ${query}`);
  elements.manualSearchStatus.textContent = `${String(results.length)} ${results.length === 1 ? "result" : "results"} for “${query}”.`;
  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "manual-empty";
    empty.textContent = `No manual section matches “${query}”.`;
    elements.manualToc.append(empty);
  }
}

function appendCurrentMarker(parent) {
  const marker = document.createElement("span");
  marker.className = "manual-current-marker";
  marker.textContent = "Current";
  parent.append(marker);
}

function formatManualApplicability(appliesTo) {
  return appliesTo
    .map((profile) => manualApplicabilityLabels[profile] ?? profile)
    .join(" · ");
}

function renderManualChapterMeta(chapter) {
  const header = elements.manualPage.querySelector(".manual-page-header");
  if (header === null) return;
  const metadata = document.createElement("div");
  metadata.className = "manual-chapter-meta";
  metadata.setAttribute(
    "aria-label",
    "Chapter classification and applicability",
  );

  const kind = document.createElement("span");
  kind.className = "manual-chapter-kind";
  kind.textContent = `Type · ${manualKindLabels[chapter.kind] ?? chapter.kind}`;
  const applicability = document.createElement("span");
  applicability.className = "manual-chapter-applies";
  applicability.textContent = `Applies · ${formatManualApplicability(chapter.appliesTo)}`;
  metadata.append(kind, applicability);

  const kicker = header.querySelector(".manual-kicker");
  if (kicker === null) header.prepend(metadata);
  else kicker.after(metadata);
}

function renderManualChapter(index, focusPage = false, sectionId = "") {
  manualChapterIndex = Math.max(0, Math.min(manualChapters.length - 1, index));
  manualSectionId = sectionId;
  const chapter = manualChapters[manualChapterIndex];
  elements.manualPage.innerHTML = chapter.html;
  renderManualChapterMeta(chapter);
  elements.manualPage.scrollTop = 0;
  elements.manualPosition.textContent = `${chapter.number} / ${String(manualChapters.length).padStart(2, "0")}`;
  elements.manualPrevious.disabled = manualChapterIndex === 0;
  elements.manualNext.disabled =
    manualChapterIndex === manualChapters.length - 1;
  elements.manualPrevious.title = elements.manualPrevious.disabled
    ? "Already at the first chapter"
    : `Open chapter ${manualChapters[manualChapterIndex - 1].number}`;
  elements.manualNext.title = elements.manualNext.disabled
    ? "Already at the final chapter"
    : `Open chapter ${manualChapters[manualChapterIndex + 1].number}`;
  renderManualNavigation();
  if (!focusPage) return;
  if (sectionId.length > 0) {
    const heading = [...elements.manualPage.querySelectorAll("h3[id]")].find(
      ({ id }) => id === sectionId,
    );
    if (heading !== undefined) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start" });
      return;
    }
  }
  elements.manualPage.focus({ preventScroll: true });
}

async function bootstrap() {
  setConnection("loading", "AUTHENTICATING");
  try {
    const response = await api("/api/session");
    updateSession(await response.json());
    ensureHardwareTextMode();
    scheduleTerminalFit();
    await connectStream();
  } catch (error) {
    if (/^[0-9]{4}$/u.test(connectionCode)) {
      void reconnectWithCode(connectionCode);
    } else {
      fail(errorMessage(error));
    }
  }
}

async function connectStream() {
  const generation = ++streamGeneration;
  let retry = 0;
  setConnection("loading", "CONNECTING");
  setInputAvailable(false, "CONNECT");
  while (generation === streamGeneration && !sessionClosed) {
    try {
      const response = await api("/api/events");
      setConnection("online", "CONNECTED");
      setInputAvailable(true, "INPUT");
      retry = 0;
      await consumeEvents(response, generation);
      if (sessionClosed || generation !== streamGeneration) return;
      throw new Error("Terminal event stream ended.");
    } catch {
      if (sessionClosed || generation !== streamGeneration) return;
      retry += 1;
      if (retry > 5) {
        setConnection("offline", "DISCONNECTED");
        setInputAvailable(false, "OFFLINE");
        if (/^[0-9]{4}$/u.test(connectionCode)) {
          void reconnectWithCode(connectionCode);
        } else {
          elements.reconnectButton.hidden = false;
        }
        return;
      }
      setConnection("loading", `RETRY ${String(retry)}/5`);
      setInputAvailable(false, `RETRY ${String(retry)}`);
      const delay = Math.min(8_000, 400 * 2 ** (retry - 1));
      await wait(delay + Math.floor(Math.random() * 250));
    }
  }
}

async function consumeEvents(response, generation) {
  if (response.body === null)
    throw new Error("Terminal stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (generation === streamGeneration && !sessionClosed) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length === 0) continue;
      const event = JSON.parse(line);
      if (event.type === "replaced") {
        const discarded = discardEditorKeys();
        cancelPendingTerminalRender();
        token = "";
        sessionStorage.removeItem(tokenStorageKey);
        sessionClosed = true;
        reconnectGeneration += 1;
        setConnection("offline", "REPLACED");
        setInputAvailable(false, "OPEN IN ANOTHER TAB");
        showHandoffPrompt(
          `This session moved to another browser tab. Activate the Computer again to use this tab.${
            discarded === 0
              ? ""
              : ` ${String(discarded)} unacknowledged editor key(s) were discarded.`
          }`,
        );
        return;
      }
      if (event.type === "terminal") renderTerminal(event.terminal);
      if (event.session !== undefined) updateSession(event.session);
    }
  }
  await reader.cancel().catch(() => undefined);
}

async function sendLine() {
  hideCompletions();
  const line = elements.commandInput.value;
  const submittedSecret = secretInput;
  if (commandPending || elements.commandInput.disabled) return;
  const accepted = await sendInput({ kind: "line", value: line });
  if (accepted) {
    if (!submittedSecret && line.length > 0 && commandHistory.at(-1) !== line) {
      commandHistory.push(line);
      if (commandHistory.length > 100) commandHistory.shift();
    }
    historyCursor = commandHistory.length;
    historyDraft = "";
    elements.commandInput.value = "";
  }
}

async function completeCommandLine() {
  if (
    completionPending ||
    commandPending ||
    sessionClosed ||
    editorActive ||
    secretInput ||
    elements.commandInput.disabled
  )
    return;
  completionPending = true;
  const original = elements.commandInput.value;
  const cursor = elements.commandInput.selectionStart;
  try {
    const response = await api("/api/complete", {
      method: "POST",
      headers: {
        ...authorizationHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: original, cursor }),
    });
    const completion = await response.json();
    if (elements.commandInput.value !== original) return;
    elements.commandInput.value = completion.value;
    elements.commandInput.setSelectionRange(
      completion.cursor,
      completion.cursor,
    );
    if (completion.candidates.length > 1)
      showCompletions(completion.candidates);
  } catch (error) {
    if (error?.code === "read_only") setInputAvailable(false, "VIEW ONLY");
    if (error?.code === "out_of_range") {
      setConnection("offline", "OUT OF RANGE");
      setInputAvailable(false, "MOVE WITHIN 3 BLOCKS");
    }
  } finally {
    completionPending = false;
  }
}

function showCompletions(candidates) {
  elements.completionMenu.textContent = candidates.join("  ");
  elements.completionMenu.hidden = false;
}

function hideCompletions() {
  elements.completionMenu.hidden = true;
  elements.completionMenu.textContent = "";
}

async function sendInput(payload) {
  if (commandPending || sessionClosed) return false;
  commandPending = true;
  elements.inputState.textContent = "WAIT";
  elements.commandInput.disabled = true;
  let accepted = false;
  try {
    await api("/api/input", {
      method: "POST",
      headers: {
        ...authorizationHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    accepted = true;
    return true;
  } catch (error) {
    if (error?.code === "read_only") {
      accessMode = "viewer";
      setInputAvailable(false, "VIEW ONLY");
      return false;
    }
    if (error?.code === "out_of_range") {
      setConnection("offline", "OUT OF RANGE");
      setInputAvailable(false, "MOVE WITHIN 3 BLOCKS");
      return false;
    }
    setConnection("offline", "INPUT FAILED");
    elements.commandInput.setAttribute("aria-invalid", "true");
    elements.reconnectButton.hidden = false;
    showError(errorMessage(error));
    return false;
  } finally {
    commandPending = false;
    if (!sessionClosed && accepted && connectionState === "online")
      setInputAvailable(true, "INPUT");
    else if (!sessionClosed) setInputAvailable(false, "OFFLINE");
  }
}

function terminalMouseAvailable() {
  return (
    editorActive &&
    !sessionClosed &&
    connectionState === "online" &&
    accessMode === "writer"
  );
}

function terminalMousePoint(event) {
  const bounds = elements.terminalScreen.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  const relativeX = (event.clientX - bounds.left) / bounds.width;
  const relativeY = (event.clientY - bounds.top) / bounds.height;
  if (relativeX < 0 || relativeX >= 1 || relativeY < 0 || relativeY >= 1)
    return undefined;
  return {
    x: Math.max(
      1,
      Math.min(
        hardwareTextColumns,
        Math.floor(relativeX * hardwareTextColumns) + 1,
      ),
    ),
    y: Math.max(
      1,
      Math.min(hardwareTextRows, Math.floor(relativeY * hardwareTextRows) + 1),
    ),
  };
}

function pointerMoveButton(buttons) {
  if ((buttons & 1) !== 0) return 0;
  if ((buttons & 4) !== 0) return 1;
  if ((buttons & 2) !== 0) return 2;
  return 0;
}

function queueTerminalMouse(action, button, point) {
  if (![0, 1, 2].includes(button)) return;
  const event = { action, button, x: point.x, y: point.y };
  if (action === "move") pendingMouseMove = event;
  else {
    if (mouseTransitionQueue.length >= 16) return;
    mouseTransitionQueue.push(event);
  }
  void drainTerminalMouse();
}

async function drainTerminalMouse() {
  if (mouseRequestPending || !terminalMouseAvailable()) return;
  const event = mouseTransitionQueue.shift() ?? pendingMouseMove;
  if (event === undefined) return;
  if (event === pendingMouseMove) pendingMouseMove = undefined;
  mouseRequestPending = true;
  try {
    mouseSequence += 1;
    await api("/api/input", {
      method: "POST",
      headers: {
        ...authorizationHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "mouse",
        value: { ...event, sequence: mouseSequence },
      }),
    });
  } catch (error) {
    pendingMouseMove = undefined;
    mouseTransitionQueue.length = 0;
    if (error?.code === "read_only") {
      accessMode = "viewer";
      setInputAvailable(false, "VIEW ONLY");
    } else if (error?.code === "out_of_range") {
      setConnection("offline", "OUT OF RANGE");
      setInputAvailable(false, "MOVE WITHIN 3 BLOCKS");
    }
  } finally {
    mouseRequestPending = false;
    if (terminalMouseAvailable()) void drainTerminalMouse();
  }
}

function renderTerminal(payload) {
  floppyAudio.consume(payload?.audio);
  pendingTerminalPayload = payload;
  if (terminalRenderFrame !== 0) return;
  terminalRenderFrame = requestAnimationFrame(() => {
    terminalRenderFrame = 0;
    const latest = pendingTerminalPayload;
    pendingTerminalPayload = undefined;
    renderTerminalNow(latest);
  });
}

function cancelPendingTerminalRender() {
  if (terminalRenderFrame !== 0) cancelAnimationFrame(terminalRenderFrame);
  terminalRenderFrame = 0;
  pendingTerminalPayload = undefined;
}

function renderTerminalNow(payload) {
  const terminal = payload?.terminal;
  if (!Array.isArray(terminal?.rows)) return;
  const nextEditorActive = isEditorTerminalScreen(terminal.rows);
  const nextMode = nextEditorActive ? "dos" : "default";
  const nextGeometry = `${String(terminal.width)}x${String(terminal.height)}`;
  const rebuildRows =
    renderedTerminalMode !== nextMode ||
    renderedTerminalGeometry !== nextGeometry ||
    renderedTerminalRowElements.length !== terminal.rows.length;
  if (
    renderedTerminalMode !== nextMode ||
    renderedTerminalGeometry !== nextGeometry
  ) {
    scheduleTerminalFit();
  }
  editorActive = nextEditorActive;
  elements.terminalStage.classList.toggle("dos-editor-active", editorActive);
  secretInput = terminal.secretInput === true;
  elements.commandInput.classList.toggle("secret-input", secretInput);
  elements.commandInput.setAttribute(
    "aria-label",
    secretInput ? "Secret terminal input" : "Terminal command line",
  );
  if (editorActive) {
    elements.commandInput.value = "";
    elements.inputState.textContent = "EDIT";
  }
  elements.computerName.textContent = payload.label ?? payload.computerId;
  elements.computerId.textContent = payload.computerId;
  elements.lifecycleState.textContent = String(
    payload.lifecycle ?? "unknown",
  ).toUpperCase();
  updateMachinePanel(payload);
  elements.terminalSize.textContent = `${String(terminal.width)} \u00d7 ${String(terminal.height)}`;
  const cursorX = Number.isInteger(terminal.cursor?.x) ? terminal.cursor.x : 1;
  const cursorY = Number.isInteger(terminal.cursor?.y) ? terminal.cursor.y : 1;
  elements.commandForm.style.setProperty(
    "--cursor-left",
    `${String(Math.max(0, cursorX - 1))}ch`,
  );
  elements.commandForm.style.setProperty(
    "--cursor-top",
    `${String(Math.max(0, cursorY - 1) * (editorActive ? 1 : 1.32))}em`,
  );
  const colorX = Math.max(0, Math.min(terminal.width - 1, cursorX - 1));
  const colorY = Math.max(0, Math.min(terminal.height - 1, cursorY - 1));
  const inputForeground = terminal.foreground?.[colorY]?.[colorX] ?? 0;
  const activePalette = editorActive ? dosTuiPalette : palette;
  elements.commandForm.style.setProperty(
    "--input-color",
    activePalette[inputForeground] ?? activePalette[0],
  );

  const nextElements = new Array(terminal.rows.length);
  const nextSignatures = new Array(terminal.rows.length);
  terminal.rows.forEach((row, y) => {
    const foreground = terminal.foreground?.[y] ?? [];
    const background = terminal.background?.[y] ?? [];
    const signature = terminalRowSignature(
      row,
      foreground,
      background,
      nextMode,
    );
    nextSignatures[y] = signature;
    if (
      !rebuildRows &&
      signature === renderedTerminalRowSignatures[y] &&
      renderedTerminalRowElements[y] !== undefined
    ) {
      nextElements[y] = renderedTerminalRowElements[y];
      return;
    }
    const line = createTerminalRow(
      row,
      foreground,
      background,
      activePalette,
      editorActive,
    );
    nextElements[y] = line;
    if (!rebuildRows) renderedTerminalRowElements[y].replaceWith(line);
  });
  if (rebuildRows) {
    const fragment = document.createDocumentFragment();
    for (const line of nextElements) fragment.append(line);
    elements.terminalScreen.replaceChildren(fragment);
  }
  renderedTerminalGeometry = nextGeometry;
  renderedTerminalMode = nextMode;
  renderedTerminalRowElements = nextElements;
  renderedTerminalRowSignatures = nextSignatures;
}

function terminalRowSignature(row, foreground, background, mode) {
  return JSON.stringify([mode, row, foreground, background]);
}

const verticallyJoiningTerminalGlyphs = new Set(["\u2502", "\u2551", "\u2591"]);

function createTerminalRow(
  row,
  foreground,
  background,
  activePalette,
  editorMode,
) {
  const line = document.createElement("div");
  line.className = "terminal-row";
  const characters = [...row];
  let span;
  let previousKey = "";
  characters.forEach((character, x) => {
    const foregroundColor = foreground[x] ?? 0;
    const backgroundColor = background[x] ?? 15;
    const joinsVertically =
      editorMode && verticallyJoiningTerminalGlyphs.has(character);
    const key = `${String(foregroundColor)}:${String(backgroundColor)}:${joinsVertically ? "join-y" : "plain"}`;
    if (span === undefined || key !== previousKey) {
      span = document.createElement("span");
      span.style.color = activePalette[foregroundColor] ?? activePalette[0];
      span.style.backgroundColor =
        activePalette[backgroundColor] ?? activePalette[15];
      if (joinsVertically) span.classList.add("terminal-cell--join-y");
      line.append(span);
      previousKey = key;
    }
    span.append(document.createTextNode(character));
  });
  return line;
}

async function copyTerminalText() {
  const selection = window.getSelection();
  const selectedInsideTerminal =
    selection?.isCollapsed === false &&
    elements.terminalOutput.contains(selection.anchorNode) &&
    elements.terminalOutput.contains(selection.focusNode);
  const text = selectedInsideTerminal
    ? selection.toString()
    : [...elements.terminalScreen.querySelectorAll(".terminal-row")]
        .map((row) => (row.textContent ?? "").replace(/\s+$/u, ""))
        .join("\n")
        .replace(/\s+$/u, "");
  if (text.length === 0) return showCopyState("EMPTY");
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
    } else {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      try {
        fallback.select();
        if (!document.execCommand("copy")) {
          throw new Error("Copy command was rejected.");
        }
      } finally {
        fallback.remove();
      }
    }
    showCopyState("COPIED");
  } catch {
    showCopyState("FAILED");
  }
}

function showCopyState(label) {
  elements.copyButton.textContent = label;
  clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    elements.copyButton.textContent = "Copy";
  }, 1_200);
}

function queueEditorKeys(keys) {
  const admission = editorKeyQueue.enqueue(keys);
  if (admission.outcome === "rejected") {
    elements.inputState.textContent = "QUEUE FULL";
    showError(
      `Editor input queue is full. ${String(admission.requested)} key(s) were not queued; ${String(admission.available)} slot(s) remain.`,
      "Editor input not queued",
    );
    return false;
  }
  void drainEditorKeys();
  return true;
}

function discardEditorKeys() {
  editorInputGeneration += 1;
  return editorKeyQueue.discard();
}

async function drainEditorKeys() {
  if (editorKeyPending || sessionClosed || accessMode !== "writer") return;
  const generation = editorInputGeneration;
  editorKeyPending = true;
  let retry = 0;
  try {
    while (
      editorKeyQueue.length > 0 &&
      !sessionClosed &&
      accessMode === "writer"
    ) {
      const keys = editorKeyQueue.peekBatch();
      if (keys.length === 0) break;
      try {
        await api("/api/input", {
          method: "POST",
          headers: {
            ...authorizationHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ kind: "keys", value: keys }),
        });
      } catch (error) {
        if (generation !== editorInputGeneration) return;
        const retryable = error?.status === 429 || error?.code === "input_busy";
        if (
          !retryable ||
          retry >= 5 ||
          sessionClosed ||
          accessMode !== "writer"
        ) {
          throw error;
        }
        retry += 1;
        elements.inputState.textContent = `RETRY ${String(retry)}/5`;
        const backoff = Math.min(4_000, 200 * 2 ** (retry - 1));
        await wait(
          Math.max(backoff, error?.retryAfterMs ?? 0) +
            Math.floor(Math.random() * 125),
        );
        continue;
      }
      if (generation !== editorInputGeneration) return;
      editorKeyQueue.acknowledge(keys);
      retry = 0;
    }
    if (editorActive && editorKeyQueue.length === 0) {
      elements.inputState.textContent = "EDIT";
    }
  } catch (error) {
    if (generation !== editorInputGeneration) return;
    if (error?.code === "read_only") {
      accessMode = "viewer";
      setInputAvailable(false, "VIEW ONLY");
    } else if (error?.code === "out_of_range") {
      setConnection("offline", "OUT OF RANGE");
      setInputAvailable(false, "MOVE WITHIN 3 BLOCKS");
    } else {
      setInputAvailable(false, "EDITOR INPUT PAUSED");
    }
    showError(
      `${errorMessage(error)} ${String(editorKeyQueue.length)} editor key(s) remain unacknowledged.`,
      "Editor input paused",
    );
  } finally {
    const superseded = generation !== editorInputGeneration;
    editorKeyPending = false;
    if (
      superseded &&
      editorKeyQueue.length > 0 &&
      !sessionClosed &&
      accessMode === "writer"
    ) {
      void drainEditorKeys();
    }
  }
}

const hardwareIndicatorStates = new Set([
  "absent",
  "error",
  "fault",
  "idle",
  "off",
  "on",
  "read",
  "transition",
  "write",
]);

function updateMachinePanel(payload) {
  const previousLifecycle = machineLifecycle;
  machineLifecycle = String(payload?.lifecycle ?? "unknown");
  const powerState =
    machineLifecycle === "off"
      ? "off"
      : machineLifecycle === "crashed" || machineLifecycle === "orphaned"
        ? "fault"
        : ["booting", "rebooting", "stopping"].includes(machineLifecycle)
          ? "transition"
          : "on";
  setHardwareIndicator(
    elements.powerIndicator,
    powerState,
    `Power ${machineLifecycle.replaceAll("_", " ")}`,
  );

  const hddState =
    machineLifecycle === "off"
      ? "off"
      : String(payload?.storage?.hdd?.state ?? "idle");
  floppyDriveState = String(payload?.storage?.fdd?.state ?? "absent");
  setHardwareIndicator(
    elements.hddIndicator,
    hddState,
    `Hard disk ${hddState}`,
  );
  setHardwareIndicator(
    elements.fddIndicator,
    floppyDriveState,
    floppyDriveState === "absent"
      ? "Floppy disk not present"
      : `Floppy disk ${floppyDriveState}`,
  );
  updateEjectButton();
  updatePowerButton();

  const wasInteractive = machineAcceptsInput(previousLifecycle);
  const isInteractive = machineAcceptsInput(machineLifecycle);
  if (!isInteractive) {
    elements.commandInput.disabled = true;
  } else if (!wasInteractive && connectionState === "online") {
    setInputAvailable(true, "INPUT");
  }
}

function setHardwareIndicator(element, requestedState, label) {
  const state = hardwareIndicatorStates.has(requestedState)
    ? requestedState
    : "error";
  element.dataset.state = state;
  element.setAttribute("aria-label", label);
}

function updateKeyboardLockIndicators(event) {
  const states = keyboardLockStatesFromEvent(event);
  setKeyboardLockIndicator(
    elements.capsLockIndicator,
    "Caps Lock",
    states.capsLock,
  );
  setKeyboardLockIndicator(
    elements.numLockIndicator,
    "Num Lock",
    states.numLock,
  );
  setKeyboardLockIndicator(
    elements.scrollLockIndicator,
    "Scroll Lock",
    states.scrollLock,
  );
}

function resetKeyboardLockIndicators() {
  setKeyboardLockIndicator(elements.capsLockIndicator, "Caps Lock", "unknown");
  setKeyboardLockIndicator(elements.numLockIndicator, "Num Lock", "unknown");
  setKeyboardLockIndicator(
    elements.scrollLockIndicator,
    "Scroll Lock",
    "unknown",
  );
}

function setKeyboardLockIndicator(element, label, requestedState) {
  const state = ["on", "off", "unknown"].includes(requestedState)
    ? requestedState
    : "unknown";
  const presentation = {
    off: { glyph: "\u25cb", label: "off" },
    on: { glyph: "\u25cf", label: "on" },
    unknown: { glyph: "?", label: "status unknown" },
  }[state];
  element.dataset.state = state;
  element.querySelector(".keyboard-lock-light").textContent =
    presentation.glyph;
  element.setAttribute("aria-label", `${label} ${presentation.label}`);
}

function machineAcceptsInput(lifecycle) {
  return ["running", "sleeping", "waiting_event"].includes(lifecycle);
}

function updateEjectButton() {
  const available =
    floppyDriveState !== "absent" &&
    accessMode === "writer" &&
    connectionState === "online" &&
    !ejectPending &&
    !sessionClosed;
  elements.ejectButton.disabled = !available;
  elements.ejectButton.setAttribute(
    "aria-busy",
    ejectPending ? "true" : "false",
  );
  elements.ejectButton.title =
    floppyDriveState === "absent"
      ? "No floppy disk is present"
      : available
        ? "Eject floppy disk to the connected player"
        : "Floppy eject is unavailable";
}

async function requestFloppyEject() {
  if (elements.ejectButton.disabled) return;
  ejectPending = true;
  elements.ejectFeedback.textContent = "Ejecting floppy disk.";
  updateEjectButton();
  try {
    const response = await api("/api/floppy/eject", { method: "POST" });
    const result = await response.json();
    if (result.outcome === "failed" || result.outcome === "missing") {
      throw new Error(
        result.error ?? "Computer did not eject the floppy disk.",
      );
    }
    floppyDriveState = "absent";
    setHardwareIndicator(
      elements.fddIndicator,
      "absent",
      "Floppy disk not present",
    );
    elements.ejectFeedback.textContent =
      result.outcome === "empty"
        ? "No floppy disk was present."
        : "Floppy disk ejected to the connected player.";
  } catch (error) {
    elements.ejectFeedback.textContent = `Floppy eject failed: ${errorMessage(error)}`;
    showError(errorMessage(error));
  } finally {
    ejectPending = false;
    updateEjectButton();
  }
}

function powerAction() {
  if (machineLifecycle === "off") {
    return "power_on";
  }
  if (machineLifecycle === "crashed") return "safe_boot";
  if (
    ["booting", "running", "sleeping", "waiting_event"].includes(
      machineLifecycle,
    )
  ) {
    return "shutdown";
  }
  return undefined;
}

function updatePowerButton() {
  const action = powerAction();
  const available =
    action !== undefined &&
    accessMode === "writer" &&
    connectionState === "online" &&
    !powerPending &&
    !sessionClosed;
  elements.powerButton.disabled = !available;
  elements.powerButton.setAttribute(
    "aria-pressed",
    machineLifecycle === "off" ? "false" : "true",
  );
  elements.powerButton.setAttribute(
    "aria-busy",
    powerPending ? "true" : "false",
  );
  elements.powerButton.title =
    action === "power_on"
      ? "Power on Computer"
      : action === "safe_boot"
        ? "Safe boot Computer and bypass /startup.py once"
        : action === "shutdown"
          ? "Shut down Computer"
          : "Power transition in progress";
}

async function requestPower() {
  const action = powerAction();
  if (action === undefined || elements.powerButton.disabled) return;
  powerPending = true;
  elements.powerFeedback.textContent =
    action === "power_on"
      ? "Powering on Computer."
      : action === "safe_boot"
        ? "Safe booting Computer; /startup.py will be preserved."
        : "Shutting down Computer.";
  updatePowerButton();
  try {
    const response = await api("/api/power", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = await response.json();
    if (result.outcome === "failed" || result.outcome === "missing") {
      throw new Error(
        result.error ?? "Computer did not accept the power request.",
      );
    }
    machineLifecycle = String(result.lifecycle ?? machineLifecycle);
    elements.lifecycleState.textContent = machineLifecycle.toUpperCase();
    elements.powerFeedback.textContent =
      action === "power_on"
        ? "Power-on request accepted."
        : action === "safe_boot"
          ? "Safe-boot request accepted; /startup.py was not changed."
          : "Shutdown request accepted.";
  } catch (error) {
    elements.powerFeedback.textContent = `Power request failed: ${errorMessage(error)}`;
    showError(errorMessage(error));
  } finally {
    powerPending = false;
    updatePowerButton();
  }
}

function updateSession(session) {
  if (/^[0-9]{4}$/u.test(session.connectionCode ?? "")) {
    rememberConnectionCode(session.connectionCode);
  }
  if (session.computerId !== undefined) {
    elements.computerId.textContent = session.computerId;
  }
  if (session.terminal !== null && session.terminal !== undefined) {
    renderTerminal(session.terminal);
  }
  if (session.mode === "writer" || session.mode === "viewer") {
    accessMode = session.mode;
    setInputAvailable(
      connectionState === "online",
      accessMode === "writer" ? "INPUT" : "VIEW ONLY",
    );
  }
  if (session.access === "out_of_range") {
    floppyAudio.stopAll();
    setConnection("offline", "OUT OF RANGE");
    setInputAvailable(false, "MOVE WITHIN 3 BLOCKS");
  } else if (session.access === "in_range" && !sessionClosed) {
    if (connectionState === "offline") setConnection("online", "CONNECTED");
    setInputAvailable(connectionState === "online", "INPUT");
  }
  if (session.state === "closed" || session.state === "expired") {
    const discarded = discardEditorKeys();
    cancelPendingTerminalRender();
    void floppyAudio.close();
    sessionClosed = true;
    sessionStorage.removeItem(tokenStorageKey);
    streamGeneration += 1;
    elements.commandInput.disabled = true;
    elements.inputState.textContent = "OFFLINE";
    elements.lifecycleState.textContent = String(
      session.finalReason ?? session.state,
    ).toUpperCase();
    setConnection("offline", session.state.toUpperCase());
    setInputAvailable(false, "OFFLINE");
    if (discarded > 0) {
      showError(
        `The terminal session ended. ${String(discarded)} unacknowledged editor key(s) were discarded.`,
        "Editor input discarded",
      );
    }
  }
}

function moveHistory(offset) {
  if (secretInput || commandHistory.length === 0) return;
  if (historyCursor === commandHistory.length && offset < 0) {
    historyDraft = elements.commandInput.value;
  }
  historyCursor = Math.max(
    0,
    Math.min(commandHistory.length, historyCursor + offset),
  );
  elements.commandInput.value =
    historyCursor === commandHistory.length
      ? historyDraft
      : (commandHistory[historyCursor] ?? "");
  queueMicrotask(() => elements.commandInput.setSelectionRange(128, 128));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...authorizationHeaders(),
      ...(options.headers ?? {}),
    },
    cache: "no-store",
  });
  if (response.ok) return response;
  throw await responseError(response);
}

function authorizationHeaders() {
  return { Authorization: `Bearer ${token}` };
}

function setConnection(state, label) {
  connectionState = state;
  if (state !== "online") floppyAudio.stopAll();
  elements.statusLight.dataset.state = state;
  elements.statusText.textContent = label;
  elements.terminalOutput.setAttribute(
    "aria-busy",
    state === "loading" ? "true" : "false",
  );
  updatePowerButton();
  updateEjectButton();
}

function setInputAvailable(available, state) {
  const writable =
    available &&
    accessMode === "writer" &&
    machineAcceptsInput(machineLifecycle) &&
    !commandPending &&
    !takeoverPending &&
    !sessionClosed;
  elements.commandInput.disabled = !writable;
  elements.accessState.dataset.mode = accessMode;
  elements.accessState.textContent =
    accessMode === "writer"
      ? "CONTROL"
      : accessMode === "viewer"
        ? "VIEW ONLY"
        : "WAITING";
  elements.takeControlButton.hidden = sessionClosed || accessMode !== "viewer";
  elements.takeControlButton.disabled =
    connectionState !== "online" || takeoverPending || sessionClosed;
  elements.inputState.textContent = accessMode === "viewer" ? "LOCKED" : state;
  updatePowerButton();
  updateEjectButton();
  if (writable) elements.commandInput.focus();
}

async function takeControl() {
  if (
    sessionClosed ||
    takeoverPending ||
    accessMode === "writer" ||
    connectionState !== "online"
  ) {
    return;
  }
  takeoverPending = true;
  elements.takeControlButton.disabled = true;
  elements.takeControlButton.setAttribute("aria-busy", "true");
  elements.takeControlButton.textContent = "Taking control…";
  setInputAvailable(false, "REQUESTING");
  try {
    const response = await api("/api/take-control", { method: "POST" });
    const result = await response.json();
    updateSession(result.session ?? {});
    ensureHardwareTextMode();
  } catch (error) {
    showError(errorMessage(error));
  } finally {
    takeoverPending = false;
    elements.takeControlButton.removeAttribute("aria-busy");
    elements.takeControlButton.textContent = "Take control";
    setInputAvailable(
      connectionState === "online",
      connectionState === "online" ? "INPUT" : "OFFLINE",
    );
  }
}

function editCommandLine(key) {
  const input = elements.commandInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (key === "u") {
    input.value = input.value.slice(end);
    input.setSelectionRange(0, 0);
  } else if (key === "k") {
    input.value = input.value.slice(0, start);
    input.setSelectionRange(start, start);
  } else {
    const prefix = input.value.slice(0, start);
    const wordStart = /\s*\S+\s*$/u.exec(prefix)?.index ?? 0;
    input.value = `${prefix.slice(0, wordStart)}${input.value.slice(end)}`;
    input.setSelectionRange(wordStart, wordStart);
  }
  historyDraft = input.value;
}

function deleteAtCursor() {
  const input = elements.commandInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const deleteEnd = end > start ? end : Math.min(input.value.length, start + 1);
  input.value = `${input.value.slice(0, start)}${input.value.slice(deleteEnd)}`;
  input.setSelectionRange(start, start);
  historyDraft = input.value;
}

async function closeSession() {
  if (sessionClosed || commandPending) return;
  commandPending = true;
  setInputAvailable(false, "CLOSING");
  try {
    await api("/api/close", { method: "POST" });
    const discarded = discardEditorKeys();
    cancelPendingTerminalRender();
    sessionClosed = true;
    reconnectGeneration += 1;
    streamGeneration += 1;
    sessionStorage.removeItem(tokenStorageKey);
    localStorage.removeItem(codeStorageKey);
    connectionCode = "";
    window.history.replaceState(null, "", location.pathname);
    setConnection("offline", "CLOSED");
    elements.lifecycleState.textContent = "LOGOUT";
    elements.inputState.textContent = "OFFLINE";
    if (discarded > 0) {
      showError(
        `The terminal was closed. ${String(discarded)} unacknowledged editor key(s) were discarded.`,
        "Editor input discarded",
      );
    }
  } catch (error) {
    showError(errorMessage(error));
    const online = connectionState === "online";
    setInputAvailable(online, online ? "INPUT" : "OFFLINE");
  } finally {
    commandPending = false;
  }
}

function scheduleTerminalFit() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    fitTerminal(hardwareTextColumns, hardwareTextRows);
  });
}

async function ensureHardwareTextMode() {
  if (
    sessionClosed ||
    accessMode !== "writer" ||
    hardwareTextModePending ||
    hardwareTextModeConfirmed
  ) {
    return;
  }
  hardwareTextModePending = true;
  try {
    await api("/api/resize", {
      method: "POST",
      headers: {
        ...authorizationHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        height: hardwareTextRows,
        width: hardwareTextColumns,
      }),
    });
    hardwareTextModeConfirmed = true;
  } catch {
    // A later explicit reconnect or Take control action may retry once.
  } finally {
    hardwareTextModePending = false;
  }
}

function fitTerminal(columns, rows) {
  if (
    !Number.isFinite(columns) ||
    columns <= 0 ||
    !Number.isFinite(rows) ||
    rows <= 0
  )
    return;
  const available = terminalContentSize();
  const lineHeightRatio = editorActive ? 1 : 1.32;
  const monospaceRatio = editorActive ? 0.5 : 0.61;
  const fitted = calculateFixedGridFontSize({
    availableHeight: available.height,
    availableWidth: available.width,
    columns,
    lineHeightRatio,
    maximumPixels: 48,
    monospaceRatio,
    rows,
  });
  if (fitted.kind === "unmeasurable") return;
  elements.terminalStage.style.setProperty(
    "--terminal-font-size",
    `${fitted.pixels.toFixed(2)}px`,
  );
}

function terminalContentSize() {
  const style = getComputedStyle(elements.terminalStage);
  const horizontalPadding =
    Number.parseFloat(style.paddingLeft) +
    Number.parseFloat(style.paddingRight);
  const verticalPadding =
    Number.parseFloat(style.paddingTop) +
    Number.parseFloat(style.paddingBottom);
  return {
    height: Math.max(0, elements.terminalStage.clientHeight - verticalPadding),
    width: Math.max(0, elements.terminalStage.clientWidth - horizontalPadding),
  };
}

function fail(message) {
  sessionClosed = true;
  sessionStorage.removeItem(tokenStorageKey);
  token = "";
  elements.commandInput.disabled = true;
  elements.inputState.textContent = "OFFLINE";
  setConnection("offline", "UNAVAILABLE");
  showHandoffPrompt(message);
}

function showHandoffPrompt(message) {
  elements.errorTitle.textContent = "Enter connection code";
  elements.errorMessage.textContent = message;
  elements.handoffForm.hidden = false;
  elements.errorDismiss.hidden = true;
  if (!elements.errorDialog.open) elements.errorDialog.showModal();
  queueMicrotask(() => elements.handoffCode.focus());
}

async function connectWithCode(
  code = elements.handoffCode.value,
  automatic = false,
) {
  elements.handoffCode.value = code;
  if (!/^[0-9]{4}$/u.test(code)) {
    elements.handoffCode.setAttribute("aria-invalid", "true");
    elements.handoffCode.focus();
    return;
  }
  elements.handoffCode.disabled = true;
  if (automatic) {
    setConnection("loading", "ACTIVATING");
    setInputAvailable(false, "CONNECTING");
  }
  try {
    const response = await fetch("/api/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : `Connection failed (${String(response.status)}).`,
      );
    }
    const body = await response.json();
    const discarded = acceptConnection(body.token, body.code ?? code);
    elements.errorDialog.close();
    void bootstrap();
    if (discarded > 0) {
      showError(
        `A new terminal session was activated. ${String(discarded)} unacknowledged editor key(s) were discarded.`,
        "Editor input discarded",
      );
    }
  } catch (error) {
    showHandoffPrompt(errorMessage(error));
    elements.handoffCode.select();
  } finally {
    elements.handoffCode.disabled = false;
    if (elements.errorDialog.open) elements.handoffCode.focus();
  }
}

async function reconnectWithCode(code) {
  if (!/^[0-9]{4}$/u.test(code)) return;
  const generation = ++reconnectGeneration;
  const deadline = Date.now() + 30 * 60_000;
  const maximumAttempts = 64;
  let attempt = 0;
  sessionClosed = false;
  rememberConnectionCode(code);
  if (elements.errorDialog.open) elements.errorDialog.close();
  setConnection("loading", "WAITING FOR RANGE");
  setInputAvailable(false, "MOVE WITHIN 3 BLOCKS");
  while (
    generation === reconnectGeneration &&
    Date.now() < deadline &&
    attempt < maximumAttempts
  ) {
    attempt += 1;
    try {
      const response = await fetch("/api/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        cache: "no-store",
      });
      if (!response.ok) throw await responseError(response);
      const body = await response.json();
      const discarded = acceptConnection(
        body.token,
        body.session?.connectionCode ?? code,
      );
      updateSession(body.session ?? {});
      void bootstrap();
      if (discarded > 0) {
        showError(
          `The terminal reconnected. ${String(discarded)} unacknowledged editor key(s) were discarded.`,
          "Editor input discarded",
        );
      }
      return;
    } catch (error) {
      if (generation !== reconnectGeneration) return;
      if (
        error?.status === 401 ||
        error?.status === 410 ||
        error?.code === "unauthorized" ||
        error?.code === "gone" ||
        error?.code === "handoff_required" ||
        error?.code === "not_ready"
      ) {
        setConnection("offline", "ACTIVATION REQUIRED");
        setInputAvailable(false, "OFFLINE");
        showHandoffPrompt(
          "Activate the Computer in Minecraft, then open its new link or enter its four-digit code.",
        );
        return;
      }
      const backoff = Math.min(10_000, 500 * 2 ** Math.min(attempt - 1, 5));
      const delay =
        error?.status === 429
          ? Math.max(backoff, error.retryAfterMs ?? 0)
          : backoff;
      if (error?.status === 429) {
        setConnection("loading", "RATE LIMITED");
        setInputAvailable(false, "WAITING TO RETRY");
      } else if (error?.code === "out_of_range") {
        setConnection("loading", "WAITING FOR RANGE");
        setInputAvailable(false, "MOVE WITHIN 3 BLOCKS");
      } else {
        setConnection("loading", "RETRYING");
        setInputAvailable(false, "COMPANION UNAVAILABLE");
      }
      await wait(delay + Math.floor(Math.random() * 250));
    }
  }
  if (generation !== reconnectGeneration) return;
  setConnection("offline", "RECONNECT EXPIRED");
  setInputAvailable(false, "OFFLINE");
  showHandoffPrompt(
    "Automatic reconnect expired. Activate the Computer in Minecraft and use its permanent code again.",
  );
}

function acceptConnection(nextToken, code) {
  if (!/^[A-Za-z0-9_-]{20,}$/u.test(nextToken ?? "")) {
    throw new Error("The companion returned an invalid session token.");
  }
  const discarded = discardEditorKeys();
  reconnectGeneration += 1;
  token = nextToken;
  hardwareTextModeConfirmed = false;
  sessionStorage.setItem(tokenStorageKey, token);
  rememberConnectionCode(code);
  sessionClosed = false;
  return discarded;
}

function rememberConnectionCode(code) {
  if (!/^[0-9]{4}$/u.test(code ?? "")) return;
  connectionCode = code;
  localStorage.setItem(codeStorageKey, code);
  const url = new URL(location.href);
  url.searchParams.set("computer", code);
  url.hash = "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

async function responseError(response) {
  let detail = `Request failed (${String(response.status)}).`;
  let errorCode = "http_error";
  try {
    const body = await response.json();
    if (typeof body.error === "string") detail = body.error;
    if (typeof body.code === "string") errorCode = body.code;
  } catch {
    // The status-based message owns this bounded non-JSON failure.
  }
  const error = new Error(detail);
  error.status = response.status;
  error.code = errorCode;
  const retryAfterSeconds = Number.parseInt(
    response.headers.get("retry-after") ?? "",
    10,
  );
  if (Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
    error.retryAfterMs = retryAfterSeconds * 1_000;
  }
  return error;
}

function showError(message, title = "Terminal unavailable") {
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
  elements.handoffForm.hidden = true;
  elements.errorDismiss.hidden = false;
  if (!elements.errorDialog.open) elements.errorDialog.showModal();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

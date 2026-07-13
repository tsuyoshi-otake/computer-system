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
  reconnectButton: document.querySelector("#reconnect-button"),
  lifecycleState: document.querySelector("#lifecycle-state"),
  errorDialog: document.querySelector("#error-dialog"),
  errorMessage: document.querySelector("#error-message"),
  inputState: document.querySelector("#input-state"),
};

const tokenStorageKey = "computer-system.web-terminal-token";
let token =
  location.hash.slice(1) || sessionStorage.getItem(tokenStorageKey) || "";
let streamGeneration = 0;
let sessionClosed = false;
let commandPending = false;
let connectionState = "loading";
let historyCursor = 0;
let historyDraft = "";
let resizeFrame = 0;
const commandHistory = [];

if (location.hash.length > 1) sessionStorage.setItem(tokenStorageKey, token);
window.history.replaceState(null, "", `${location.pathname}${location.search}`);

elements.commandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendLine();
});
elements.commandInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    void sendLine();
    return;
  }
  if (event.ctrlKey) {
    const key = event.key.toLowerCase();
    if (key === "c") {
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
    moveHistory(-1);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    moveHistory(1);
  }
});
elements.commandInput.addEventListener("input", () => {
  if (historyCursor === commandHistory.length) {
    historyDraft = elements.commandInput.value;
  }
  elements.commandInput.removeAttribute("aria-invalid");
});
elements.commandInput.addEventListener("focus", () => {
  if (!elements.commandInput.disabled)
    elements.inputState.textContent = "INPUT";
});
elements.commandInput.addEventListener("blur", () => {
  if (!sessionClosed) elements.inputState.textContent = "COMMAND";
});
elements.terminalStage.addEventListener("click", () => {
  if (!elements.commandInput.disabled) elements.commandInput.focus();
});
elements.reconnectButton.addEventListener("click", () => {
  elements.reconnectButton.hidden = true;
  void connectStream();
});
window.addEventListener("resize", scheduleTerminalFit);
if (!/^[A-Za-z0-9_-]{20,}$/u.test(token)) {
  fail("This handoff link is invalid, expired, or has already been used.");
} else {
  void bootstrap();
}

async function bootstrap() {
  setConnection("loading", "AUTHENTICATING");
  try {
    const response = await api("/api/session");
    updateSession(await response.json());
    await connectStream();
  } catch (error) {
    fail(errorMessage(error));
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
        elements.reconnectButton.hidden = false;
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
      if (event.type === "terminal") renderTerminal(event.terminal);
      if (event.session !== undefined) updateSession(event.session);
    }
  }
  await reader.cancel().catch(() => undefined);
}

async function sendLine() {
  const line = elements.commandInput.value;
  if (commandPending || elements.commandInput.disabled) return;
  const accepted = await sendInput({ kind: "line", value: line });
  if (accepted) {
    if (line.length > 0 && commandHistory.at(-1) !== line) {
      commandHistory.push(line);
      if (commandHistory.length > 100) commandHistory.shift();
    }
    historyCursor = commandHistory.length;
    historyDraft = "";
    elements.commandInput.value = "";
  }
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
    setConnection("offline", "INPUT FAILED");
    elements.commandInput.setAttribute("aria-invalid", "true");
    elements.reconnectButton.hidden = false;
    elements.errorMessage.textContent = errorMessage(error);
    if (!elements.errorDialog.open) elements.errorDialog.showModal();
    return false;
  } finally {
    commandPending = false;
    if (!sessionClosed && accepted && connectionState === "online")
      setInputAvailable(true, "INPUT");
    else if (!sessionClosed) setInputAvailable(false, "OFFLINE");
  }
}

function renderTerminal(payload) {
  const terminal = payload?.terminal;
  if (!Array.isArray(terminal?.rows)) return;
  elements.computerName.textContent = payload.label ?? payload.computerId;
  elements.computerId.textContent = payload.computerId;
  elements.lifecycleState.textContent = String(
    payload.lifecycle ?? "unknown",
  ).toUpperCase();
  elements.terminalSize.textContent = `${String(terminal.width)} × ${String(terminal.height)}`;
  fitTerminal(terminal.width);
  const cursorX = Number.isInteger(terminal.cursor?.x) ? terminal.cursor.x : 1;
  const cursorY = Number.isInteger(terminal.cursor?.y) ? terminal.cursor.y : 1;
  elements.commandForm.style.setProperty(
    "--cursor-left",
    `${String(Math.max(0, cursorX - 1))}ch`,
  );
  elements.commandForm.style.setProperty(
    "--cursor-top",
    `${String(Math.max(0, cursorY - 1) * 1.32)}em`,
  );
  const colorX = Math.max(0, Math.min(terminal.width - 1, cursorX - 1));
  const colorY = Math.max(0, Math.min(terminal.height - 1, cursorY - 1));
  const inputForeground = terminal.foreground?.[colorY]?.[colorX] ?? 0;
  elements.commandForm.style.setProperty(
    "--input-color",
    palette[inputForeground] ?? palette[0],
  );
  const fragment = document.createDocumentFragment();
  terminal.rows.forEach((row, y) => {
    const line = document.createElement("div");
    line.className = "terminal-row";
    const characters = [...row];
    let span;
    let previousKey = "";
    characters.forEach((character, x) => {
      const foreground = terminal.foreground?.[y]?.[x] ?? 0;
      const background = terminal.background?.[y]?.[x] ?? 15;
      const key = `${String(foreground)}:${String(background)}`;
      if (span === undefined || key !== previousKey) {
        span = document.createElement("span");
        span.style.color = palette[foreground] ?? palette[0];
        span.style.backgroundColor = palette[background] ?? palette[15];
        line.append(span);
        previousKey = key;
      }
      span.append(document.createTextNode(character));
    });
    fragment.append(line);
  });
  elements.terminalScreen.replaceChildren(fragment);
  elements.terminalStage.scrollTop = elements.terminalStage.scrollHeight;
}

function updateSession(session) {
  if (session.computerId !== undefined) {
    elements.computerId.textContent = session.computerId;
  }
  if (session.terminal !== null && session.terminal !== undefined) {
    renderTerminal(session.terminal);
  }
  if (session.state === "closed" || session.state === "expired") {
    sessionClosed = true;
    sessionStorage.removeItem(tokenStorageKey);
    streamGeneration += 1;
    elements.commandInput.disabled = true;
    elements.inputState.textContent = "OFFLINE";
    elements.lifecycleState.textContent = String(
      session.finalReason ?? session.state,
    ).toUpperCase();
    setConnection("offline", session.state.toUpperCase());
  }
}

function moveHistory(offset) {
  if (commandHistory.length === 0) return;
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
  let detail = `Request failed (${String(response.status)}).`;
  try {
    const body = await response.json();
    if (typeof body.error === "string") detail = body.error;
  } catch {
    // The bounded fallback message above owns finalization for non-JSON errors.
  }
  throw new Error(detail);
}

function authorizationHeaders() {
  return { Authorization: `Bearer ${token}` };
}

function setConnection(state, label) {
  connectionState = state;
  elements.statusLight.dataset.state = state;
  elements.statusText.textContent = label;
  elements.terminalOutput.setAttribute(
    "aria-busy",
    state === "loading" ? "true" : "false",
  );
}

function setInputAvailable(available, state) {
  elements.commandInput.disabled = !available;
  elements.inputState.textContent = state;
  if (available) elements.commandInput.focus();
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
    sessionClosed = true;
    streamGeneration += 1;
    sessionStorage.removeItem(tokenStorageKey);
    setConnection("offline", "CLOSED");
    elements.lifecycleState.textContent = "LOGOUT";
    elements.inputState.textContent = "OFFLINE";
  } catch (error) {
    elements.errorMessage.textContent = errorMessage(error);
    if (!elements.errorDialog.open) elements.errorDialog.showModal();
    const online = connectionState === "online";
    setInputAvailable(online, online ? "INPUT" : "OFFLINE");
  } finally {
    commandPending = false;
  }
}

function scheduleTerminalFit() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    const width = Number.parseInt(elements.terminalSize.textContent, 10);
    if (Number.isFinite(width)) fitTerminal(width);
  });
}

function fitTerminal(columns) {
  if (!Number.isFinite(columns) || columns <= 0) return;
  const available = elements.terminalStage.clientWidth;
  const maximum = 14;
  const minimum = 9.5;
  const monospaceRatio = 0.61;
  const fitted = Math.max(
    minimum,
    Math.min(maximum, available / (columns * monospaceRatio)),
  );
  elements.terminalStage.style.setProperty(
    "--terminal-font-size",
    `${fitted.toFixed(2)}px`,
  );
}

function fail(message) {
  sessionClosed = true;
  sessionStorage.removeItem(tokenStorageKey);
  token = "";
  elements.commandInput.disabled = true;
  elements.inputState.textContent = "OFFLINE";
  setConnection("offline", "UNAVAILABLE");
  elements.errorMessage.textContent = message;
  if (!elements.errorDialog.open) elements.errorDialog.showModal();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

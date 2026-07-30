import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Bedrock terminal adapters", () => {
  it("adds the terminal header before interactive controls", async () => {
    const terminalView = await source("src/bedrock/terminalView.ts");
    expect(terminalView.indexOf(".label(display)")).toBeLessThan(
      terminalView.indexOf('.textField("Command line", input)'),
    );
    expect(terminalView).toContain('.button("Enter"');
    expect(terminalView).toContain('.button("Ctrl+C"');
    expect(terminalView).not.toContain("form.closeButton()");
  });

  it("maps every terminal palette index to a distinct native formatting color", async () => {
    const viewport = await source("src/application/terminal/viewport.ts");
    const paletteSource = viewport.match(
      /const formattingCodes = \[([\s\S]*?)\] as const;/u,
    )?.[1];
    const codes = [...(paletteSource ?? "").matchAll(/"([0-9a-f])"/gu)].map(
      (match) => match[1],
    );

    expect(codes).toHaveLength(16);
    expect(new Set(codes)).toHaveProperty("size", 16);
  });

  it("routes Computer and Portable Computer System through the production coordinator", async () => {
    const [computer, portable, coordinator, registry] = await Promise.all([
      source("src/bedrock/computerComponent.ts"),
      source("src/bedrock/portableComputer.ts"),
      source("src/bedrock/computerTerminal.ts"),
      source("src/bedrock/computerRegistry.ts"),
    ]);

    expect(computer).toContain("requestWebComputerTerminal");
    expect(computer).toContain(
      "requestWebComputerTerminal(player, record, event.block)",
    );
    expect(computer).not.toContain("hasAdjacentMonitor");
    expect(computer).not.toContain("computer_system:monitor");
    expect(computer).toContain("selectComputerTerminal");
    expect(portable).toContain("requestWebComputerTerminal");
    expect(portable).toContain("resolvePortableComputer(source, itemStack)");
    expect(portable).toContain("Portable Computer System");
    expect(portable).toContain(
      "inventory.setItem(player.selectedSlotIndex, selectedItem)",
    );
    expect(portable).not.toContain("showTerminalProbe");
    expect(coordinator).toContain("showTerminalView");
    expect(coordinator).toContain('"terminal_line"');
    expect(coordinator).toContain('"terminal_closed"');
    expect(coordinator).toContain("selectComputerTerminal");
    expect(portable).toContain("ensurePortableComputer");
    expect(portable).toContain("playerOwnsPortableIdentity");
    expect(portable).toContain('location: "transferred"');
    expect(portable).toContain(
      'disconnectWebTerminalPlayer(previous.ownerId, "transferred", identity)',
    );
    expect(registry).toContain("applyPortableComputerProfile");
    expect(registry).toContain("hardware: portableComputerHardware");
    expect(registry).toContain('osProfile: "dos"');
  });

  it("does not expose the native terminal as an automatic Web fallback", async () => {
    const bridge = await source("src/bedrock/webTerminalBridge.ts");

    expect(bridge).not.toContain("openComputerTerminal");
    expect(bridge).not.toContain("openFallback");
    expect(bridge).not.toContain("Opening the in-game terminal");
    expect(bridge).toContain("Web Terminal companion did not respond");
  });

  it("normalizes the GDK single-entity item-drop shape and keeps the world in daytime", async () => {
    const [portable, daylight, main, headless] = await Promise.all([
      source("src/bedrock/portableComputer.ts"),
      source("src/bedrock/daylightController.ts"),
      source("src/bedrock/main.ts"),
      source("src/bedrock/probes/headlessProbe.ts"),
    ]);

    expect(portable).toContain("Array.isArray(items) ? items : [items]");
    expect(portable).not.toContain("for (const entity of items)");
    expect(portable).not.toContain("for (const entity of droppedEntities)");
    expect(portable).toContain("maximumDroppedItemsToInspect");
    expect(portable).toContain(
      "for (let index = 0; index < count; index += 1)",
    );
    expect(portable).toContain("handlePortableItemUseOn");
    expect(portable).toContain("handlePortableBlockInteraction");
    expect(portable).toContain("handlePortableBlockBreak");
    expect(portable).toContain("portableComputerBlockTypeId");
    expect(daylight).toContain("world.gameRules.doDayLightCycle = false");
    expect(daylight).toContain("world.setTimeOfDay(TimeOfDay.Day)");
    expect(daylight).toContain("system.runInterval");
    expect(daylight).toContain("inspectAlwaysDayState");
    expect(main).toContain("startAlwaysDayController()");
    expect(headless).toContain("if (!computerStorageReady())");
    expect(headless).toContain('phase: "storage_migration"');
    expect(headless.indexOf("if (!computerStorageReady())")).toBeLessThan(
      headless.indexOf("executeComputerVerticalProbe()"),
    );
    expect(headless).toContain('emit(runId, "always_day"');
  });

  it("hands every Computer System interaction to the bounded Web companion bridge", async () => {
    const [main, computer, portable, bridge] = await Promise.all([
      source("src/bedrock/main.ts"),
      source("src/bedrock/computerComponent.ts"),
      source("src/bedrock/portableComputer.ts"),
      source("src/bedrock/webTerminalBridge.ts"),
    ]);

    expect(main).toContain("startWebTerminalBridge");
    expect(main).toContain("handleWebTerminalScriptEvent");
    expect(main).toContain("handleDebugWebSessionRequest");
    expect(computer).toContain(
      "requestWebComputerTerminal(player, record, event.block)",
    );
    expect(portable).toContain("requestWebComputerTerminal(source, record)");
    expect(bridge).toContain("CS_WEB_SESSION_REQUEST");
    expect(bridge).toContain("CS_WEB_SESSION_READY");
    expect(bridge).toContain("computer_system:web-reject");
    expect(bridge).toContain(
      "selectComputerTerminal(principal.player.id, record.computerId)",
    );
    expect(bridge).toContain("CS_WEB_TERMINAL");
    expect(bridge).toContain("const displayState = record.display.state.kind");
    expect(bridge).toContain("maxSnapshotsPerPass = 2");
    expect(bridge).toContain("maxEagerSnapshotsPerPass = 4");
    expect(bridge).toContain("TerminalSnapshotScheduler");
    expect(bridge).toContain("snapshotScheduler.requestEager");
    expect(bridge).toContain("snapshotScheduler.takePeriodicBatch");
    expect(bridge).toContain("FloppyAudioEventBroker");
    expect(bridge).toContain("computer_system:web-floppy-eject");
    expect(bridge).toContain("ejectFloppyToPlayer");
    expect(bridge).toContain("CS_WEB_FLOPPY_EJECT");
    expect(bridge).toContain("audioCursor");
    expect(bridge).toContain("setFloppyActivityHandler");
    expect(bridge).toContain("sessionsByComputer");
    expect(bridge).toContain('"terminal_line"');
    expect(bridge).toContain('"terminal_keys"');
    expect(bridge).toContain('"terminal_mouse"');
    expect(bridge).toContain("isTerminalKeyBatch");
    expect(bridge).toContain("computerHost.runtime.terminalInteraction");
    expect(bridge).toContain("computerHost.runtime.executionStatus");
    expect(bridge).toContain("readonly execution: ComputerExecutionStatus");
    expect(bridge).toContain(
      "readonly interaction: TerminalInteractionDescriptor",
    );
    expect(bridge).toContain("flushPendingMouseMoves");
    expect(bridge).toContain("releaseMouseButtons");
    expect(bridge).toContain('"terminal_closed"');
    expect(bridge).toContain("WebTerminalAccessRegistry");
    expect(bridge).toContain("terminalAccess.canWrite");
    expect(bridge).toContain("detached.wasLast");
    expect(bridge).toContain("rejectSession");
    expect(bridge).toContain("isInitialWebTerminalAccessAllowed");
    expect(bridge).toContain("nextWebTerminalRangeAccess");
    expect(bridge).toContain("rangeCheckDisabledForDebug");
    expect(bridge).toContain('debugMarker === "debug"');
    expect(bridge).toContain('setSessionAccess(session, "out_of_range")');
    expect(bridge).toContain('setSessionAccess(session, "in_range")');
    expect(bridge).not.toContain("Web Terminal paused:");
    expect(bridge).not.toContain("Web Terminal reconnected:");
    expect(bridge).toContain("Connection code:");
    expect(bridge).toContain('kind: "debug"');
    expect(bridge).toContain("principalKind: principal.kind");
    expect(bridge).toContain('error: "floppy_eject_requires_player"');
    const debugBridge = await source("src/bedrock/debugWebSessionBridge.ts");
    expect(main).toContain(
      "handleDebugWebSessionRequest(event.message, event.sourceType)",
    );
    expect(debugBridge).toContain("sourceType !== ScriptEventSource.Server");
    expect(debugBridge).toContain('error: "server_source_required"');
    expect(debugBridge).toContain("requestDebugWebComputerTerminal(record)");
    expect(debugBridge).not.toContain("world.getAllPlayers()");
    expect(debugBridge).toContain("CS_DEBUG_WEB_REQUEST");
    const listBridge = await source("src/bedrock/debugComputerListBridge.ts");
    expect(listBridge).toContain("blockObservationPage");
    expect(listBridge).toContain("CS_DEBUG_COMPUTER_LIST");
    expect(listBridge).not.toContain("requestWebComputerTerminal");
  });

  it("correlates every bounded Web input with an explicit admission result", async () => {
    const bridge = await source("src/bedrock/webTerminalBridge.ts");
    const handlerStart = bridge.indexOf("function handleInput");
    const handlerEnd = bridge.indexOf("function parseTerminalMouseEvent");
    const finalizerStart = bridge.indexOf("function finalizeInputRequest");
    const finalizerEnd = bridge.indexOf("function requireActiveSession");
    const flushStart = bridge.indexOf("function flushPendingMouseMove");
    const flushEnd = bridge.indexOf("function releaseMouseButtons");

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(finalizerStart).toBeGreaterThan(-1);
    expect(finalizerEnd).toBeGreaterThan(finalizerStart);
    expect(flushStart).toBeGreaterThan(-1);
    expect(flushEnd).toBeGreaterThan(flushStart);

    const handler = bridge.slice(handlerStart, handlerEnd);
    const finalizer = bridge.slice(finalizerStart, finalizerEnd);
    const mouseFlush = bridge.slice(flushStart, flushEnd);
    const markerWrite = finalizer.slice(
      finalizer.indexOf("console.warn"),
      finalizer.indexOf('if (result.outcome === "accepted")'),
    );

    expect(bridge).toContain('const inputMarker = "CS_WEB_INPUT "');
    expect(handler).toContain(
      "(?:(eof)|(abort-line|cancel|interrupt|line|keys|mouse)",
    );
    expect(handler).toContain(
      "interactionGeneration !== interaction.interactionGeneration",
    );
    expect(handler).toContain('resource: "session"');
    expect(handler).toContain('reason: "read_only"');
    expect(handler).toContain('session.principal.kind === "debug"');
    expect(handler).toContain("interaction.secretInput");
    expect(handler).toContain('reason: "secret_input"');
    expect(handler).toContain('reason: "input_mode_changed"');
    expect(handler).toContain('failedInputResult("malformed_input")');
    expect(handler).toContain('failedInputResult("invalid_encoding")');
    expect(handler.match(/computerHost\.runtime\.queueEvent/gu)).toHaveLength(
      4,
    );
    expect(handler.match(/const result = safeInputQueueResult/gu)).toHaveLength(
      4,
    );
    expect(handler.match(/finalizeInputRequest\(/gu)).toHaveLength(23);
    expect(handler).toContain('"terminal_eof"');
    expect(handler).not.toContain("snapshotScheduler.requestEager");

    expect(mouseFlush).toContain("pending.requestId");
    expect(mouseFlush).toContain("const result = safeInputQueueResult");
    expect(mouseFlush).toContain(
      "finalizeInputRequest(session.sessionId, pending.requestId, result)",
    );
    expect(mouseFlush).not.toContain("snapshotScheduler.requestEager");

    expect(bridge).toContain('failedInputResult("input_queue_failed")');
    expect(finalizer).toContain("...serializableRuntimeResult(result)");
    expect(finalizer).toContain('if (result.outcome === "accepted")');
    expect(finalizer).toContain("snapshotScheduler.requestEager(sessionId)");
    expect(markerWrite).toContain("sessionId");
    expect(markerWrite).toContain("requestId");
    expect(markerWrite).not.toContain("value");
    expect(markerWrite).not.toContain("message");
    expect(markerWrite).not.toContain("token");
  });

  it("short-circuits unchanged Web snapshots before copying the fixed cell grid", async () => {
    const bridge = await source("src/bedrock/webTerminalBridge.ts");
    const start = bridge.indexOf("function emitSnapshot");
    const end = bridge.indexOf("function pruneExpiredRequests", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const emit = bridge.slice(start, end);

    expect(bridge).toContain("lastTerminalRevision?: number");
    expect(bridge).toContain("lastReplacementEpoch?: number");
    expect(bridge).toContain("readonly replacementEpoch: number");
    expect(bridge).toContain("lastSnapshotMetadata?: string");
    expect(bridge).toContain("sharedSnapshotFrames");
    expect(emit).toContain("sharedSnapshotFrames.get(record.computerId)");
    expect(bridge).toContain("sharedSnapshotFrames.delete(session.computerId)");
    expect(
      emit.indexOf("const terminalRevision = record.terminal.revision"),
    ).toBeLessThan(emit.indexOf("record.terminal.snapshot()"));
    expect(
      emit.indexOf("const replacementEpoch = record.terminal.replacementEpoch"),
    ).toBeLessThan(emit.indexOf("record.terminal.snapshot()"));
    expect(emit).toContain("session.lastTerminal === record.terminal");
    expect(emit).toContain("session.lastTerminalRevision === terminalRevision");
    expect(emit).toContain("session.lastReplacementEpoch === replacementEpoch");
    expect(emit).toContain("session.lastSnapshotMetadata === metadata");
    expect(emit).toContain("const interaction =");
    expect(emit).toContain("interaction,");
    expect(emit).toContain("replacementEpoch,");
    expect(emit).toContain("terminalRevision,");
    expect(bridge).toContain("cached.replacementEpoch === replacementEpoch");
    expect(emit).toContain("const execution:");
    expect(emit).toContain("execution,");
    expect(emit).not.toContain("secretInput,");
    expect(emit).toContain("audio.events.length === 0");
    expect(emit.match(/record\.terminal\.snapshot\(\)/gu)).toHaveLength(1);
    expect(emit.match(/JSON\.stringify/gu)).toHaveLength(2);
    expect(emit).not.toContain("const comparison");
  });

  it("keeps the Bedrock Core prototype isolated from the production DDUI coordinator", async () => {
    const [main, probe, coordinator] = await Promise.all([
      source("src/bedrock/main.ts"),
      source("src/bedrock/probes/uiProbe.ts"),
      source("src/bedrock/computerTerminal.ts"),
    ]);

    expect(main).toContain('case "ui-custom"');
    expect(main).toContain('case "ui-nano"');
    expect(probe).toContain("showCustomTerminalProbe");
    expect(probe).toContain("showNanoProbe");
    expect(probe).toContain("showCustomTerminalView");
    expect(coordinator).toContain("showTerminalView");
    expect(coordinator).not.toContain("showCustomTerminalView");
  });

  it("uses the built-in desktop CRT without registering a standalone Monitor route", async () => {
    const [main, computer, coordinator] = await Promise.all([
      source("src/bedrock/main.ts"),
      source("src/bedrock/computerComponent.ts"),
      source("src/bedrock/computerTerminal.ts"),
    ]);

    expect(main).not.toContain("registerMonitorComponent");
    expect(main).not.toContain('case "monitor"');
    expect(computer).toContain(
      "requestWebComputerTerminal(player, record, event.block)",
    );
    expect(computer).not.toContain("adjacentDesktopComputers");
    expect(computer).not.toContain("hasAdjacentMonitor");
    expect(coordinator).toContain("TerminalTargetRegistry");
    expect(coordinator).not.toContain("openSelectedComputerTerminal");
  });

  it("tells a crashed machine's operator only the recovery its profile really has", async () => {
    const coordinator = await source("src/bedrock/computerTerminal.ts");

    expect(coordinator).toContain("safeBootBypassesStartupProgram(record)");
    expect(coordinator).toContain("Read the halt screen");
    expect(coordinator).toContain("safe boot without bootable floppy media.");
    expect(coordinator).toContain("Bootable floppy media was skipped once.");
    // The `/startup.py` promise must stay behind the capability check instead of
    // being the single unconditional message a Portable CS386SX also receives.
    expect(coordinator).not.toMatch(
      /player\.sendMessage\(\s*"Computer is crashed\./u,
    );
  });

  it("guards a broken Computer coordinate until residual block cleanup finishes", async () => {
    const computer = await source("src/bedrock/computerComponent.ts");

    expect(computer).toContain("scheduleOwnedFinalization(");
    expect(computer).toContain("if (breakingBlocks.has(physicalKey)) return");
    expect(computer).toContain('residual.setType("minecraft:air")');
    expect(computer).toContain("giveComputerItem(player");
    expect(computer).toContain("!isComputerBlock(block.typeId)");
  });

  it("exposes a bounded GDK competing-form probe with per-session finalization counts", async () => {
    const [main, probe] = await Promise.all([
      source("src/bedrock/main.ts"),
      source("src/bedrock/probes/uiProbe.ts"),
    ]);

    expect(main).toContain('case "compete"');
    expect(probe).toContain("startTerminalCompetitionProbe");
    expect(probe).toContain("CS_TERMINAL_COMPETE");
    expect(probe).toContain('report("challenger", kind, detail)');
    expect(probe).toContain('report("holder", kind, detail)');
  });

  it("records real-player terminal closure for the isolated BDS disconnect harness", async () => {
    const [probe, runner, packageJson] = await Promise.all([
      source("src/bedrock/probes/uiProbe.ts"),
      source("tools/bds-probe-runner.mjs"),
      source("package.json"),
    ]);

    expect(probe).toContain("CS_TERMINAL_CLOSE");
    expect(runner).toContain('process.argv.includes("--disconnect")');
    expect(runner).toContain("BDS_DISCONNECT_READY");
    expect(runner).toContain("verifyDisconnect(session)");
    expect(runner).toContain("session.terminalCloseRecords.length !== 1");
    expect(runner).toContain(
      'const storageMigrationLogPrefix = "CS_STORAGE_MIGRATION "',
    );
    expect(runner).toContain('if (migration.state === "complete")');
    expect(runner).toContain("!probeSent");
    expect(runner).toContain('"runtime"');
    expect(runner).toContain("resetManagedDirectory(workRoot)");
    expect(runner).toContain(
      "const executable = path.join(serverRoot, executableName)",
    );
    expect(packageJson).toContain('"test:bds:disconnect"');
  });

  it("exposes bounded background and continuous-output GDK probes", async () => {
    const [main, probe] = await Promise.all([
      source("src/bedrock/main.ts"),
      source("src/bedrock/probes/uiProbe.ts"),
    ]);

    expect(main).toContain('case "stream"');
    expect(probe).toContain("startTerminalStreamProbe");
    expect(probe).toContain("CS_TERMINAL_STREAM");
    expect(probe).toContain("updates !== 200");
    expect(probe).toContain("system.clearRun(streamRun)");
    expect(probe).toContain('color === 15 ? "█" : " "');
  });
});

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}

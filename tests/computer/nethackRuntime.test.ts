import { describe, expect, it, vi } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import {
  type ComputerWorkAttempt,
  type ComputerWorkClaim,
  ComputerWorkMonitor,
  type TickWorkScope,
} from "../../src/application/runtime/computerWorkMonitor.js";
import { buildGuestNethackExecutable } from "../../src/application/toolchain/guestNethackBuilder.js";
import { guestNethackSourceFiles } from "../../src/application/toolchain/guestNethack.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import type { CpuProcessSliceResult } from "../../src/domain/runtime/cpuProcess.js";
import type { TerminalBufferSnapshot } from "../../src/domain/terminal/terminalBuffer.js";

describe("NetHack for CS-Linux", (): void => {
  it("presents one non-deferred frame within three modeled ticks across the corridor boundary", (): void => {
    const sameRoom = launchDeterministicGame("c-006411");
    expect(findPlayerGlyph(sameRoom.record.terminal.snapshot())).toEqual({
      column: 50,
      row: 14,
    });
    const sameRoomMove = moveToFrame(sameRoom.runtime, sameRoom.record, "l", {
      column: 51,
      row: 14,
    });
    const boundaryMove = moveToFrame(sameRoom.runtime, sameRoom.record, "h", {
      column: 50,
      row: 14,
    });
    const corridorBoundaryMove = moveToFrame(
      sameRoom.runtime,
      sameRoom.record,
      "h",
      { column: 49, row: 14 },
    );
    const corridorFrame = sameRoom.record.terminal.snapshot();
    // The straight corridor reaches the lit room to the west, but its dark
    // intermediate cells stay hidden beyond the adjacent segment. The lit room
    // around the distant L-turn is geometrically close enough yet occluded.
    expect(corridorFrame.rows[14]?.[41]).toBe(".");
    expect(corridorFrame.rows[14]?.[42]).toBe(" ");
    expect(corridorFrame.rows[14]?.[48]).toBe("#");
    expect(corridorFrame.rows[4]?.[45]).toBe(" ");

    expect(boundaryMove.ticks).toBeGreaterThan(0);
    expect(boundaryMove.ticks).toBeLessThanOrEqual(3);

    for (const move of [sameRoomMove, corridorBoundaryMove]) {
      // Verify: issue the deterministic key and advance only modeled scheduler
      // ticks. Expect: the guest publishes exactly one complete terminal frame
      // without retaining a deferred terminal write.
      expect(move.ticks).toBeGreaterThan(0);
      expect(move.ticks).toBeLessThanOrEqual(3);
      expect(move.presents).toBe(1);
      expect(move.terminalDeferrals).toBe(0);
      // The monitor exposes admitted guest CPU operations, not instruction or
      // cycle totals. It still proves the frame came from guest CPU progress.
      expect(move.guestCpuAdmissions).toBeGreaterThan(0);
    }

    // The transition may cost more guest work than an ordinary same-room move,
    // but it must retain the interactive modeled-tick bound.
    expect(corridorBoundaryMove.ticks).toBeLessThanOrEqual(
      sameRoomMove.ticks + 2,
    );
    // Issue #113 measured the previous full-frame path at 599,742 guest
    // instructions and 1,187,623 modeled cycles. The corridor transition must
    // remove at least 30% of that dominant serial work and stay close to the
    // ordinary move beside it.
    expect(corridorBoundaryMove.guestInstructions).toBeLessThanOrEqual(419_819);
    expect(corridorBoundaryMove.guestCpuCycles).toBeLessThanOrEqual(831_336);
    expect(corridorBoundaryMove.guestInstructions).toBeLessThanOrEqual(
      Math.floor(sameRoomMove.guestInstructions * 1.1),
    );
    expect(corridorBoundaryMove.guestCpuCycles).toBeLessThanOrEqual(
      Math.floor(sameRoomMove.guestCpuCycles * 1.1),
    );
  }, 900_000);

  it("advances four corridor transitions without starvation or a presentation retry storm", (): void => {
    const runtime = new ComputerRuntime();
    const records = Array.from(
      { length: 4 },
      (_, index) => new ComputerRecord(`c-00642${String(index)}`, "standard"),
    );
    for (const record of records) {
      runtime.register(record);
      runtime.powerOn(record.computerId);
      completeBoot(runtime, record);
      prepareDeterministicGame(runtime, record);
    }

    const applyFrames = records.map((record) =>
      vi.spyOn(record.terminal, "applyFrame"),
    );
    try {
      for (const record of records) {
        expect(
          runtime.queueEvent(record.computerId, "terminal_keys", '["h"]'),
        ).toMatchObject({ outcome: "accepted" });
      }
      const monitor = new ComputerWorkMonitor({
        nowMicroseconds: (): number => 0,
      });
      let ticks = 0;
      while (
        ticks < 4 &&
        records.some(
          (record) =>
            findPlayerGlyph(record.terminal.snapshot())?.column !== 49,
        )
      ) {
        ticks += 1;
        const scope = monitor.beginTick(ticks);
        runtime.runTick(scope);
        scope.finish();
      }

      expect(ticks).toBeGreaterThan(0);
      expect(ticks).toBeLessThanOrEqual(4);
      for (const [index, record] of records.entries()) {
        expect(findPlayerGlyph(record.terminal.snapshot())).toEqual({
          column: 49,
          row: 14,
        });
        expect(applyFrames[index]?.mock.calls).toHaveLength(1);
      }
      const work = monitor.snapshot();
      expect(work.lanes.guest_cpu.deferred).toBe(0);
      expect(work.lanes.terminal.deferred).toBe(0);
    } finally {
      for (const applyFrame of applyFrames) applyFrame.mockRestore();
    }
  }, 900_000);

  it("renders the next interactive frame within 500 scheduler ticks", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006406", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    launchGame(runtime, record);
    const before = terminalText(record);

    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    let elapsedTicks = 0;
    while (elapsedTicks < 500 && terminalText(record) === before) {
      runtime.runTick();
      elapsedTicks += 1;
    }

    expect(terminalText(record)).not.toBe(before);
    expect(elapsedTicks).toBeLessThanOrEqual(500);
  });

  it("renders every game cell with the black terminal background", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006407", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    launchGame(runtime, record);
    const before = terminalText(record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record) !== before);

    const background = record.terminal.snapshot().background;
    for (let y = 0; y < 21; y += 1) {
      expect(background[y]?.slice(0, 78)).toEqual(
        Array.from({ length: 78 }, () => 15),
      );
    }
  });

  it("ships the deterministic compiler-built executable and runs PATH arguments", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006401", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    expect(record.filesystem.readFile("/usr/games/nethack")).toBe(
      `CS486\n${JSON.stringify(buildGuestNethackExecutable())}`,
    );
    expect(record.filesystem.getMetadata("/usr/games/nethack")).toMatchObject({
      gid: 0,
      mode: 0o755,
      uid: 0,
    });

    submitAndComplete(runtime, record, "nethack --version");
    expect(lastStatus(runtime, record)).toBe("0\n");
    expect(terminalText(record)).toContain("NetHack for CS-Linux 1.0");

    submitAndComplete(runtime, record, "nethack --help");
    expect(terminalText(record)).toContain("hjklyubn");
    expect(lastStatus(runtime, record)).toBe("0\n");

    submitAndComplete(runtime, record, "nethack --unknown");
    expect(terminalText(record)).toContain("unknown argument");
    expect(lastStatus(runtime, record)).toBe("2\n");
  });

  it("saves only on S, restores the RNG record, and preserves it on quit/disconnect", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006402", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    launchGame(runtime, record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["S"]'),
    ).toMatchObject({ outcome: "accepted" });
    waitForShell(runtime, record);
    const savePath = "/home/cs/.nethack.sav";
    expect(record.filesystem.exists(savePath)).toBe(true);
    expect(record.filesystem.getMetadata(savePath)).toMatchObject({
      gid: 1000,
      mode: 0o600,
      uid: 1000,
    });
    const saved = record.filesystem.readFile(savePath);
    expect([...saved.slice(0, 4)]).toEqual(["C", "S", "N", "H"]);
    expect([...saved]).toHaveLength(2193);
    expect(
      Array.from(saved, (character) => character.codePointAt(0)!).slice(0, 5),
    ).toEqual([67, 83, 78, 72, 3]);

    launchGame(runtime, record);
    expect(
      runtime.queueEvent(
        record.computerId,
        "terminal_keys",
        '["#","q","u","i","t"]',
      ),
    ).toMatchObject({ outcome: "accepted" });
    waitForShell(runtime, record);
    expect(record.filesystem.readFile(savePath)).toBe(saved);

    launchGame(runtime, record);
    expect(
      runtime.queueEvent(
        record.computerId,
        "terminal_keys",
        '["#","q","u","i","t"]',
      ),
    ).toMatchObject({ outcome: "accepted" });
    waitForShell(runtime, record);
    expect(record.filesystem.readFile(savePath)).toBe(saved);

    launchGame(runtime, record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    runtime.runTick();
    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 4; tick += 1) runtime.runTick();
    expect(record.filesystem.readFile(savePath)).toBe(saved);
    expect(record.filesystem.exists(`${savePath}.tmp`)).toBe(false);
  });

  it("restores the generated map, entities, inventory record, and frame after S", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006408", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    launchGame(runtime, record);
    const initial = terminalText(record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record) !== initial);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["S"]'),
    ).toMatchObject({ outcome: "accepted" });
    waitForShell(runtime, record);

    launchGame(runtime, record);
    const beforeReload = terminalText(record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record) !== beforeReload);
    expect(terminalText(record)).toContain("@");
    expect(terminalText(record)).toContain(".");
  });

  it("uses the v3 fixed-slot inventory through its screen, selection help, and class commands", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006412", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    createSeedSave(runtime, record, {
      armorSlot: 4,
      inventory: [
        { quantity: 2, type: 0 },
        { quantity: 1, type: 1 },
        { quantity: 1, type: 2 },
        { quantity: 1, type: 3 },
        { quantity: 1, type: 4 },
      ],
      weaponSlot: 3,
    });

    launchGame(runtime, record);
    queueGameKeys(runtime, record, ["i"]);
    runUntil(runtime, () => terminalText(record).includes("Inventory"));
    const inventorySnapshot = record.terminal.snapshot();
    expect(inventorySnapshot.rows).toHaveLength(25);
    expect(inventorySnapshot.rows[0]).toHaveLength(80);
    const inventory = terminalText(record);
    // The screen, rather than an implementation-only message, exposes the
    // fixed a-p protocol.  The seeded first five slots prove that letters,
    // names/quantities, and both equipped annotations share one stable view.
    expect(inventory).toMatch(/a\).*2 food ration/);
    expect(inventory).toMatch(/b\).*potion/);
    expect(inventory).toMatch(/c\).*scroll/);
    expect(inventory).toMatch(/d\).*\(.*dagger/);
    expect(inventory).toMatch(/e\).*\].*leather armor/);
    queueGameKeys(runtime, record, ["\u001b"]);

    // `?` and `*` may display the full inventory, but neither may consume a
    // turn; Esc must leave the selection without mutating the save.
    queueGameKeys(runtime, record, [
      "e",
      "?",
      "\u001b",
      "q",
      "*",
      "\u001b",
      "S",
    ]);
    waitForShell(runtime, record);
    const afterSelection = readNethackSave(record);
    expect(afterSelection[6]).toBe(0);
    expect(afterSelection[35]).toBe(2);
    expect(afterSelection[NETHACK_SAVE_V2_WORDS]).toBe(4);
    expect(afterSelection[NETHACK_SAVE_V2_WORDS + 1]).toBe(5);

    for (const [command, slot] of [
      ["e", 0],
      ["q", 1],
      ["r", 2],
    ] as const) {
      createSeedSave(runtime, record, {
        inventory: [{ quantity: 2, type: slot }],
      });
      playAndSave(runtime, record, [command, "a"]);
      const saved = readNethackSave(record);
      expect(saved[6]).toBe(1);
      expect(saved[18]).toBe(1);
      expect(saved[35]).toBe(1);
    }

    createSeedSave(runtime, record, {
      inventory: [
        { quantity: 1, type: 0 },
        { quantity: 1, type: 1 },
        { quantity: 1, type: 2 },
      ],
    });
    playAndSave(runtime, record, ["e", "a"]);
    const stableGap = readNethackSave(record);
    expect(stableGap[18]).toBe(2);
    expect(stableGap.slice(19, 22)).toEqual([0, 1, 2]);
    expect(stableGap.slice(35, 38)).toEqual([0, 1, 1]);
    launchGame(runtime, record);
    queueGameKeys(runtime, record, ["i"]);
    runUntil(runtime, () => terminalText(record).includes("Inventory"));
    const gapScreen = terminalText(record);
    expect(gapScreen).toMatch(/b\).*potion/);
    expect(gapScreen).toMatch(/c\).*scroll/);
    queueGameKeys(runtime, record, ["\u001b", "S"]);
    waitForShell(runtime, record);

    createSeedSave(runtime, record, {
      inventory: [{ quantity: 1, type: 3 }],
    });
    playAndSave(runtime, record, ["w", "a"]);
    expect(readNethackSave(record).slice(6, 7)).toEqual([1]);
    expect(readNethackSave(record)[NETHACK_SAVE_V2_WORDS]).toBe(1);
    playAndSave(runtime, record, ["w", "-"]);
    expect(readNethackSave(record).slice(6, 7)).toEqual([2]);
    expect(readNethackSave(record)[NETHACK_SAVE_V2_WORDS]).toBe(0);

    createSeedSave(runtime, record, {
      inventory: [{ quantity: 1, type: 4 }],
    });
    playAndSave(runtime, record, ["W", "a"]);
    expect(readNethackSave(record).slice(6, 7)).toEqual([1]);
    expect(readNethackSave(record)[NETHACK_SAVE_V2_WORDS + 1]).toBe(1);
    playAndSave(runtime, record, ["T"]);
    expect(readNethackSave(record).slice(6, 7)).toEqual([2]);
    expect(readNethackSave(record)[NETHACK_SAVE_V2_WORDS + 1]).toBe(0);
  }, 900_000);

  it("drops and picks up stacked ground items transactionally at capacity", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006413", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    createSeedSave(runtime, record, {
      inventory: [{ quantity: 2, type: 3 }],
    });
    playAndSave(runtime, record, ["d", "a"]);
    let saved = readNethackSave(record);
    expect(saved[6]).toBe(1);
    expect(saved[18]).toBe(0);
    expect(unpackGroundItem(saved, 0)).toMatchObject({ quantity: 2, type: 3 });

    playAndSave(runtime, record, [","]);
    saved = readNethackSave(record);
    expect(saved[6]).toBe(2);
    expect(saved[18]).toBe(1);
    expect(saved[35]).toBe(2);
    expect(unpackGroundItem(saved, 0)).toMatchObject({
      active: 0,
      quantity: 0,
    });

    createSeedSave(runtime, record, {
      ground: [{ quantity: 4, type: 3 }],
      inventory: [],
    });
    playAndSave(runtime, record, ["i", "\u001b"]);
    saved = readNethackSave(record);
    // Two high packed bits carry quantity-minus-one, so a legal four-item
    // stack must survive a v3 round-trip without widening the word format.
    expect(saved[6]).toBe(0);
    expect(unpackGroundItem(saved, 0)).toMatchObject({
      active: 1,
      quantity: 4,
      type: 3,
    });

    createSeedSave(runtime, record, {
      ground: [{ quantity: 1, type: 3 }],
      inventory: [{ quantity: 1, type: 3 }],
    });
    playAndSave(runtime, record, ["d", "a"]);
    saved = readNethackSave(record);
    expect(saved[6]).toBe(1);
    expect(saved[18]).toBe(0);
    expect(unpackGroundItem(saved, 0)).toMatchObject({
      active: 1,
      quantity: 2,
      type: 3,
    });

    createSeedSave(runtime, record, {
      ground: [{ quantity: 1, type: 15 }],
      inventory: Array.from({ length: 16 }, (_value, type) => ({
        quantity: 1,
        type,
      })),
    });
    playAndSave(runtime, record, [","]);
    saved = readNethackSave(record);
    // A duplicate type stacks at the exact 16-slot capacity.
    expect(saved[6]).toBe(1);
    expect(saved[35 + 15]).toBe(2);
    expect(unpackGroundItem(saved, 0).active).toBe(0);

    createSeedSave(runtime, record, {
      ground: [{ quantity: 1, type: 16 }],
      inventory: Array.from({ length: 16 }, (_value, type) => ({
        quantity: 1,
        type,
      })),
    });
    playAndSave(runtime, record, [","]);
    saved = readNethackSave(record);
    // Capacity plus one is an explicit rejection: neither the guest turn nor
    // either side of the move is partially committed.
    expect(saved[6]).toBe(0);
    expect(saved[18]).toBe(16);
    expect(unpackGroundItem(saved, 0)).toMatchObject({
      active: 1,
      quantity: 1,
      type: 16,
    });
  }, 900_000);

  it("loads exact v2 saves, round-trips v3 equipment, and rejects malformed v3 saves without rewriting them", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006414", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    createSeedSave(runtime, record, {
      armorSlot: 1,
      inventory: [
        { quantity: 1, type: 3 },
        { quantity: 1, type: 4 },
      ],
      weaponSlot: 0,
    });
    const current = readNethackSave(record);
    expect(current).toHaveLength(2_193);
    expect(current.slice(0, 5)).toEqual([67, 83, 78, 72, 3]);
    playAndSave(runtime, record, ["i", "\u001b"]);
    const roundTrip = readNethackSave(record);
    expect(roundTrip).toHaveLength(2_193);
    expect(roundTrip.slice(NETHACK_SAVE_V2_WORDS)).toEqual([1, 2]);

    const legacy = current.slice(0, NETHACK_SAVE_V2_WORDS);
    legacy[4] = 2;
    writeNethackSave(record, legacy);
    launchGame(runtime, record);
    runUntil(runtime, () => terminalText(record).includes("Dlvl:"));
    saveRunningGame(runtime, record);
    const migrated = readNethackSave(record);
    expect(migrated).toHaveLength(2_193);
    expect(migrated.slice(0, 5)).toEqual([67, 83, 78, 72, 3]);
    expect(migrated.slice(NETHACK_SAVE_V2_WORDS)).toEqual([0, 0]);

    for (const mutate of [
      (words: number[]): void => {
        words[18] = 17;
      },
      (words: number[]): void => {
        words[19] = 25;
      },
      (words: number[]): void => {
        words[35] = 0;
      },
      (words: number[]): void => {
        words[NETHACK_SAVE_V2_WORDS] = 17;
      },
      (words: number[]): void => {
        words[NETHACK_LEVEL_ZERO_ITEMS_OFFSET] = 1 << 18;
      },
    ]) {
      const malformed = current.slice();
      mutate(malformed);
      writeNethackSave(record, malformed);
      const before = record.filesystem.readFile(NETHACK_SAVE_PATH);
      launchGame(runtime, record);
      runUntil(runtime, () =>
        terminalText(record).includes("corrupt or unsupported save"),
      );
      expect(record.filesystem.readFile(NETHACK_SAVE_PATH)).toBe(before);
      expect(runtime.terminalInteraction(record.computerId).context).toBe(
        "cs-abi",
      );
      expect(
        runtime.queueEvent(record.computerId, "terminal_closed"),
      ).toMatchObject({ outcome: "accepted" });
      for (let tick = 0; tick < 4; tick += 1) runtime.runTick();
    }
  }, 900_000);

  it("fails an invalid HOME save before mutating the canonical file", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006403", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    submitAndComplete(runtime, record, "unset HOME");
    launchGame(runtime, record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["S"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record).includes("Save failed"));
    expect(record.filesystem.exists("/home/cs/.nethack.sav")).toBe(false);
    expect(terminalText(record)).toContain("Save failed");
    expect(runtime.terminalInteraction(record.computerId).context).toBe(
      "cs-abi",
    );
    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 4; tick += 1) runtime.runTick();
  });

  it("reports a corrupt save, preserves it, and keeps the new game explicit", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006405", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const savePath = "/home/cs/.nethack.sav";
    const corrupt = "CSNH";
    record.filesystem.writeFile(savePath, corrupt);
    record.filesystem.setMetadata(savePath, {
      gid: 1000,
      mode: 0o600,
      uid: 1000,
    });

    launchGame(runtime, record);
    runUntil(runtime, () => terminalText(record).includes("corrupt"));
    expect(terminalText(record)).toContain("corrupt or unsupported save");
    expect(record.filesystem.readFile(savePath)).toBe(corrupt);
    expect(runtime.terminalInteraction(record.computerId).context).toBe(
      "cs-abi",
    );
    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 4; tick += 1) runtime.runTick();
    expect(record.filesystem.readFile(savePath)).toBe(corrupt);
  });

  it("rebuilds a byte-identical executable with the guest make, cc, and ld", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006404", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const sourceRoot = "/home/cs/nethack";
    record.filesystem.makeDirectory(sourceRoot);
    record.filesystem.setMetadata(sourceRoot, {
      gid: 1000,
      mode: 0o755,
      uid: 1000,
    });
    for (const [name, contents] of guestNethackSourceFiles) {
      const path = `${sourceRoot}/${name}`;
      record.filesystem.writeFile(path, contents);
      record.filesystem.setMetadata(path, {
        gid: 1000,
        mode: 0o644,
        uid: 1000,
      });
    }
    const stockHash = runtime.executeDebugShellCommand(
      record.computerId,
      "sha256sum /usr/games/nethack",
    );
    expect(stockHash).toMatchObject({ outcome: "completed", exitCode: 0 });

    submitAndComplete(runtime, record, `cd ${sourceRoot}`);
    submitAndComplete(runtime, record, "make");
    expect(lastStatus(runtime, record)).toBe("0\n");
    expect(record.filesystem.readFile(`${sourceRoot}/nethack`)).toBe(
      record.filesystem.readFile("/usr/games/nethack"),
    );
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        `sha256sum ${sourceRoot}/nethack`,
      ),
    ).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: (stockHash as { readonly stdout: string }).stdout.replace(
        "/usr/games/nethack",
        `${sourceRoot}/nethack`,
      ),
    });
  });

  it("renders the player glyph with a visible foreground color", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006409", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    launchGame(runtime, record);
    const before = terminalText(record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record) !== before);

    const snapshot = record.terminal.snapshot();
    const playerPosition = findPlayerGlyph(snapshot);
    expect(playerPosition).not.toBeNull();
    const { row: playerRow, column: playerColumn } = playerPosition!;
    expect(snapshot.foreground[playerRow]?.[playerColumn]).toBe(0);
    expect(snapshot.background[playerRow]?.[playerColumn]).toBe(15);
  });

  it("resets the terminal after NetHack exits through Ctrl+C", (): void => {
    const { runtime, record } = launchDeterministicGame("c-006410");
    const before = terminalText(record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["h"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record) !== before);
    const duringSnapshot = record.terminal.snapshot();
    const playerPosition = findPlayerGlyph(duringSnapshot);
    expect(playerPosition).not.toBeNull();
    const duringForeground = duringSnapshot.foreground;
    expect(
      duringForeground.some((row) =>
        row.slice(0, 78).some((value) => value === 7 || value === 8),
      ),
    ).toBe(true);

    expect(runtime.interrupt(record.computerId)).toMatchObject({
      outcome: "accepted",
    });
    for (let tick = 0; tick < 4; tick += 1) runtime.runTick();

    expect(runtime.terminalInteraction(record.computerId).context).not.toBe(
      "cs-abi",
    );
    const { row: playerRow, column: playerColumn } = playerPosition!;
    const after = record.terminal.snapshot();
    expect(after.rows[playerRow]?.[playerColumn]).not.toBe("@");
    expect(terminalText(record)).toContain(`cs@${record.computerId}:~$`);
    expect(after.background[10]?.slice(0, 78)).toEqual(
      Array.from({ length: 78 }, () => 15),
    );
    expect(after.foreground[10]?.slice(0, 78)).toEqual(
      Array.from({ length: 78 }, () => 0),
    );
  });
});

const NETHACK_SAVE_PATH = "/home/cs/.nethack.sav";
const NETHACK_SAVE_V2_WORDS = 2_191;
const NETHACK_SAVE_V3_WORDS = 2_193;
const NETHACK_INVENTORY_TYPE_OFFSET = 19;
const NETHACK_INVENTORY_QUANTITY_OFFSET = 35;
// Per-level records begin with 32 packed monster/HP pairs (64 words), followed
// by 64 packed items.  The v2-compatible base stays intentionally unchanged.
const NETHACK_LEVEL_ZERO_ITEMS_OFFSET = 911 + 32 * 2;

interface NethackSeedItem {
  readonly quantity: number;
  readonly type: number;
}

interface NethackSeed {
  readonly armorSlot?: number;
  readonly ground?: readonly NethackSeedItem[];
  readonly inventory: readonly NethackSeedItem[];
  readonly weaponSlot?: number;
}

function createSeedSave(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  seed: NethackSeed,
): void {
  launchGame(runtime, record);
  saveRunningGame(runtime, record);
  const words = readNethackSave(record);
  expect(words).toHaveLength(NETHACK_SAVE_V3_WORDS);
  expect(words.slice(0, 5)).toEqual([67, 83, 78, 72, 3]);
  seedNethackSave(words, seed);
  writeNethackSave(record, words);
}

function seedNethackSave(words: number[], seed: NethackSeed): void {
  expect(seed.inventory.length).toBeLessThanOrEqual(16);
  expect(seed.ground?.length ?? 0).toBeLessThanOrEqual(64);
  words[6] = 0;
  words[7] = 0;
  words[14] = 50;
  words[15] = 14;
  words[71] = 50;
  words[81] = 14;
  words[18] = seed.inventory.length;
  for (let slot = 0; slot < 16; slot += 1) {
    const item = seed.inventory[slot];
    words[NETHACK_INVENTORY_TYPE_OFFSET + slot] = item?.type ?? 0;
    words[NETHACK_INVENTORY_QUANTITY_OFFSET + slot] = item?.quantity ?? 0;
  }
  words[NETHACK_SAVE_V2_WORDS] = (seed.weaponSlot ?? -1) + 1;
  words[NETHACK_SAVE_V2_WORDS + 1] = (seed.armorSlot ?? -1) + 1;

  // The deterministic level-zero fixture deliberately has no entities.  Keep
  // all locations on the saved player tile so pick-up and drop use no pathing.
  for (let item = 0; item < 64; item += 1)
    words[NETHACK_LEVEL_ZERO_ITEMS_OFFSET + item] = 0;
  for (const [index, item] of (seed.ground ?? []).entries())
    words[NETHACK_LEVEL_ZERO_ITEMS_OFFSET + index] = packGroundItem(
      1,
      item.type,
      50,
      14,
      item.quantity,
    );
}

function packGroundItem(
  active: number,
  type: number,
  x: number,
  y: number,
  quantity: number,
): number {
  return (
    (active & 1) |
    ((type & 31) << 1) |
    ((x & 127) << 6) |
    ((y & 31) << 13) |
    (((quantity - 1) & 3) << 18)
  );
}

function unpackGroundItem(
  words: readonly number[],
  index: number,
): { active: number; quantity: number; type: number; x: number; y: number } {
  const packed = words[NETHACK_LEVEL_ZERO_ITEMS_OFFSET + index]!;
  return {
    active: packed & 1,
    quantity: (packed & 1) === 0 ? 0 : ((packed >>> 18) & 3) + 1,
    type: (packed >>> 1) & 31,
    x: (packed >>> 6) & 127,
    y: (packed >>> 13) & 31,
  };
}

function readNethackSave(record: ComputerRecord): number[] {
  return Array.from(
    record.filesystem.readFile(NETHACK_SAVE_PATH),
    (character) => character.codePointAt(0)!,
  );
}

function writeNethackSave(
  record: ComputerRecord,
  words: readonly number[],
): void {
  record.filesystem.writeFile(
    NETHACK_SAVE_PATH,
    String.fromCodePoint(...words),
  );
  record.filesystem.setMetadata(NETHACK_SAVE_PATH, {
    gid: 1000,
    mode: 0o600,
    uid: 1000,
  });
}

function queueGameKeys(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  keys: readonly string[],
): void {
  expect(
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify(keys),
    ),
  ).toMatchObject({ outcome: "accepted" });
}

function playAndSave(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  keys: readonly string[],
): void {
  launchGame(runtime, record);
  queueGameKeys(runtime, record, [...keys, "S"]);
  waitForShell(runtime, record);
}

function saveRunningGame(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): void {
  queueGameKeys(runtime, record, ["S"]);
  waitForShell(runtime, record);
}

function launchGame(runtime: ComputerRuntime, record: ComputerRecord): void {
  waitForShell(runtime, record);
  expect(
    runtime.queueEvent(record.computerId, "terminal_line", "nethack"),
  ).toMatchObject({ outcome: "accepted" });
  runUntil(
    runtime,
    () => runtime.terminalInteraction(record.computerId).context === "cs-abi",
  );
  runtime.runTick();
}

function launchDeterministicGame(computerId: string): {
  readonly record: ComputerRecord;
  readonly runtime: ComputerRuntime;
} {
  const runtime = new ComputerRuntime();
  const record = new ComputerRecord(computerId, "standard");
  runtime.register(record);
  runtime.powerOn(record.computerId);
  completeBoot(runtime, record);
  prepareDeterministicGame(runtime, record);
  return { record, runtime };
}

function prepareDeterministicGame(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): void {
  launchGame(runtime, record);
  expect(
    runtime.queueEvent(record.computerId, "terminal_keys", '["S"]'),
  ).toMatchObject({ outcome: "accepted" });
  waitForShell(runtime, record);
  patchLevelZeroSave(record);
  launchGame(runtime, record);
  runUntil(runtime, () => terminalText(record).includes("Dlvl:"));
}

function patchLevelZeroSave(record: ComputerRecord): void {
  const savePath = "/home/cs/.nethack.sav";
  const words = Array.from(record.filesystem.readFile(savePath), (character) =>
    character.codePointAt(0)!,
  );
  expect(words).toHaveLength(2_193);
  expect(words.slice(0, 5)).toEqual([67, 83, 78, 72, 3]);

  // `nh_encode`/`nh_load` serialize one guest I/O word per JS string code point.
  // Keep the canonical header and current stats, then patch only level zero's
  // deterministic map seed, saved player locations, and entity records.
  words[7] = 0;
  words[14] = 50;
  words[15] = 14;
  words[51] = 12_345;
  words[61] = 1;
  words[71] = 50;
  words[81] = 14;
  for (let word = 91; word < 173; word += 1) words[word] = 0;
  for (let word = 911; word < 1_039; word += 1) words[word] = 0;

  record.filesystem.writeFile(savePath, String.fromCodePoint(...words));
}

interface FrameMoveResult {
  readonly guestCpuCycles: number;
  readonly guestCpuAdmissions: number;
  readonly guestInstructions: number;
  readonly presents: number;
  readonly terminalDeferrals: number;
  readonly ticks: number;
}

function moveToFrame(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  key: string,
  expectedPlayerPosition: { readonly column: number; readonly row: number },
): FrameMoveResult {
  const applyFrame = vi.spyOn(record.terminal, "applyFrame");
  try {
    let clock = 0;
    let guestCpuCycles = 0;
    let guestInstructions = 0;
    const monitor = new ComputerWorkMonitor({
      nowMicroseconds: (): number => ++clock,
    });
    expect(
      runtime.queueEvent(
        record.computerId,
        "terminal_keys",
        JSON.stringify([key]),
      ),
    ).toMatchObject({ outcome: "accepted" });

    let ticks = 0;
    while (ticks < 3) {
      ticks += 1;
      const scope = monitor.beginTick(ticks);
      const recordingScope = {
        tryRun<T>(
          claim: ComputerWorkClaim,
          operation: () => T,
        ): ComputerWorkAttempt<T> {
          const attempt = scope.tryRun(claim, operation);
          if (claim.lane === "guest_cpu" && attempt.outcome === "ran") {
            const slice = attempt.value as CpuProcessSliceResult;
            guestCpuCycles += slice.cpuCycles;
            guestInstructions += slice.executedInstructions;
          }
          return attempt;
        },
      } as unknown as TickWorkScope;
      runtime.runTick(recordingScope);
      scope.finish();
      if (
        findPlayerGlyph(record.terminal.snapshot())?.column ===
          expectedPlayerPosition.column &&
        findPlayerGlyph(record.terminal.snapshot())?.row ===
          expectedPlayerPosition.row
      )
        break;
    }

    expect(findPlayerGlyph(record.terminal.snapshot())).toEqual(
      expectedPlayerPosition,
    );
    const work = monitor.snapshot();
    return {
      guestCpuCycles,
      guestCpuAdmissions: work.lanes.guest_cpu.admitted,
      guestInstructions,
      presents: applyFrame.mock.calls.length,
      terminalDeferrals: work.lanes.terminal.deferred,
      ticks,
    };
  } finally {
    applyFrame.mockRestore();
  }
}

function submitAndComplete(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  line: string,
): void {
  waitForShell(runtime, record);
  expect(
    runtime.queueEvent(record.computerId, "terminal_line", line),
  ).toMatchObject({ outcome: "accepted" });
  runtime.runTick();
  waitForShell(runtime, record);
}

function lastStatus(runtime: ComputerRuntime, record: ComputerRecord): string {
  const result = runtime.executeDebugShellCommand(record.computerId, "echo $?");
  if (result.outcome !== "completed")
    throw new Error("status command deferred");
  return result.stdout;
}

function waitForShell(runtime: ComputerRuntime, record: ComputerRecord): void {
  for (let tick = 0; tick < 2_000; tick += 1) {
    const state = runtime.vmState(record.computerId);
    if (
      runtime.terminalInteraction(record.computerId).inputMode === "line" &&
      state?.kind === "waiting_event" &&
      state.filter === undefined
    )
      return;
    runtime.runTick();
  }
  throw new Error(
    `shell wait timed out: ${JSON.stringify({
      interaction: runtime.terminalInteraction(record.computerId),
      lifecycle: record.lifecycle.state,
      display: record.display.state,
      text: terminalText(record),
      vm: runtime.vmState(record.computerId),
    })}`,
  );
}

function completeBoot(runtime: ComputerRuntime, record: ComputerRecord): void {
  runUntil(
    runtime,
    () =>
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post",
  );
}

function terminalText(record: ComputerRecord): string {
  return record.terminal.snapshot().rows.join("\n");
}

function findPlayerGlyph(
  snapshot: TerminalBufferSnapshot,
): { row: number; column: number } | null {
  for (let row = 0; row < snapshot.rows.length; row += 1) {
    const column = snapshot.rows[row]!.indexOf("@");
    if (column !== -1 && snapshot.background[row]?.[column] === 15)
      return { row, column };
  }
  return null;
}

function runUntil(runtime: ComputerRuntime, predicate: () => boolean): void {
  for (let tick = 0; tick < 2_000; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  throw new Error("runtime did not reach the expected NetHack state");
}

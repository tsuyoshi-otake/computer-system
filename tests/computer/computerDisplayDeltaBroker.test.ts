import { describe, expect, it } from "vitest";

import { ComputerDisplayDeltaBroker } from "../../src/application/display/computerDisplayDeltaBroker.js";
import { DisplayDevice } from "../../src/domain/display/displayDevice.js";

describe("ComputerDisplayDeltaBroker", (): void => {
  it("drains one Computer once and shares each bounded update with every consumer", (): void => {
    const display = activeTextDisplay();
    const broker = new ComputerDisplayDeltaBroker({
      maximumComputersPerPass: 1,
      maximumPayloadBytesPerPass: 512,
      maximumTilesPerComputerBatch: 2,
      maximumTilesPerPass: 2,
    });

    expect(broker.attach("c-one", "browser-a", display)).toMatchObject({
      outcome: "attached",
      consumerCount: 1,
    });
    expect(broker.attach("c-one", "browser-b", display)).toMatchObject({
      outcome: "attached",
      consumerCount: 2,
    });
    const state = broker.process();
    expect(state.publications).toHaveLength(1);
    expect(state.publications[0]).toMatchObject({
      consumerIds: ["browser-a", "browser-b"],
      update: { kind: "state", schema: 1, sequence: 1 },
    });

    const first = broker.process();
    expect(first).toMatchObject({
      outcome: "budget_exhausted",
      payloadBytes: 4,
      tiles: 2,
    });
    expect(first.publications).toHaveLength(1);
    expect(first.publications[0]).toMatchObject({
      consumerIds: ["browser-a", "browser-b"],
      update: { kind: "keyframe", outcome: "pending", sequence: 2 },
    });
    expect(display.dirtyTileCount).toBe(1_998);
  });

  it("queues a complete second keyframe for a consumer attached mid-frame", (): void => {
    const display = activeTextDisplay();
    const broker = new ComputerDisplayDeltaBroker({
      maximumComputersPerPass: 1,
      maximumTilesPerComputerBatch: 64,
      maximumTilesPerPass: 64,
    });
    broker.attach("c-late", "early", display);
    broker.process();
    expect(broker.process().publications[0]?.update.kind).toBe("keyframe");

    expect(broker.attach("c-late", "late", display)).toMatchObject({
      outcome: "attached",
      consumerCount: 2,
    });
    expect(broker.requestResync("c-late", "late")).toEqual({
      outcome: "queued",
      streamState: "resync_queued",
    });

    let completedKeyframes = 0;
    let tilesAfterFirstCompletion = 0;
    for (let pass = 0; pass < 80 && completedKeyframes < 2; pass += 1) {
      const publication = broker.process().publications[0];
      if (publication === undefined || publication.update.kind !== "keyframe") {
        continue;
      }
      expect(publication.consumerIds).toEqual(["early", "late"]);
      if (completedKeyframes === 1) {
        tilesAfterFirstCompletion += publication.update.tiles.length;
      }
      if (publication.update.outcome === "complete") completedKeyframes += 1;
    }
    expect(completedKeyframes).toBe(2);
    expect(tilesAfterFirstCompletion).toBe(2_000);
  });

  it("re-emits a tile changed after its first keyframe copy was drained", (): void => {
    const display = activeTextDisplay();
    const broker = new ComputerDisplayDeltaBroker({
      maximumComputersPerPass: 1,
      maximumTilesPerComputerBatch: 1,
      maximumTilesPerPass: 1,
    });
    broker.attach("c-write", "browser", display);
    broker.process();
    const first = broker.process().publications[0]!.update;
    expect(first.tiles[0]).toMatchObject({ x: 0, y: 0 });

    display.writeTextCell(1, 1, 65, 0x1f);
    let repeatedTile: Uint8Array | undefined;
    for (let pass = 0; pass < 2_100 && repeatedTile === undefined; pass += 1) {
      const update = broker.process().publications[0]?.update;
      const tile = update?.tiles.find(
        (candidate) => candidate.x === 0 && candidate.y === 0,
      );
      if (tile !== undefined) repeatedTile = tile.data;
    }
    expect([...repeatedTile!]).toEqual([65, 0x1f]);
  });

  it("increments epochs for mode and device replacement and publishes terminal states", (): void => {
    const display = activeTextDisplay();
    const broker = new ComputerDisplayDeltaBroker({
      maximumComputersPerPass: 1,
    });
    expect(broker.attach("c-state", "browser", display)).toMatchObject({
      epoch: 1,
    });
    expect(broker.process().publications[0]?.update).toMatchObject({
      epoch: 1,
      kind: "state",
      state: { kind: "text" },
    });

    display.transition({ kind: "select_mode", modeId: "vga-320x200x8" });
    expect(broker.process().publications[0]?.update).toMatchObject({
      epoch: 2,
      kind: "state",
      mode: { id: "vga-320x200x8" },
      state: { kind: "graphics" },
    });
    display.transition({ kind: "fault", message: "video fault" });
    expect(broker.process().publications[0]?.update).toMatchObject({
      epoch: 3,
      kind: "state",
      mode: undefined,
      state: { kind: "faulted", message: "video fault" },
    });

    const replacement = activeTextDisplay();
    expect(broker.attach("c-state", "browser", replacement)).toEqual({
      outcome: "display_replaced",
      consumerCount: 1,
      epoch: 4,
    });
    expect(broker.process().publications[0]?.update).toMatchObject({
      epoch: 4,
      kind: "state",
      profile: { id: "desktop-vga-512k" },
    });
    replacement.transition({ kind: "power_off" });
    expect(broker.process().publications[0]?.update).toMatchObject({
      epoch: 5,
      kind: "state",
      state: { kind: "off" },
    });
  });

  it("uses explicit detach and resync terminal outcomes and releases final state", (): void => {
    const broker = new ComputerDisplayDeltaBroker();
    const display = activeTextDisplay();
    broker.attach("c-detach", "a", display);
    broker.attach("c-detach", "b", display);

    expect(broker.requestResync("missing", "a")).toEqual({
      outcome: "not_found",
    });
    expect(broker.requestResync("c-detach", "missing")).toEqual({
      outcome: "not_attached",
    });
    expect(broker.detach("c-detach", "missing")).toEqual({
      outcome: "not_attached",
    });
    expect(broker.detach("c-detach", "a")).toEqual({
      outcome: "detached",
      consumerCount: 1,
    });
    expect(broker.detach("c-detach", "b")).toEqual({
      outcome: "released",
      consumerCount: 0,
    });
    expect(broker.computerCount).toBe(0);
    expect(broker.process()).toMatchObject({
      outcome: "idle",
      publications: [],
    });
    expect(broker.detach("c-detach", "b")).toEqual({ outcome: "not_found" });
  });

  it("bounds Computers, tiles, and bytes per pass while rotating fairly", (): void => {
    const broker = new ComputerDisplayDeltaBroker({
      maximumComputersPerPass: 1,
      maximumPayloadBytesPerPass: 256,
      maximumTilesPerComputerBatch: 1,
      maximumTilesPerPass: 1,
    });
    broker.attach("c-a", "a", activeTextDisplay());
    broker.attach("c-b", "b", activeTextDisplay());

    expect(broker.process().publications[0]?.update.computerId).toBe("c-a");
    expect(broker.process().publications[0]?.update.computerId).toBe("c-b");
    const third = broker.process();
    const fourth = broker.process();
    expect(third).toMatchObject({ inspectedComputers: 1, tiles: 1 });
    expect(fourth).toMatchObject({ inspectedComputers: 1, tiles: 1 });
    expect(third.payloadBytes).toBeLessThanOrEqual(256);
    expect(fourth.payloadBytes).toBeLessThanOrEqual(256);
    expect([
      third.publications[0]?.update.computerId,
      fourth.publications[0]?.update.computerId,
    ]).toEqual(["c-a", "c-b"]);
  });
});

function activeTextDisplay(): DisplayDevice {
  const display = new DisplayDevice("desktop-vga-512k");
  display.transition({ kind: "enter_post" });
  display.transition({ kind: "select_mode", modeId: "text-80x25" });
  return display;
}

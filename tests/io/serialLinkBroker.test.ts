import { describe, expect, it } from "vitest";

import { SerialLinkBroker } from "../../src/application/io/serialLinkBroker.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { machineFaces } from "../../src/domain/computer/machineFace.js";

describe("SerialLinkBroker", (): void => {
  it("supports six simultaneous face links without cross-talk", (): void => {
    const broker = new SerialLinkBroker();
    const center = record("c-000100");
    const peers = machineFaces.map((_, index) => record(`c-00010${index + 1}`));
    for (const computer of [center, ...peers]) {
      computer.faceIo.powerOn();
      broker.register(computer);
    }

    for (const [index, face] of machineFaces.entries()) {
      expect(
        broker.connect(
          { computerId: center.computerId, face },
          { computerId: peers[index]!.computerId, face: "front" },
        ),
      ).toEqual({ outcome: "connected" });
      expect(
        broker.write(
          { computerId: center.computerId, face },
          Uint8Array.of(index + 1),
        ),
      ).toEqual({ outcome: "accepted", bytes: 1 });
    }

    expect(broker.runTick()).toBe(6);
    for (const [index, peer] of peers.entries()) {
      expect(
        broker.read({ computerId: peer.computerId, face: "front" }),
      ).toEqual({ outcome: "read", bytes: Uint8Array.of(index + 1) });
    }
  });

  it("enforces 9600 8N1 throughput at 20 ticks per second", (): void => {
    const broker = new SerialLinkBroker();
    const left = record("c-000110");
    const right = record("c-000111");
    left.faceIo.powerOn();
    right.faceIo.powerOn();
    broker.register(left);
    broker.register(right);
    broker.connect(
      { computerId: left.computerId, face: "right" },
      { computerId: right.computerId, face: "left" },
    );
    const payload = Uint8Array.from({ length: 100 }, (_, index) => index);
    expect(
      broker.write({ computerId: left.computerId, face: "right" }, payload),
    ).toMatchObject({ outcome: "accepted" });

    expect(broker.runTick()).toBe(48);
    expect(
      broker.read({ computerId: right.computerId, face: "left" }),
    ).toMatchObject({ outcome: "read", bytes: payload.slice(0, 48) });
    expect(broker.runTick()).toBe(48);
    expect(
      broker.read({ computerId: right.computerId, face: "left" }),
    ).toMatchObject({ outcome: "read", bytes: payload.slice(48, 96) });
    expect(broker.runTick()).toBe(4);
  });

  it("clears both queues when topology changes", (): void => {
    const broker = new SerialLinkBroker();
    const left = record("c-000120");
    const right = record("c-000121");
    left.faceIo.powerOn();
    right.faceIo.powerOn();
    broker.register(left);
    broker.register(right);
    broker.connect(
      { computerId: left.computerId, face: "front" },
      { computerId: right.computerId, face: "back" },
    );
    broker.write(
      { computerId: left.computerId, face: "front" },
      Uint8Array.of(1, 2, 3),
    );
    broker.runTick();

    expect(
      broker.disconnect(
        { computerId: left.computerId, face: "front" },
        "neighbor_removed",
      ),
    ).toBe(true);
    expect(broker.read({ computerId: right.computerId, face: "back" })).toEqual(
      { outcome: "read", bytes: new Uint8Array() },
    );
    expect(
      broker.write(
        { computerId: left.computerId, face: "front" },
        Uint8Array.of(4),
      ),
    ).toEqual({ outcome: "disconnected" });
  });

  it("reports offline peers and resets bytes across a reboot epoch", (): void => {
    const broker = new SerialLinkBroker();
    const left = record("c-000130");
    const right = record("c-000131");
    left.faceIo.powerOn();
    right.faceIo.powerOn();
    broker.register(left);
    broker.register(right);
    broker.connect(
      { computerId: left.computerId, face: "top" },
      { computerId: right.computerId, face: "bottom" },
    );
    broker.write(
      { computerId: left.computerId, face: "top" },
      Uint8Array.of(1, 2),
    );
    right.faceIo.powerOff("reboot");

    expect(
      broker.write(
        { computerId: left.computerId, face: "top" },
        Uint8Array.of(3),
      ),
    ).toEqual({ outcome: "peer_offline" });
    right.faceIo.powerOn();
    broker.runTick();
    expect(
      broker.read({ computerId: right.computerId, face: "bottom" }),
    ).toEqual({ outcome: "read", bytes: new Uint8Array() });
  });

  it("removes disconnected ready links without stale queue scans", (): void => {
    const broker = new SerialLinkBroker({
      maximumLinksPerTick: 1,
      maximumReadyDequeuesPerTick: 1,
    });
    const activeLeft = record("c-000140");
    const activeRight = record("c-000141");
    for (let index = 0; index < 32; index += 1) {
      const left = record(`c-0002${String(index).padStart(2, "0")}`);
      const right = record(`c-0003${String(index).padStart(2, "0")}`);
      for (const computer of [left, right]) {
        computer.faceIo.powerOn();
        broker.register(computer);
      }
      const endpoint = { computerId: left.computerId, face: "right" } as const;
      broker.connect(endpoint, {
        computerId: right.computerId,
        face: "left",
      });
      broker.write(endpoint, Uint8Array.of(index));
      broker.disconnect(endpoint, "test_churn");
    }
    for (const computer of [activeLeft, activeRight]) {
      computer.faceIo.powerOn();
      broker.register(computer);
    }
    broker.connect(
      { computerId: activeLeft.computerId, face: "right" },
      { computerId: activeRight.computerId, face: "left" },
    );
    broker.write(
      { computerId: activeLeft.computerId, face: "right" },
      Uint8Array.of(0x2a),
    );

    expect(broker.runTick()).toBe(1);
    expect(
      broker.read({ computerId: activeRight.computerId, face: "left" }),
    ).toEqual({ outcome: "read", bytes: Uint8Array.of(0x2a) });
  });
});

function record(computerId: string): ComputerRecord {
  return new ComputerRecord(computerId, "standard");
}

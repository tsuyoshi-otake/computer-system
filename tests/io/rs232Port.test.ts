import { describe, expect, it } from "vitest";

import { ByteRingBuffer } from "../../src/domain/io/byteRingBuffer.js";
import { Rs232Port } from "../../src/domain/io/rs232Port.js";

describe("ByteRingBuffer", (): void => {
  it("preserves FIFO order across wraparound", (): void => {
    const ring = new ByteRingBuffer(5);
    expect(ring.write(Uint8Array.from([1, 2, 3, 4]))).toBe(true);
    expect([...ring.read(3)]).toEqual([1, 2, 3]);
    expect(ring.write(Uint8Array.from([5, 6, 7, 8]))).toBe(true);
    expect([...ring.read()]).toEqual([4, 5, 6, 7, 8]);
  });

  it("rejects an overflowing write without changing the queue", (): void => {
    const ring = new ByteRingBuffer(3);
    expect(ring.write(Uint8Array.from([1, 2]))).toBe(true);
    expect(ring.write(Uint8Array.from([3, 4]))).toBe(false);
    expect([...ring.read()]).toEqual([1, 2]);
  });
});

describe("Rs232Port", (): void => {
  it("moves a bounded full-duplex stream without cross-direction loss", (): void => {
    const left = port();
    const right = port();
    left.powerOn();
    right.powerOn();
    expect(left.write(Uint8Array.from([1, 2, 3]))).toEqual({
      outcome: "accepted",
      bytes: 3,
    });
    expect(right.write(Uint8Array.from([9, 8]))).toEqual({
      outcome: "accepted",
      bytes: 2,
    });

    expect(left.transferTo(right, 2)).toEqual({ outcome: "moved", bytes: 2 });
    expect(right.transferTo(left, 8)).toEqual({ outcome: "moved", bytes: 2 });
    expect(left.transferTo(right, 8)).toEqual({ outcome: "moved", bytes: 1 });
    expect([...left.read()]).toEqual([9, 8]);
    expect([...right.read()]).toEqual([1, 2, 3]);
  });

  it("uses atomic writes and receiver backpressure", (): void => {
    const sender = port();
    const receiver = port();
    sender.powerOn();
    receiver.powerOn();
    expect(sender.write(Uint8Array.from([1, 2, 3, 4, 5]))).toMatchObject({
      outcome: "write_limit_exceeded",
    });
    expect(sender.write(Uint8Array.from([1, 2, 3, 4]))).toMatchObject({
      outcome: "accepted",
    });
    expect(receiver.receive(Uint8Array.from([9, 9, 9, 9]))).toMatchObject({
      outcome: "accepted",
    });
    expect(sender.transferTo(receiver, 4)).toEqual({
      outcome: "receiver_blocked",
    });
    expect(sender.status.transmitBytes).toBe(4);
  });

  it("advances power epochs and accounts for reset bytes", (): void => {
    const serial = port();
    serial.powerOn();
    expect(serial.status.powerEpoch).toBe(1);
    expect(serial.status.resetEpoch).toBe(1);
    serial.write(Uint8Array.from([1, 2, 3]));
    serial.receive(Uint8Array.from([4, 5]));
    serial.powerOff("reboot");
    expect(serial.status).toMatchObject({
      droppedReceiveBytes: 2,
      droppedTransmitBytes: 3,
      lastResetReason: "reboot",
      powerEpoch: 2,
      powered: false,
      receiveBytes: 0,
      resetEpoch: 2,
      transmitBytes: 0,
    });
    serial.powerOn();
    expect(serial.status.powerEpoch).toBe(3);
  });
});

function port(): Rs232Port {
  return new Rs232Port({
    maximumWriteBytes: 4,
    receiveCapacity: 4,
    transmitCapacity: 4,
  });
}

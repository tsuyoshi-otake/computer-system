import { describe, expect, it } from "vitest";

import { I2cSegment } from "../../src/domain/io/i2cBus.js";
import { SpiBus } from "../../src/domain/io/spiBus.js";
import { PeripheralBusBroker } from "../../src/application/io/peripheralBusBroker.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { ComputerWorkMonitor } from "../../src/application/runtime/computerWorkMonitor.js";

describe("SpiBus", (): void => {
  it("performs one atomic fixed-length transfer", (): void => {
    const bus = new SpiBus();
    expect(
      bus.attach(0, {
        id: "flash",
        transfer: (bytes) => Uint8Array.from(bytes, (byte) => byte ^ 0xff),
      }),
    ).toEqual({ outcome: "attached" });
    expect(bus.transfer(0, Uint8Array.from([0x9f, 0x00]))).toEqual({
      outcome: "completed",
      receive: Uint8Array.from([0x60, 0xff]),
    });
  });

  it("reports chip-select conflicts and transfer limits", (): void => {
    const bus = new SpiBus();
    bus.attach(0, { id: "a", transfer: (bytes) => bytes });
    expect(bus.attach(0, { id: "b", transfer: (bytes) => bytes })).toEqual({
      outcome: "chip_select_conflict",
      chipSelect: 0,
    });
    expect(bus.transfer(0, new Uint8Array(257))).toMatchObject({
      outcome: "transfer_limit_exceeded",
    });
    expect(bus.transfer(0, new Uint8Array(1))).toEqual({
      outcome: "chip_select_conflict",
      chipSelect: 0,
    });
  });
});

describe("I2cSegment", (): void => {
  it("scans and performs bounded addressed write-read transactions", (): void => {
    const segment = new I2cSegment();
    segment.attach({
      address: 0x48,
      id: "temperature",
      transact: ({ write, readLength }) =>
        Uint8Array.from(
          { length: readLength },
          (_value, index) => (write[0] ?? 0) + index,
        ),
    });
    expect(segment.scan()).toEqual({ addresses: [0x48], conflicts: [] });
    expect(segment.transact(0x48, Uint8Array.from([0x10]), 2)).toEqual({
      outcome: "completed",
      read: Uint8Array.from([0x10, 0x11]),
    });
    expect(segment.transact(0x49, new Uint8Array(), 1)).toEqual({
      outcome: "nack",
      address: 0x49,
    });
  });

  it("reports duplicate addresses and size limits", (): void => {
    const segment = new I2cSegment();
    segment.attach({
      address: 0x20,
      id: "first",
      transact: ({ readLength }) => new Uint8Array(readLength),
    });
    expect(
      segment.attach({
        address: 0x20,
        id: "second",
        transact: ({ readLength }) => new Uint8Array(readLength),
      }),
    ).toEqual({ outcome: "address_conflict", address: 0x20 });
    expect(segment.scan()).toEqual({ addresses: [], conflicts: [0x20] });
    expect(segment.transact(0x20, new Uint8Array(), 1)).toEqual({
      outcome: "address_conflict",
      address: 0x20,
    });
    expect(segment.transact(0x21, new Uint8Array(200), 57)).toMatchObject({
      outcome: "transaction_limit_exceeded",
    });
  });
});

describe("PeripheralBusBroker OS boundary", (): void => {
  it("maps Linux bus 1 and DOS bus 2 to the same fixed right face", (): void => {
    const broker = new PeripheralBusBroker();
    const record = new ComputerRecord("c-000300", "standard");
    record.faceIo.powerOn();
    broker.register(record);
    expect(
      broker.attachSpi({ computerId: record.computerId, face: "right" }, 0, {
        id: "fixture-spi",
        transfer: (bytes) => Uint8Array.from(bytes, (byte) => byte ^ 0xff),
      }),
    ).toEqual({ outcome: "attached" });
    expect(
      broker.attachI2c(
        { computerId: record.computerId, face: "right" },
        {
          address: 0x48,
          id: "fixture-i2c",
          transact: ({ readLength }) =>
            Uint8Array.from({ length: readLength }, () => 0x2a),
        },
      ),
    ).toEqual({ outcome: "attached" });

    const linux = new ShellSession(record.filesystem, {
      computerName: record.computerId,
      peripherals: broker,
    });
    expect(linux.submit("spi 1 0 9f00")).toMatchObject({
      exitCode: 0,
      stdout: "60ff\n",
    });
    expect(linux.submit("i2c 1 scan")).toMatchObject({
      exitCode: 0,
      stdout: "0x48\n",
    });
    expect(linux.submit("i2c 1 0x48 10 2")).toMatchObject({
      exitCode: 0,
      stdout: "2a2a\n",
    });

    const dos = new ShellSession(record.filesystem, {
      computerName: record.computerId,
      osProfile: "dos",
      peripherals: broker,
    });
    expect(dos.submit("SPI 2 0 00")).toMatchObject({
      exitCode: 0,
      stdout: "ff\r\n",
    });
    expect(dos.submit("I2C 2 SCAN")).toMatchObject({
      exitCode: 0,
      stdout: "0x48\r\n",
    });
  });

  it("gates transactions on computer power", (): void => {
    const broker = new PeripheralBusBroker();
    const record = new ComputerRecord("c-000301", "standard");
    broker.register(record);
    expect(
      broker.attachSpi({ computerId: record.computerId, face: "bottom" }, 0, {
        id: "offline-fixture",
        transfer: (bytes) => bytes,
      }),
    ).toEqual({ outcome: "attached" });
    expect(
      broker.transferSpi(
        { computerId: record.computerId, face: "bottom" },
        0,
        Uint8Array.of(1),
      ),
    ).toEqual({ outcome: "powered_off" });
  });

  it("accounts I2C and SPI independently and exposes deterministic overflow", (): void => {
    const broker = new PeripheralBusBroker();
    const record = new ComputerRecord("c-000302", "standard");
    record.faceIo.powerOn();
    broker.register(record);
    const endpoint = { computerId: record.computerId, face: "right" } as const;
    broker.attachSpi(endpoint, 0, {
      id: "fixture-spi",
      transfer: (bytes) => bytes,
    });
    broker.attachI2c(endpoint, {
      address: 0x48,
      id: "fixture-i2c",
      transact: ({ readLength }) => new Uint8Array(readLength),
    });
    let clock = 0;
    const monitor = new ComputerWorkMonitor({
      nowMicroseconds: (): number => clock++,
    });
    const tick = monitor.beginTick(1);
    broker.setWorkScope(tick);

    expect(broker.transferSpi(endpoint, 0, Uint8Array.of(1))).toMatchObject({
      outcome: "completed",
    });
    expect(
      broker.transactI2c(endpoint, 0x48, Uint8Array.of(1), 1),
    ).toMatchObject({ outcome: "completed" });
    for (let index = 0; index < 7; index += 1) {
      broker.transactI2c(endpoint, 0x48, new Uint8Array(255), 1);
    }
    expect(
      broker.transactI2c(endpoint, 0x48, new Uint8Array(255), 1),
    ).toMatchObject({ outcome: "deferred", retryTick: 2 });

    broker.setWorkScope(undefined);
    tick.finish();
    expect(monitor.snapshot().lanes).toMatchObject({
      i2c: { admitted: 8, deferred: 1 },
      spi: { admitted: 1 },
    });
  });
});

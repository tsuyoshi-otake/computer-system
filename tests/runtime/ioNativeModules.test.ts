import { describe, expect, it } from "vitest";

import { PeripheralBusBroker } from "../../src/application/io/peripheralBusBroker.js";
import { SerialLinkBroker } from "../../src/application/io/serialLinkBroker.js";
import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";
import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("face I/O Python modules", (): void => {
  it("exchanges text through the Linux serial module", (): void => {
    const serial = new SerialLinkBroker();
    const left = record("c-000400");
    const right = record("c-000401");
    serial.register(left);
    serial.register(right);
    serial.connect(
      { computerId: left.computerId, face: "bottom" },
      { computerId: right.computerId, face: "top" },
    );

    const writer = runPythonCs486(
      'import serial\nwritten = serial.write(0, "hello")\n',
      environment(left, serial),
    );
    expect(writer.state.kind).toBe("completed");
    expect(writer.globals.get("written")).toBe(5);
    serial.runTick();
    const reader = runPythonCs486(
      "import serial\nvalue = serial.read(4)\nstate = serial.status(4)\n",
      environment(right, serial),
    );
    expect(reader.state.kind).toBe("completed");
    expect(reader.globals.get("value")).toBe("hello");
    expect(reader.globals.get("state")).toMatchObject({
      kind: "tuple",
      values: ["connected", left.computerId, "bottom", 0, 0],
    });
  });

  it("exposes bounded SPI and I2C transactions as byte lists", (): void => {
    const serial = new SerialLinkBroker();
    const peripherals = new PeripheralBusBroker();
    const computer = record("c-000402");
    serial.register(computer);
    peripherals.register(computer);
    peripherals.attachSpi(
      { computerId: computer.computerId, face: "right" },
      0,
      {
        id: "spi-fixture",
        transfer: (bytes) => Uint8Array.from(bytes, (byte) => byte + 1),
      },
    );
    peripherals.attachI2c(
      { computerId: computer.computerId, face: "right" },
      {
        address: 0x48,
        id: "i2c-fixture",
        transact: ({ readLength }) => new Uint8Array(readLength).fill(0x2a),
      },
    );
    const terminal = new TerminalBuffer();
    const native = createNativeEnvironment({
      computerId: 402,
      computerName: computer.computerId,
      filesystem: computer.filesystem,
      osProfile: "linux",
      peripherals,
      serial,
      terminal,
    });
    const vm = runPythonCs486(
      [
        "import spi",
        "import i2c",
        "spi_value = spi.transfer(1, 0, [1, 2, 3])",
        "addresses = i2c.scan(1)",
        "i2c_value = i2c.transfer(1, 72, [0], 2)",
      ].join("\n"),
      {
        environment: native,
        filesystem: computer.filesystem,
        terminal,
      },
    );
    expect(vm.state.kind).toBe("completed");
    expect(vm.globals.get("spi_value")).toEqual({
      kind: "list",
      values: [2, 3, 4],
    });
    expect(vm.globals.get("addresses")).toEqual({
      kind: "list",
      values: [0x48],
    });
    expect(vm.globals.get("i2c_value")).toEqual({
      kind: "list",
      values: [0x2a, 0x2a],
    });
  });
});

function record(computerId: string): ComputerRecord {
  const result = new ComputerRecord(computerId, "standard");
  result.faceIo.powerOn();
  return result;
}

function environment(
  record: ComputerRecord,
  serial: SerialLinkBroker,
): {
  environment: ReturnType<typeof createNativeEnvironment>;
  filesystem: ComputerRecord["filesystem"];
  terminal: TerminalBuffer;
} {
  const terminal = new TerminalBuffer();
  return {
    environment: createNativeEnvironment({
      computerId: 1,
      computerName: record.computerId,
      filesystem: record.filesystem,
      osProfile: "linux",
      serial,
      terminal,
    }),
    filesystem: record.filesystem,
    terminal,
  };
}

import { describe, expect, it } from "vitest";

import { SerialLinkBroker } from "../../src/application/io/serialLinkBroker.js";
import { createSerialVirtualDevices } from "../../src/application/os/serialVirtualDevices.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { decodeUtf8Chunk, encodeUtf8 } from "../../src/domain/text/utf8.js";

describe("serial OS devices", (): void => {
  it("communicates between Linux ttyS0 and DOS COM1", (): void => {
    const serial = new SerialLinkBroker();
    const linuxRecord = new ComputerRecord("c-000200", "standard");
    const dosRecord = new ComputerRecord("c-000201", "standard");
    linuxRecord.faceIo.powerOn();
    dosRecord.faceIo.powerOn();
    serial.register(linuxRecord);
    serial.register(dosRecord);
    serial.connect(
      { computerId: linuxRecord.computerId, face: "bottom" },
      { computerId: dosRecord.computerId, face: "bottom" },
    );
    const linux = shell("linux", linuxRecord, serial);
    const dos = shell("dos", dosRecord, serial);

    expect(linux.submit("printf ping > /dev/ttyS0")).toMatchObject({
      exitCode: 0,
    });
    expect(serial.runTick()).toBe(4);
    expect(dos.submit("TYPE COM1")).toMatchObject({
      exitCode: 0,
      stdout: "ping",
    });

    expect(dos.submit("ECHO PONG>COM1")).toMatchObject({ exitCode: 0 });
    serial.runTick();
    expect(linux.submit("cat /dev/ttyS0")).toMatchObject({
      exitCode: 0,
      stdout: "PONG\r\n",
    });
  });

  it("fails explicitly when a face has no adjacent peer", (): void => {
    const serial = new SerialLinkBroker();
    const record = new ComputerRecord("c-000202", "standard");
    record.faceIo.powerOn();
    serial.register(record);
    const linux = shell("linux", record, serial);

    expect(linux.submit("echo hello > /dev/ttyS5")).toMatchObject({
      exitCode: 1,
    });
    expect(linux.submit("echo hello > /dev/ttyS5").stderr).toMatch(
      /not connected/u,
    );
  });

  it("retains UTF-8 code points split at a serial tick boundary", (): void => {
    const encoded = encodeUtf8("AあB");
    const first = decodeUtf8Chunk(encoded.slice(0, 3));
    expect(first.value).toBe("A");
    expect(first.remainder.length).toBe(2);
    const combined = new Uint8Array(
      first.remainder.length + encoded.length - 3,
    );
    combined.set(first.remainder);
    combined.set(encoded.slice(3), first.remainder.length);
    expect(decodeUtf8Chunk(combined)).toEqual({
      value: "あB",
      remainder: new Uint8Array(),
    });
  });

  it("drops a partial text sequence when the physical link resets", (): void => {
    const serial = new SerialLinkBroker();
    const left = new ComputerRecord("c-000203", "standard");
    const right = new ComputerRecord("c-000204", "standard");
    left.faceIo.powerOn();
    right.faceIo.powerOn();
    serial.register(left);
    serial.register(right);
    const leftEndpoint = {
      computerId: left.computerId,
      face: "bottom",
    } as const;
    const rightEndpoint = {
      computerId: right.computerId,
      face: "top",
    } as const;
    serial.connect(leftEndpoint, rightEndpoint);
    const rightShell = shell("linux", right, serial);
    serial.write(leftEndpoint, encodeUtf8("あ").slice(0, 2));
    serial.runTick();
    expect(rightShell.submit("cat /dev/ttyS4").stdout).toBe("");

    serial.disconnect(leftEndpoint, "test_reconnect");
    serial.connect(leftEndpoint, rightEndpoint);
    serial.write(leftEndpoint, encodeUtf8("B"));
    serial.runTick();
    expect(rightShell.submit("cat /dev/ttyS4").stdout).toBe("B");
  });
});

function shell(
  osProfile: "dos" | "linux",
  record: ComputerRecord,
  serial: SerialLinkBroker,
): ShellSession {
  return new ShellSession(new InMemoryFilesystem(), {
    computerName: record.computerId,
    osProfile,
    virtualDevices: createSerialVirtualDevices(
      osProfile,
      record.computerId,
      serial,
    ),
  });
}

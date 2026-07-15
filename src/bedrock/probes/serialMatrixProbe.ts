import { SerialLinkBroker } from "../../application/io/serialLinkBroker.js";
import { createSerialVirtualDevices } from "../../application/os/serialVirtualDevices.js";
import { ShellSession } from "../../application/os/shellSession.js";
import { ComputerRecord } from "../../domain/computer/computer.js";
import { machineFaces } from "../../domain/computer/machineFace.js";
import { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";

export interface SerialMatrixProbeResult {
  readonly faces: number;
  readonly links: number;
  readonly machines: number;
  readonly transmissions: number;
}

interface ProbeMachine {
  readonly dos: ShellSession;
  readonly linux: ShellSession;
  readonly record: ComputerRecord;
}

/**
 * Exercises every ordered pair in a three-machine set on every physical face.
 * Each link sends Linux ttyS -> DOS COM and DOS COM -> Linux ttyS, so the BDS
 * probe covers both fixed OS mappings as well as the shared bounded UART path.
 */
export function executeSerialMatrixProbe(): SerialMatrixProbeResult {
  const serial = new SerialLinkBroker();
  const machines = [
    machine("c-900100", "standard", serial),
    machine("c-900101", "advanced", serial),
    machine("c-900102", "standard", serial),
  ];
  let links = 0;
  let transmissions = 0;

  for (let sourceIndex = 0; sourceIndex < machines.length; sourceIndex += 1) {
    for (let targetIndex = 0; targetIndex < machines.length; targetIndex += 1) {
      if (sourceIndex === targetIndex) continue;
      const source = machines[sourceIndex]!;
      const target = machines[targetIndex]!;
      for (let faceIndex = 0; faceIndex < machineFaces.length; faceIndex += 1) {
        const face = machineFaces[faceIndex]!;
        const sourceEndpoint = {
          computerId: source.record.computerId,
          face,
        } as const;
        const targetEndpoint = {
          computerId: target.record.computerId,
          face,
        } as const;
        requireOutcome(
          serial.connect(sourceEndpoint, targetEndpoint).outcome,
          "connected",
          `connect ${sourceIndex}->${targetIndex} ${face}`,
        );
        links += 1;

        const linuxToken = `L${String(sourceIndex)}${String(targetIndex)}${String(faceIndex)}`;
        const linuxWrite = source.linux.submit(
          `printf ${linuxToken} > /dev/ttyS${String(faceIndex)}`,
        );
        requireExit(linuxWrite.exitCode, `Linux write ${linuxToken}`);
        requirePositiveDelivery(
          serial.runTick(),
          `Linux delivery ${linuxToken}`,
        );
        const dosRead = target.dos.submit(`TYPE COM${String(faceIndex + 1)}`);
        requireExit(dosRead.exitCode, `DOS read ${linuxToken}`);
        requireEqual(dosRead.stdout, linuxToken, `DOS payload ${linuxToken}`);
        transmissions += 1;

        const dosToken = `D${String(targetIndex)}${String(sourceIndex)}${String(faceIndex)}`;
        const dosWrite = target.dos.submit(
          `ECHO ${dosToken}>COM${String(faceIndex + 1)}`,
        );
        requireExit(dosWrite.exitCode, `DOS write ${dosToken}`);
        requirePositiveDelivery(serial.runTick(), `DOS delivery ${dosToken}`);
        const linuxRead = source.linux.submit(
          `cat /dev/ttyS${String(faceIndex)}`,
        );
        requireExit(linuxRead.exitCode, `Linux read ${dosToken}`);
        requireEqual(
          linuxRead.stdout,
          `${dosToken}\r\n`,
          `Linux payload ${dosToken}`,
        );
        transmissions += 1;
        serial.disconnect(sourceEndpoint, "probe_next_link");
      }
    }
  }

  return {
    faces: machineFaces.length,
    links,
    machines: machines.length,
    transmissions,
  };
}

function machine(
  computerId: string,
  family: "advanced" | "standard",
  serial: SerialLinkBroker,
): ProbeMachine {
  const record = new ComputerRecord(computerId, family);
  record.faceIo.powerOn();
  serial.register(record);
  return {
    dos: shell("dos", record, serial),
    linux: shell("linux", record, serial),
    record,
  };
}

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

function requireExit(exitCode: number, operation: string): void {
  if (exitCode !== 0)
    throw new Error(`${operation} exited ${String(exitCode)}`);
}

function requirePositiveDelivery(bytes: number, operation: string): void {
  if (bytes <= 0) throw new Error(`${operation} transferred no bytes`);
}

function requireOutcome(
  actual: string,
  expected: string,
  operation: string,
): void {
  if (actual !== expected)
    throw new Error(`${operation}: expected ${expected}, received ${actual}`);
}

function requireEqual(
  actual: string,
  expected: string,
  operation: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${operation}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

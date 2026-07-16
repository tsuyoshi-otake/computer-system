import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import {
  machineFaces,
  type MachineFace,
} from "../../domain/computer/machineFace.js";
import { decodeUtf8Chunk, encodeUtf8 } from "../../domain/text/utf8.js";
import type {
  SerialEndpoint,
  SerialEndpointStatus,
  SerialLinkBroker,
  SerialWriteResult,
} from "../io/serialLinkBroker.js";
import type { VirtualDevice } from "./osProfile.js";

export function createSerialVirtualDevices(
  osProfile: ComputerOsProfile,
  computerId: string,
  serial: SerialLinkBroker,
): ReadonlyMap<string, VirtualDevice> {
  return new Map(
    machineFaces.map((face, index) => {
      const path =
        osProfile === "linux"
          ? `/dev/ttyS${String(index)}`
          : `/drives/c/com${String(index + 1)}`;
      return [path, serialDevice(path, { computerId, face }, serial)] as const;
    }),
  );
}

export function serialFaceForPortIndex(index: number): MachineFace {
  const face = machineFaces[index];
  if (face === undefined) {
    throw new RangeError("Serial port index must be between 0 and 5");
  }
  return face;
}

function serialDevice(
  path: string,
  endpoint: SerialEndpoint,
  serial: SerialLinkBroker,
): VirtualDevice {
  let pendingUtf8: Uint8Array = new Uint8Array();
  let observedResetEpoch: number | undefined;
  const synchronizeReset = (status: SerialEndpointStatus): void => {
    if (
      observedResetEpoch !== undefined &&
      observedResetEpoch !== status.port.resetEpoch
    ) {
      pendingUtf8 = new Uint8Array();
    }
    observedResetEpoch = status.port.resetEpoch;
  };
  return {
    path,
    read: (): string => {
      const status = serial.status(endpoint);
      if (status === undefined) throw new Error(`${path}: device unavailable`);
      if (!status.port.powered)
        throw new Error(`${path}: device is powered off`);
      if (status.link !== "connected")
        throw new Error(`${path}: not connected`);
      synchronizeReset(status);
      const result = serial.read(endpoint);
      if (result.outcome !== "read") {
        throw new Error(`${path}: ${result.outcome.replaceAll("_", " ")}`);
      }
      const combined = new Uint8Array(pendingUtf8.length + result.bytes.length);
      combined.set(pendingUtf8);
      combined.set(result.bytes, pendingUtf8.length);
      const decoded = decodeUtf8Chunk(combined);
      pendingUtf8 = decoded.remainder;
      return decoded.value;
    },
    write: (contents): void => {
      const status = serial.status(endpoint);
      if (status !== undefined) synchronizeReset(status);
      const result = serial.write(endpoint, encodeUtf8(contents));
      if (result.outcome !== "accepted") throw serialWriteError(path, result);
    },
  };
}

function serialWriteError(path: string, result: SerialWriteResult): Error {
  switch (result.outcome) {
    case "disconnected":
      return new Error(`${path}: not connected`);
    case "missing_computer":
      return new Error(`${path}: device unavailable`);
    case "peer_offline":
      return new Error(`${path}: peer is powered off`);
    case "powered_off":
      return new Error(`${path}: device is powered off`);
    case "transmit_buffer_full":
      return new Error(
        `${path}: transmit buffer full (${String(result.available)} bytes available)`,
      );
    case "write_limit_exceeded":
      return new Error(
        `${path}: write exceeds ${String(result.maximum)} byte atomic limit`,
      );
    case "accepted":
      return new Error(`${path}: unexpected accepted write`);
  }
}

import type { ComputerRecord } from "../../domain/computer/computer.js";
import type { MachineFace } from "../../domain/computer/machineFace.js";
import type { FaceIoHardware } from "../../domain/io/faceIoHardware.js";
import type {
  Rs232Port,
  Rs232PortStatus,
  Rs232WriteResult,
} from "../../domain/io/rs232Port.js";
import { rs232BaudRate, rs232BitsPerByte } from "../../domain/io/rs232Port.js";

export interface SerialEndpoint {
  readonly computerId: string;
  readonly face: MachineFace;
}

export interface SerialLinkBrokerOptions {
  readonly maximumBytesPerDirectionPerTick?: number;
  readonly maximumLinksPerTick?: number;
  readonly maximumReadyDequeuesPerTick?: number;
  readonly maximumBytesPerTick?: number;
}

export type SerialConnectResult =
  | { readonly outcome: "connected" }
  | { readonly outcome: "unchanged" }
  | { readonly outcome: "missing_computer"; readonly computerId: string }
  | { readonly outcome: "same_endpoint" };

export type SerialWriteResult =
  | Rs232WriteResult
  | { readonly outcome: "missing_computer" }
  | { readonly outcome: "disconnected" }
  | { readonly outcome: "peer_offline" };

export type SerialReadResult =
  | { readonly outcome: "read"; readonly bytes: Uint8Array }
  | { readonly outcome: "missing_computer" }
  | { readonly outcome: "powered_off" };

export interface SerialEndpointStatus {
  readonly link: "connected" | "disconnected";
  readonly peer?: SerialEndpoint;
  readonly port: Rs232PortStatus;
}

const endpointSeparator = "\u0000";

/**
 * Bounded transient RS-232C link scheduler.
 *
 * Writes only enqueue into the local UART. runTick() is the sole byte-transfer
 * owner, which makes baud limits and backpressure deterministic.
 */
export class SerialLinkBroker {
  private readonly computers = new Map<string, FaceIoHardware>();
  private readonly peers = new Map<string, string>();
  private readonly linkEpochs = new Map<
    string,
    readonly [left: number, right: number]
  >();
  private readonly readyLinks = new Map<string, ReadyLinkNode>();
  private readonly maximumBytesPerDirectionPerTick: number;
  private readonly maximumLinksPerTick: number;
  private readonly maximumReadyDequeuesPerTick: number;
  private readonly maximumBytesPerTick: number;
  private readyHead: string | undefined;
  private readyTail: string | undefined;

  constructor(options: SerialLinkBrokerOptions = {}) {
    this.maximumBytesPerDirectionPerTick = requirePositiveInteger(
      options.maximumBytesPerDirectionPerTick ??
        Math.floor(rs232BaudRate / rs232BitsPerByte / 20),
      "RS-232C bytes per direction per tick",
    );
    this.maximumLinksPerTick = requirePositiveInteger(
      options.maximumLinksPerTick ?? 16,
      "RS-232C links per tick",
    );
    this.maximumReadyDequeuesPerTick = requirePositiveInteger(
      options.maximumReadyDequeuesPerTick ?? 64,
      "RS-232C ready dequeues per tick",
    );
    this.maximumBytesPerTick = requirePositiveInteger(
      options.maximumBytesPerTick ?? 1_536,
      "RS-232C bytes per tick",
    );
  }

  register(record: ComputerRecord): void {
    this.computers.set(record.computerId, record.faceIo);
  }

  unregister(computerId: string, reason = "computer_removed"): void {
    const hardware = this.computers.get(computerId);
    if (hardware === undefined) return;
    for (const face of machineFaceValues) {
      this.disconnect({ computerId, face }, reason);
    }
    hardware.powerOff(reason);
    this.computers.delete(computerId);
  }

  disconnectComputer(computerId: string, reason = "computer_detached"): void {
    if (!this.computers.has(computerId)) return;
    for (const face of machineFaceValues) {
      this.disconnect({ computerId, face }, reason);
    }
  }

  connect(left: SerialEndpoint, right: SerialEndpoint): SerialConnectResult {
    const leftKey = endpointKey(left);
    const rightKey = endpointKey(right);
    if (leftKey === rightKey) return { outcome: "same_endpoint" };
    if (!this.computers.has(left.computerId)) {
      return { outcome: "missing_computer", computerId: left.computerId };
    }
    if (!this.computers.has(right.computerId)) {
      return { outcome: "missing_computer", computerId: right.computerId };
    }
    if (
      this.peers.get(leftKey) === rightKey &&
      this.peers.get(rightKey) === leftKey
    ) {
      return { outcome: "unchanged" };
    }
    this.disconnect(left, "link_replaced");
    this.disconnect(right, "link_replaced");
    this.peers.set(leftKey, rightKey);
    this.peers.set(rightKey, leftKey);
    this.recordLinkEpochs(linkKey(leftKey, rightKey), leftKey, rightKey);
    return { outcome: "connected" };
  }

  disconnect(endpoint: SerialEndpoint, reason = "link_disconnected"): boolean {
    const key = endpointKey(endpoint);
    const peerKey = this.peers.get(key);
    if (peerKey === undefined) return false;
    this.peers.delete(key);
    this.peers.delete(peerKey);
    const disconnectedLink = linkKey(key, peerKey);
    this.removeReadyLink(disconnectedLink);
    this.linkEpochs.delete(disconnectedLink);
    this.portForKey(key)?.resetLink(reason);
    this.portForKey(peerKey)?.resetLink(reason);
    return true;
  }

  write(endpoint: SerialEndpoint, bytes: Uint8Array): SerialWriteResult {
    const hardware = this.computers.get(endpoint.computerId);
    if (hardware === undefined) return { outcome: "missing_computer" };
    const key = endpointKey(endpoint);
    const peerKey = this.peers.get(key);
    if (peerKey === undefined) return { outcome: "disconnected" };
    const peer = this.portForKey(peerKey);
    if (peer === undefined || !peer.status.powered) {
      return { outcome: "peer_offline" };
    }
    this.synchronizeLinkEpochs(linkKey(key, peerKey), key, peerKey);
    const result = hardware.rs232(endpoint.face).write(bytes);
    if (result.outcome === "accepted" && result.bytes > 0) {
      this.enqueueReadyLink(linkKey(key, peerKey));
    }
    return result;
  }

  read(endpoint: SerialEndpoint, maximumBytes?: number): SerialReadResult {
    const hardware = this.computers.get(endpoint.computerId);
    if (hardware === undefined) return { outcome: "missing_computer" };
    const port = hardware.rs232(endpoint.face);
    if (!port.status.powered) return { outcome: "powered_off" };
    const bytes = port.read(maximumBytes);
    const peerKey = this.peers.get(endpointKey(endpoint));
    if (peerKey !== undefined) {
      this.enqueueReadyLink(linkKey(endpointKey(endpoint), peerKey));
    }
    return { outcome: "read", bytes };
  }

  status(endpoint: SerialEndpoint): SerialEndpointStatus | undefined {
    const hardware = this.computers.get(endpoint.computerId);
    if (hardware === undefined) return undefined;
    const peerKey = this.peers.get(endpointKey(endpoint));
    return {
      link: peerKey === undefined ? "disconnected" : "connected",
      ...(peerKey === undefined ? {} : { peer: parseEndpointKey(peerKey) }),
      port: hardware.rs232(endpoint.face).status,
    };
  }

  runTick(): number {
    const deferred: string[] = [];
    let dequeuedLinks = 0;
    let processedLinks = 0;
    let movedBytes = 0;
    while (
      processedLinks < this.maximumLinksPerTick &&
      dequeuedLinks < this.maximumReadyDequeuesPerTick &&
      movedBytes < this.maximumBytesPerTick
    ) {
      const current = this.takeReadyLink();
      if (current === undefined) break;
      dequeuedLinks += 1;
      const [leftKey, rightKey] = splitLinkKey(current);
      if (
        this.peers.get(leftKey) !== rightKey ||
        this.peers.get(rightKey) !== leftKey
      ) {
        continue;
      }
      const left = this.portForKey(leftKey);
      const right = this.portForKey(rightKey);
      if (left === undefined || right === undefined) continue;
      if (this.synchronizeLinkEpochs(current, leftKey, rightKey)) {
        processedLinks += 1;
        continue;
      }
      const firstLimit = Math.min(
        this.maximumBytesPerDirectionPerTick,
        this.maximumBytesPerTick - movedBytes,
      );
      const first = left.transferTo(right, firstLimit);
      if (first.outcome === "moved") movedBytes += first.bytes;
      if (movedBytes < this.maximumBytesPerTick) {
        const secondLimit = Math.min(
          this.maximumBytesPerDirectionPerTick,
          this.maximumBytesPerTick - movedBytes,
        );
        const second = right.transferTo(left, secondLimit);
        if (second.outcome === "moved") movedBytes += second.bytes;
      }
      if (left.status.transmitBytes > 0 || right.status.transmitBytes > 0) {
        deferred.push(current);
      }
      processedLinks += 1;
    }
    for (const link of deferred) this.enqueueReadyLink(link);
    return movedBytes;
  }

  private portForKey(key: string): Rs232Port | undefined {
    const endpoint = parseEndpointKey(key);
    return this.computers.get(endpoint.computerId)?.rs232(endpoint.face);
  }

  private synchronizeLinkEpochs(
    link: string,
    leftKey: string,
    rightKey: string,
  ): boolean {
    const left = this.portForKey(leftKey);
    const right = this.portForKey(rightKey);
    if (left === undefined || right === undefined) return false;
    const current = [left.status.powerEpoch, right.status.powerEpoch] as const;
    const observed = this.linkEpochs.get(link);
    if (
      observed !== undefined &&
      observed[0] === current[0] &&
      observed[1] === current[1]
    ) {
      return false;
    }
    left.resetLink("power_epoch_changed");
    right.resetLink("power_epoch_changed");
    this.linkEpochs.set(link, current);
    return observed !== undefined;
  }

  private recordLinkEpochs(
    link: string,
    leftKey: string,
    rightKey: string,
  ): void {
    const left = this.portForKey(leftKey);
    const right = this.portForKey(rightKey);
    if (left === undefined || right === undefined) return;
    this.linkEpochs.set(link, [
      left.status.powerEpoch,
      right.status.powerEpoch,
    ]);
  }

  private enqueueReadyLink(key: string): void {
    if (this.readyLinks.has(key)) return;
    const node: ReadyLinkNode = { previous: this.readyTail };
    this.readyLinks.set(key, node);
    if (this.readyTail === undefined) {
      this.readyHead = key;
    } else {
      const tail = this.readyLinks.get(this.readyTail);
      if (tail !== undefined) tail.next = key;
    }
    this.readyTail = key;
  }

  private takeReadyLink(): string | undefined {
    const key = this.readyHead;
    if (key === undefined) return undefined;
    this.removeReadyLink(key);
    return key;
  }

  private removeReadyLink(key: string): boolean {
    const node = this.readyLinks.get(key);
    if (node === undefined) return false;
    this.readyLinks.delete(key);
    if (node.previous === undefined) this.readyHead = node.next;
    else {
      const previous = this.readyLinks.get(node.previous);
      if (previous !== undefined) previous.next = node.next;
    }
    if (node.next === undefined) this.readyTail = node.previous;
    else {
      const next = this.readyLinks.get(node.next);
      if (next !== undefined) next.previous = node.previous;
    }
    return true;
  }
}

interface ReadyLinkNode {
  next?: string;
  previous?: string;
}

const machineFaceValues: readonly MachineFace[] = [
  "bottom",
  "right",
  "front",
  "back",
  "top",
  "left",
];

function endpointKey(endpoint: SerialEndpoint): string {
  return `${endpoint.computerId}${endpointSeparator}${endpoint.face}`;
}

function parseEndpointKey(key: string): SerialEndpoint {
  const separator = key.lastIndexOf(endpointSeparator);
  return {
    computerId: key.slice(0, separator),
    face: key.slice(separator + endpointSeparator.length) as MachineFace,
  };
}

function linkKey(leftKey: string, rightKey: string): string {
  return leftKey < rightKey
    ? `${leftKey}\u0001${rightKey}`
    : `${rightKey}\u0001${leftKey}`;
}

function splitLinkKey(key: string): readonly [string, string] {
  const separator = key.indexOf("\u0001");
  return [key.slice(0, separator), key.slice(separator + 1)];
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return value;
}

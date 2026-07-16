import { utf8ByteLength } from "../../domain/text/utf8.js";

export const osNetworkStateSchema = 1 as const;

const maximumAddressTextBytes = 64;
const maximumHardwareAddressBytes = 17;

export type OsNetworkInterfaceKind = "ethernet" | "loopback";
export type OsNetworkLinkState = "down" | "up";
export type OsNetworkAddressFamily = "ipv4" | "ipv6";
export type OsNetworkAddressScope = "global" | "host" | "link";
export type OsNetworkSocketProtocol = "tcp" | "udp";
export type OsNetworkSocketState = "bound" | "listening" | "open";

export interface OsNetworkInterfaceCounters {
  readonly receiveBytes: number;
  readonly receiveDropped: number;
  readonly receiveErrors: number;
  readonly receivePackets: number;
  readonly transmitBytes: number;
  readonly transmitDropped: number;
  readonly transmitErrors: number;
  readonly transmitPackets: number;
}

export interface OsNetworkInterfaceRecord {
  readonly changedTick: number;
  readonly counters: OsNetworkInterfaceCounters;
  readonly hardwareAddress?: string;
  readonly kind: OsNetworkInterfaceKind;
  readonly linkState: OsNetworkLinkState;
  readonly mtu: number;
  readonly name: string;
}

export interface OsNetworkInterfaceRegistration {
  readonly hardwareAddress?: string;
  readonly kind: OsNetworkInterfaceKind;
  readonly mtu: number;
  readonly name: string;
  readonly tick: number;
}

export type OsNetworkLinkTransition =
  | { readonly kind: "bring_down"; readonly tick: number }
  | { readonly kind: "bring_up"; readonly tick: number };

export interface OsNetworkCounterDelta {
  readonly receiveBytes?: number;
  readonly receiveDropped?: number;
  readonly receiveErrors?: number;
  readonly receivePackets?: number;
  readonly transmitBytes?: number;
  readonly transmitDropped?: number;
  readonly transmitErrors?: number;
  readonly transmitPackets?: number;
}

export interface OsNetworkAddressRecord {
  readonly address: string;
  readonly changedTick: number;
  readonly family: OsNetworkAddressFamily;
  readonly interfaceName: string;
  readonly prefixLength: number;
  readonly scope: OsNetworkAddressScope;
}

export interface OsNetworkAddressAssignment {
  readonly address: string;
  readonly family: OsNetworkAddressFamily;
  readonly interfaceName: string;
  readonly prefixLength: number;
  readonly scope: OsNetworkAddressScope;
  readonly tick: number;
}

export interface OsNetworkSocketRecord {
  readonly backlog?: number;
  readonly changedTick: number;
  readonly createdTick: number;
  readonly family: OsNetworkAddressFamily;
  readonly interfaceName?: string;
  readonly localAddress?: string;
  readonly localPort?: number;
  readonly ownerPid: number;
  readonly protocol: OsNetworkSocketProtocol;
  readonly socketId: string;
  readonly state: OsNetworkSocketState;
}

export interface OsNetworkSocketOpen {
  readonly family: OsNetworkAddressFamily;
  readonly ownerPid: number;
  readonly protocol: OsNetworkSocketProtocol;
  readonly socketId: string;
  readonly tick: number;
}

export type OsNetworkSocketTransition =
  | {
      readonly interfaceName?: string;
      readonly kind: "bind";
      readonly localAddress?: string;
      readonly localPort: number;
      readonly tick: number;
    }
  | {
      readonly backlog: number;
      readonly kind: "listen";
      readonly tick: number;
    }
  | { readonly kind: "close"; readonly tick: number };

export interface OsNetworkStateLimits {
  readonly maximumAddresses: number;
  readonly maximumBacklog: number;
  readonly maximumInterfaceNameBytes: number;
  readonly maximumInterfaces: number;
  readonly maximumMtu: number;
  readonly maximumOwnerPid: number;
  readonly maximumSocketIdBytes: number;
  readonly maximumSockets: number;
}

export const defaultOsNetworkStateLimits: OsNetworkStateLimits = Object.freeze({
  maximumAddresses: 32,
  maximumBacklog: 128,
  maximumInterfaceNameBytes: 15,
  maximumInterfaces: 8,
  maximumMtu: 65_536,
  maximumOwnerPid: 32_767,
  maximumSocketIdBytes: 64,
  maximumSockets: 64,
});

export type OsNetworkCapacity = "addresses" | "interfaces" | "sockets";

export class OsNetworkStateCapacityError extends Error {
  constructor(
    readonly resource: OsNetworkCapacity,
    readonly maximum: number,
  ) {
    super(`OS network ${resource} capacity ${String(maximum)} exceeded`);
    this.name = "OsNetworkStateCapacityError";
  }
}

export class OsNetworkStateTransitionError extends Error {
  constructor(
    readonly entity: string,
    detail: string,
  ) {
    super(`${entity}: ${detail}`);
    this.name = "OsNetworkStateTransitionError";
  }
}

export class OsNetworkStateSnapshotError extends TypeError {
  constructor(detail: string) {
    super(`OS network snapshot: ${detail}`);
    this.name = "OsNetworkStateSnapshotError";
  }
}

export interface OsNetworkStateSnapshotV1 {
  readonly addresses: readonly OsNetworkAddressRecord[];
  readonly computerId: string;
  readonly interfaces: readonly OsNetworkInterfaceRecord[];
  readonly revision: number;
  readonly schema: typeof osNetworkStateSchema;
  readonly sockets: readonly OsNetworkSocketRecord[];
}

/**
 * Authoritative, bounded network state owned by one guest OS.
 *
 * This aggregate deliberately models only state and transitions. It does not
 * claim host connectivity, route packets, or synthesize command output. A
 * future adapter may register real guest-visible interfaces and feed counters
 * through this boundary without replacing presentation-only fixtures.
 */
export class OsNetworkState {
  readonly computerId: string;
  readonly limits: OsNetworkStateLimits;

  private readonly interfaceRecords = new Map<
    string,
    OsNetworkInterfaceRecord
  >();
  private readonly addressRecords = new Map<string, OsNetworkAddressRecord>();
  private readonly addressKeysByIdentity = new Map<string, string>();
  private readonly interfaceAddressCounts = new Map<string, number>();
  private readonly socketRecords = new Map<string, OsNetworkSocketRecord>();
  private readonly boundEndpointSocketIds = new Map<string, string>();
  private readonly boundAddressUseCounts = new Map<string, number>();
  private readonly boundInterfaceUseCounts = new Map<string, number>();
  private readonly onChange?: () => void;
  private revisionValue = 0;

  constructor(
    computerId: string,
    limits: Partial<OsNetworkStateLimits> = {},
    onChange?: () => void,
  ) {
    this.limits = normalizeLimits(limits);
    this.computerId = requireBoundedString(computerId, "computer ID", 64);
    this.onChange = onChange;
  }

  static restore(
    computerId: string,
    snapshot: unknown = undefined,
    limits: Partial<OsNetworkStateLimits> = {},
    onChange?: () => void,
  ): OsNetworkState {
    const state = new OsNetworkState(computerId, limits, onChange);
    if (snapshot !== undefined) state.restoreSnapshot(snapshot);
    return state;
  }

  get isEmpty(): boolean {
    return (
      this.revisionValue === 0 &&
      this.interfaceRecords.size === 0 &&
      this.addressRecords.size === 0 &&
      this.socketRecords.size === 0
    );
  }

  get revision(): number {
    return this.revisionValue;
  }

  networkInterface(name: string): OsNetworkInterfaceRecord | undefined {
    return this.interfaceRecords.get(
      normalizeInterfaceName(name, this.limits.maximumInterfaceNameBytes),
    );
  }

  interfaces(): readonly OsNetworkInterfaceRecord[] {
    return Object.freeze(
      [...this.interfaceRecords.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    );
  }

  registerInterface(
    registration: OsNetworkInterfaceRegistration,
  ): OsNetworkInterfaceRecord {
    const name = normalizeInterfaceName(
      registration.name,
      this.limits.maximumInterfaceNameBytes,
    );
    if (this.interfaceRecords.has(name)) {
      throw new OsNetworkStateTransitionError(
        `interface ${name}`,
        "already exists",
      );
    }
    if (this.interfaceRecords.size >= this.limits.maximumInterfaces) {
      throw new OsNetworkStateCapacityError(
        "interfaces",
        this.limits.maximumInterfaces,
      );
    }
    const tick = requireTick(registration.tick, "interface registration tick");
    const kind = requireInterfaceKind(registration.kind);
    const hardwareAddress = normalizeHardwareAddress(
      registration.hardwareAddress,
    );
    if (kind === "loopback" && hardwareAddress !== undefined) {
      throw new OsNetworkStateTransitionError(
        `interface ${name}`,
        "a loopback interface cannot have a hardware address",
      );
    }
    const mtu = requireIntegerInRange(
      registration.mtu,
      68,
      this.limits.maximumMtu,
      "interface MTU",
    );
    const record = freezeInterface({
      changedTick: tick,
      counters: zeroCounters(),
      ...(hardwareAddress === undefined ? {} : { hardwareAddress }),
      kind,
      linkState: "down",
      mtu,
      name,
    });
    const revision = this.nextRevision();
    this.interfaceRecords.set(name, record);
    this.commitRevision(revision);
    return record;
  }

  unregisterInterface(name: string, tick: number): void {
    const record = this.requireInterface(name);
    requireTickNotBefore(tick, record.changedTick, `interface ${record.name}`);
    if (record.linkState !== "down") {
      throw new OsNetworkStateTransitionError(
        `interface ${record.name}`,
        "must be down before removal",
      );
    }
    if (this.interfaceAddressCount(record.name) !== 0) {
      throw new OsNetworkStateTransitionError(
        `interface ${record.name}`,
        "still owns an address",
      );
    }
    if ((this.boundInterfaceUseCounts.get(record.name) ?? 0) !== 0) {
      throw new OsNetworkStateTransitionError(
        `interface ${record.name}`,
        "still owns a bound socket",
      );
    }
    const revision = this.nextRevision();
    this.interfaceRecords.delete(record.name);
    this.commitRevision(revision);
  }

  transitionLink(
    name: string,
    transition: OsNetworkLinkTransition,
  ): OsNetworkInterfaceRecord {
    const current = this.requireInterface(name);
    requireTickNotBefore(
      transition.tick,
      current.changedTick,
      `interface ${current.name}`,
    );
    let nextState: OsNetworkLinkState;
    switch (transition.kind) {
      case "bring_up":
        if (current.linkState !== "down") {
          throw new OsNetworkStateTransitionError(
            `interface ${current.name}`,
            "bring_up requires a down link",
          );
        }
        nextState = "up";
        break;
      case "bring_down":
        if (current.linkState !== "up") {
          throw new OsNetworkStateTransitionError(
            `interface ${current.name}`,
            "bring_down requires an up link",
          );
        }
        nextState = "down";
        break;
      default:
        throw new OsNetworkStateTransitionError(
          `interface ${current.name}`,
          "unknown link transition",
        );
    }
    const record = freezeInterface({
      ...current,
      changedTick: transition.tick,
      linkState: nextState,
    });
    const revision = this.nextRevision();
    this.interfaceRecords.set(current.name, record);
    this.commitRevision(revision);
    return record;
  }

  accountInterfaceCounters(
    name: string,
    delta: OsNetworkCounterDelta,
    tick: number,
  ): OsNetworkInterfaceRecord {
    const current = this.requireInterface(name);
    requireTickNotBefore(
      tick,
      current.changedTick,
      `interface ${current.name}`,
    );
    if (current.linkState !== "up") {
      throw new OsNetworkStateTransitionError(
        `interface ${current.name}`,
        "traffic accounting requires an up link",
      );
    }
    const normalized = normalizeCounterDelta(delta);
    if (Object.values(normalized).every((value) => value === 0)) {
      throw new OsNetworkStateTransitionError(
        `interface ${current.name}`,
        "counter transition must change at least one counter",
      );
    }
    const counters = addCounters(current.counters, normalized);
    const record = freezeInterface({
      ...current,
      changedTick: tick,
      counters,
    });
    const revision = this.nextRevision();
    this.interfaceRecords.set(current.name, record);
    this.commitRevision(revision);
    return record;
  }

  resetInterfaceCounters(name: string, tick: number): OsNetworkInterfaceRecord {
    const current = this.requireInterface(name);
    requireTickNotBefore(
      tick,
      current.changedTick,
      `interface ${current.name}`,
    );
    if (Object.values(current.counters).every((value) => value === 0)) {
      throw new OsNetworkStateTransitionError(
        `interface ${current.name}`,
        "counters are already zero",
      );
    }
    const record = freezeInterface({
      ...current,
      changedTick: tick,
      counters: zeroCounters(),
    });
    const revision = this.nextRevision();
    this.interfaceRecords.set(current.name, record);
    this.commitRevision(revision);
    return record;
  }

  address(
    interfaceName: string,
    family: OsNetworkAddressFamily,
    address: string,
    prefixLength: number,
  ): OsNetworkAddressRecord | undefined {
    const normalizedInterface = normalizeInterfaceName(
      interfaceName,
      this.limits.maximumInterfaceNameBytes,
    );
    const normalizedFamily = requireAddressFamily(family);
    const normalizedAddress = normalizeAddress(normalizedFamily, address);
    const normalizedPrefix = requirePrefixLength(
      normalizedFamily,
      prefixLength,
    );
    return this.addressRecords.get(
      addressKey(
        normalizedInterface,
        normalizedFamily,
        normalizedAddress,
        normalizedPrefix,
      ),
    );
  }

  addresses(interfaceName?: string): readonly OsNetworkAddressRecord[] {
    const normalizedInterface =
      interfaceName === undefined
        ? undefined
        : normalizeInterfaceName(
            interfaceName,
            this.limits.maximumInterfaceNameBytes,
          );
    return Object.freeze(
      [...this.addressRecords.values()]
        .filter(
          (record) =>
            normalizedInterface === undefined ||
            record.interfaceName === normalizedInterface,
        )
        .sort(compareAddresses),
    );
  }

  assignAddress(
    assignment: OsNetworkAddressAssignment,
  ): OsNetworkAddressRecord {
    const networkInterface = this.requireInterface(assignment.interfaceName);
    const family = requireAddressFamily(assignment.family);
    const address = normalizeAddress(family, assignment.address);
    const prefixLength = requirePrefixLength(family, assignment.prefixLength);
    const scope = requireAddressScope(assignment.scope);
    const tick = requireTickNotBefore(
      assignment.tick,
      networkInterface.changedTick,
      `interface ${networkInterface.name} address assignment`,
    );
    const key = addressKey(
      networkInterface.name,
      family,
      address,
      prefixLength,
    );
    const identity = addressIdentity(networkInterface.name, family, address);
    if (this.addressKeysByIdentity.has(identity)) {
      throw new OsNetworkStateTransitionError(
        `address ${address}/${String(prefixLength)}`,
        "address is already assigned to the interface",
      );
    }
    if (this.addressRecords.size >= this.limits.maximumAddresses) {
      throw new OsNetworkStateCapacityError(
        "addresses",
        this.limits.maximumAddresses,
      );
    }
    const record = freezeAddress({
      address,
      changedTick: tick,
      family,
      interfaceName: networkInterface.name,
      prefixLength,
      scope,
    });
    const revision = this.nextRevision();
    this.addressRecords.set(key, record);
    this.addressKeysByIdentity.set(identity, key);
    incrementCount(this.interfaceAddressCounts, networkInterface.name);
    this.commitRevision(revision);
    return record;
  }

  removeAddress(
    interfaceName: string,
    family: OsNetworkAddressFamily,
    address: string,
    prefixLength: number,
    tick: number,
  ): void {
    const normalizedInterface = this.requireInterface(interfaceName).name;
    const normalizedFamily = requireAddressFamily(family);
    const normalizedAddress = normalizeAddress(normalizedFamily, address);
    const normalizedPrefix = requirePrefixLength(
      normalizedFamily,
      prefixLength,
    );
    requireTick(tick, "address removal tick");
    const key = addressKey(
      normalizedInterface,
      normalizedFamily,
      normalizedAddress,
      normalizedPrefix,
    );
    const current = this.addressRecords.get(key);
    if (current === undefined) {
      throw new OsNetworkStateTransitionError(
        `address ${normalizedAddress}/${String(normalizedPrefix)}`,
        "is not assigned",
      );
    }
    requireTickNotBefore(
      tick,
      current.changedTick,
      `address ${current.address}`,
    );
    if ((this.boundAddressUseCounts.get(key) ?? 0) !== 0) {
      throw new OsNetworkStateTransitionError(
        `address ${current.address}/${String(current.prefixLength)}`,
        "still owns a bound socket",
      );
    }
    const revision = this.nextRevision();
    this.addressRecords.delete(key);
    this.addressKeysByIdentity.delete(
      addressIdentity(current.interfaceName, current.family, current.address),
    );
    decrementCount(this.interfaceAddressCounts, current.interfaceName);
    this.commitRevision(revision);
  }

  socket(socketId: string): OsNetworkSocketRecord | undefined {
    return this.socketRecords.get(
      normalizeSocketId(socketId, this.limits.maximumSocketIdBytes),
    );
  }

  sockets(): readonly OsNetworkSocketRecord[] {
    return Object.freeze(
      [...this.socketRecords.values()].sort((left, right) =>
        left.socketId.localeCompare(right.socketId),
      ),
    );
  }

  listeners(): readonly OsNetworkSocketRecord[] {
    return Object.freeze(
      this.sockets().filter(({ state }) => state === "listening"),
    );
  }

  listener(
    protocol: OsNetworkSocketProtocol,
    family: OsNetworkAddressFamily,
    localPort: number,
    interfaceName?: string,
    localAddress?: string,
  ): OsNetworkSocketRecord | undefined {
    const normalizedProtocol = requireSocketProtocol(protocol);
    const normalizedFamily = requireAddressFamily(family);
    const normalizedPort = requireIntegerInRange(
      localPort,
      1,
      65_535,
      "local port",
    );
    const normalizedInterface =
      interfaceName === undefined
        ? undefined
        : normalizeInterfaceName(
            interfaceName,
            this.limits.maximumInterfaceNameBytes,
          );
    const normalizedAddress =
      localAddress === undefined
        ? undefined
        : normalizeAddress(normalizedFamily, localAddress);
    const socketId = this.boundEndpointSocketIds.get(
      endpointKey(
        normalizedProtocol,
        normalizedFamily,
        normalizedPort,
        normalizedInterface,
        normalizedAddress,
      ),
    );
    if (socketId === undefined) return undefined;
    const socket = this.socketRecords.get(socketId);
    return socket?.state === "listening" ? socket : undefined;
  }

  openSocket(open: OsNetworkSocketOpen): OsNetworkSocketRecord {
    const socketId = normalizeSocketId(
      open.socketId,
      this.limits.maximumSocketIdBytes,
    );
    if (this.socketRecords.has(socketId)) {
      throw new OsNetworkStateTransitionError(
        `socket ${socketId}`,
        "already exists",
      );
    }
    if (this.socketRecords.size >= this.limits.maximumSockets) {
      throw new OsNetworkStateCapacityError(
        "sockets",
        this.limits.maximumSockets,
      );
    }
    const tick = requireTick(open.tick, "socket open tick");
    const record = freezeSocket({
      changedTick: tick,
      createdTick: tick,
      family: requireAddressFamily(open.family),
      ownerPid: requireIntegerInRange(
        open.ownerPid,
        1,
        this.limits.maximumOwnerPid,
        "socket owner PID",
      ),
      protocol: requireSocketProtocol(open.protocol),
      socketId,
      state: "open",
    });
    const revision = this.nextRevision();
    this.socketRecords.set(socketId, record);
    this.commitRevision(revision);
    return record;
  }

  transitionSocket(
    socketId: string,
    transition: OsNetworkSocketTransition,
  ): OsNetworkSocketRecord | undefined {
    const current = this.requireSocket(socketId);
    requireTickNotBefore(
      transition.tick,
      current.changedTick,
      `socket ${current.socketId}`,
    );
    switch (transition.kind) {
      case "bind":
        return this.bindSocket(current, transition);
      case "listen":
        return this.listenSocket(current, transition);
      case "close": {
        const revision = this.nextRevision();
        this.releaseSocketIndexes(current);
        this.socketRecords.delete(current.socketId);
        this.commitRevision(revision);
        return undefined;
      }
      default:
        throw new OsNetworkStateTransitionError(
          `socket ${current.socketId}`,
          "unknown socket transition",
        );
    }
  }

  snapshot(): OsNetworkStateSnapshotV1 {
    return freezeSnapshot({
      addresses: this.addresses(),
      computerId: this.computerId,
      interfaces: this.interfaces(),
      revision: this.revisionValue,
      schema: osNetworkStateSchema,
      sockets: this.sockets(),
    });
  }

  /**
   * Returns the reboot-safe projection. Interface/address definitions survive,
   * but links are down, counters are zero, and process-owned sockets disappear.
   */
  persistentSnapshot(): OsNetworkStateSnapshotV1 {
    return freezeSnapshot({
      addresses: this.addresses().map((record) =>
        freezeAddress({ ...record, changedTick: 0 }),
      ),
      computerId: this.computerId,
      interfaces: this.interfaces().map((record) =>
        freezeInterface({
          ...record,
          changedTick: 0,
          counters: zeroCounters(),
          linkState: "down",
        }),
      ),
      revision: this.revisionValue,
      schema: osNetworkStateSchema,
      sockets: Object.freeze([]),
    });
  }

  private bindSocket(
    current: OsNetworkSocketRecord,
    transition: Extract<OsNetworkSocketTransition, { readonly kind: "bind" }>,
  ): OsNetworkSocketRecord {
    if (current.state !== "open") {
      throw new OsNetworkStateTransitionError(
        `socket ${current.socketId}`,
        "bind requires an open socket",
      );
    }
    const localPort = requireIntegerInRange(
      transition.localPort,
      1,
      65_535,
      "local port",
    );
    const interfaceName =
      transition.interfaceName === undefined
        ? undefined
        : this.requireInterface(transition.interfaceName).name;
    const localAddress =
      transition.localAddress === undefined
        ? undefined
        : normalizeAddress(current.family, transition.localAddress);
    if (
      localAddress !== undefined &&
      !isWildcardAddress(current.family, localAddress)
    ) {
      if (interfaceName === undefined) {
        throw new OsNetworkStateTransitionError(
          `socket ${current.socketId}`,
          "a specific local address requires an interface",
        );
      }
      if (
        !this.interfaceOwnsAddress(interfaceName, current.family, localAddress)
      ) {
        throw new OsNetworkStateTransitionError(
          `socket ${current.socketId}`,
          "local address is not assigned to the interface",
        );
      }
    }
    const endpoint = endpointKey(
      current.protocol,
      current.family,
      localPort,
      interfaceName,
      localAddress,
    );
    if (this.boundEndpointSocketIds.has(endpoint)) {
      throw new OsNetworkStateTransitionError(
        `socket ${current.socketId}`,
        "local endpoint is already bound",
      );
    }
    const record = freezeSocket({
      ...current,
      changedTick: transition.tick,
      ...(interfaceName === undefined ? {} : { interfaceName }),
      ...(localAddress === undefined ? {} : { localAddress }),
      localPort,
      state: "bound",
    });
    const revision = this.nextRevision();
    this.socketRecords.set(current.socketId, record);
    this.reserveSocketIndexes(record);
    this.commitRevision(revision);
    return record;
  }

  private listenSocket(
    current: OsNetworkSocketRecord,
    transition: Extract<OsNetworkSocketTransition, { readonly kind: "listen" }>,
  ): OsNetworkSocketRecord {
    if (current.state !== "bound") {
      throw new OsNetworkStateTransitionError(
        `socket ${current.socketId}`,
        "listen requires a bound socket",
      );
    }
    if (current.protocol !== "tcp") {
      throw new OsNetworkStateTransitionError(
        `socket ${current.socketId}`,
        "only TCP sockets may listen",
      );
    }
    const backlog = requireIntegerInRange(
      transition.backlog,
      1,
      this.limits.maximumBacklog,
      "listener backlog",
    );
    const record = freezeSocket({
      ...current,
      backlog,
      changedTick: transition.tick,
      state: "listening",
    });
    const revision = this.nextRevision();
    this.socketRecords.set(current.socketId, record);
    this.commitRevision(revision);
    return record;
  }

  private requireInterface(name: string): OsNetworkInterfaceRecord {
    const normalized = normalizeInterfaceName(
      name,
      this.limits.maximumInterfaceNameBytes,
    );
    const record = this.interfaceRecords.get(normalized);
    if (record === undefined) {
      throw new OsNetworkStateTransitionError(
        `interface ${normalized}`,
        "does not exist",
      );
    }
    return record;
  }

  private requireSocket(socketId: string): OsNetworkSocketRecord {
    const normalized = normalizeSocketId(
      socketId,
      this.limits.maximumSocketIdBytes,
    );
    const record = this.socketRecords.get(normalized);
    if (record === undefined) {
      throw new OsNetworkStateTransitionError(
        `socket ${normalized}`,
        "does not exist",
      );
    }
    return record;
  }

  private interfaceAddressCount(interfaceName: string): number {
    return this.interfaceAddressCounts.get(interfaceName) ?? 0;
  }

  private interfaceOwnsAddress(
    interfaceName: string,
    family: OsNetworkAddressFamily,
    address: string,
  ): boolean {
    return this.addressKeysByIdentity.has(
      addressIdentity(interfaceName, family, address),
    );
  }

  private reserveSocketIndexes(record: OsNetworkSocketRecord): void {
    if (record.localPort === undefined) return;
    this.boundEndpointSocketIds.set(socketEndpointKey(record), record.socketId);
    if (record.interfaceName !== undefined) {
      incrementCount(this.boundInterfaceUseCounts, record.interfaceName);
    }
    const key = socketAddressKey(record, this.addressKeysByIdentity);
    if (key !== undefined) incrementCount(this.boundAddressUseCounts, key);
  }

  private releaseSocketIndexes(record: OsNetworkSocketRecord): void {
    if (record.localPort === undefined) return;
    this.boundEndpointSocketIds.delete(socketEndpointKey(record));
    if (record.interfaceName !== undefined) {
      decrementCount(this.boundInterfaceUseCounts, record.interfaceName);
    }
    const key = socketAddressKey(record, this.addressKeysByIdentity);
    if (key !== undefined) decrementCount(this.boundAddressUseCounts, key);
  }

  private nextRevision(): number {
    if (this.revisionValue === Number.MAX_SAFE_INTEGER) {
      throw new OsNetworkStateTransitionError(
        "network revision",
        "is exhausted",
      );
    }
    return this.revisionValue + 1;
  }

  private commitRevision(revision: number): void {
    this.revisionValue = revision;
    this.onChange?.();
  }

  private restoreSnapshot(snapshot: unknown): void {
    const root = requireRecord(snapshot, "root");
    requireOnlyKeys(
      root,
      [
        "schema",
        "computerId",
        "interfaces",
        "addresses",
        "sockets",
        "revision",
      ],
      "root",
    );
    if (root.schema !== osNetworkStateSchema) {
      throw new OsNetworkStateSnapshotError("unsupported schema");
    }
    if (root.computerId !== this.computerId) {
      throw new OsNetworkStateSnapshotError("Computer ID does not match");
    }
    const interfaces = requireArray(root.interfaces, "interfaces");
    if (interfaces.length > this.limits.maximumInterfaces) {
      throw new OsNetworkStateCapacityError(
        "interfaces",
        this.limits.maximumInterfaces,
      );
    }
    for (const candidate of interfaces) {
      const record = parseInterface(candidate, this.limits);
      if (this.interfaceRecords.has(record.name)) {
        throw new OsNetworkStateSnapshotError(
          `duplicate interface ${record.name}`,
        );
      }
      this.interfaceRecords.set(record.name, record);
    }

    const addresses = requireArray(root.addresses, "addresses");
    if (addresses.length > this.limits.maximumAddresses) {
      throw new OsNetworkStateCapacityError(
        "addresses",
        this.limits.maximumAddresses,
      );
    }
    for (const candidate of addresses) {
      const record = parseAddress(candidate, this.limits);
      if (!this.interfaceRecords.has(record.interfaceName)) {
        throw new OsNetworkStateSnapshotError(
          `address ${record.address} refers to an unknown interface`,
        );
      }
      const key = addressRecordKey(record);
      const identity = addressIdentity(
        record.interfaceName,
        record.family,
        record.address,
      );
      if (this.addressKeysByIdentity.has(identity)) {
        throw new OsNetworkStateSnapshotError(
          `duplicate address ${record.address}/${String(record.prefixLength)}`,
        );
      }
      this.addressRecords.set(key, record);
      this.addressKeysByIdentity.set(identity, key);
      incrementCount(this.interfaceAddressCounts, record.interfaceName);
    }

    const sockets = requireArray(root.sockets, "sockets");
    if (sockets.length > this.limits.maximumSockets) {
      throw new OsNetworkStateCapacityError(
        "sockets",
        this.limits.maximumSockets,
      );
    }
    for (const candidate of sockets) {
      const record = parseSocket(candidate, this.limits);
      if (this.socketRecords.has(record.socketId)) {
        throw new OsNetworkStateSnapshotError(
          `duplicate socket ${record.socketId}`,
        );
      }
      this.validateRestoredSocket(record);
      this.socketRecords.set(record.socketId, record);
      if (record.localPort !== undefined) {
        const endpoint = socketEndpointKey(record);
        if (this.boundEndpointSocketIds.has(endpoint)) {
          throw new OsNetworkStateSnapshotError(
            `duplicate bound endpoint for socket ${record.socketId}`,
          );
        }
        this.reserveSocketIndexes(record);
      }
    }
    this.revisionValue = requireNonNegativeSafeInteger(
      root.revision,
      "revision",
    );
  }

  private validateRestoredSocket(record: OsNetworkSocketRecord): void {
    if (
      record.interfaceName !== undefined &&
      !this.interfaceRecords.has(record.interfaceName)
    ) {
      throw new OsNetworkStateSnapshotError(
        `socket ${record.socketId} refers to an unknown interface`,
      );
    }
    if (
      record.localAddress !== undefined &&
      !isWildcardAddress(record.family, record.localAddress)
    ) {
      if (record.interfaceName === undefined) {
        throw new OsNetworkStateSnapshotError(
          `socket ${record.socketId} has an address without an interface`,
        );
      }
      if (
        !this.interfaceOwnsAddress(
          record.interfaceName,
          record.family,
          record.localAddress,
        )
      ) {
        throw new OsNetworkStateSnapshotError(
          `socket ${record.socketId} uses an unassigned address`,
        );
      }
    }
  }
}

function normalizeLimits(
  limits: Partial<OsNetworkStateLimits>,
): OsNetworkStateLimits {
  const normalized = {
    ...defaultOsNetworkStateLimits,
    ...limits,
  };
  requireIntegerInRange(
    normalized.maximumAddresses,
    1,
    1_024,
    "maximum addresses",
  );
  requireIntegerInRange(
    normalized.maximumBacklog,
    1,
    65_535,
    "maximum backlog",
  );
  requireIntegerInRange(
    normalized.maximumInterfaceNameBytes,
    1,
    64,
    "maximum interface-name bytes",
  );
  requireIntegerInRange(
    normalized.maximumInterfaces,
    1,
    64,
    "maximum interfaces",
  );
  requireIntegerInRange(normalized.maximumMtu, 68, 1_048_576, "maximum MTU");
  requireIntegerInRange(
    normalized.maximumOwnerPid,
    1,
    Number.MAX_SAFE_INTEGER,
    "maximum owner PID",
  );
  requireIntegerInRange(
    normalized.maximumSocketIdBytes,
    1,
    256,
    "maximum socket-ID bytes",
  );
  requireIntegerInRange(normalized.maximumSockets, 1, 4_096, "maximum sockets");
  return Object.freeze(normalized);
}

function parseInterface(
  value: unknown,
  limits: OsNetworkStateLimits,
): OsNetworkInterfaceRecord {
  const record = requireRecord(value, "interface");
  requireOnlyKeys(
    record,
    [
      "name",
      "kind",
      "hardwareAddress",
      "mtu",
      "linkState",
      "counters",
      "changedTick",
    ],
    "interface",
  );
  const name = normalizeSnapshotInterfaceName(
    record.name,
    limits.maximumInterfaceNameBytes,
  );
  const kind = parseInterfaceKind(record.kind);
  const hardwareAddress = parseHardwareAddress(record.hardwareAddress);
  if (kind === "loopback" && hardwareAddress !== undefined) {
    throw new OsNetworkStateSnapshotError(
      `loopback interface ${name} has a hardware address`,
    );
  }
  return freezeInterface({
    changedTick: requireSnapshotTick(
      record.changedTick,
      "interface changed tick",
    ),
    counters: parseCounters(record.counters),
    ...(hardwareAddress === undefined ? {} : { hardwareAddress }),
    kind,
    linkState: parseLinkState(record.linkState),
    mtu: requireSnapshotIntegerInRange(
      record.mtu,
      68,
      limits.maximumMtu,
      "interface MTU",
    ),
    name,
  });
}

function parseAddress(
  value: unknown,
  limits: OsNetworkStateLimits,
): OsNetworkAddressRecord {
  const record = requireRecord(value, "address");
  requireOnlyKeys(
    record,
    [
      "interfaceName",
      "family",
      "address",
      "prefixLength",
      "scope",
      "changedTick",
    ],
    "address",
  );
  const family = parseAddressFamily(record.family);
  return freezeAddress({
    address: parseAddressText(family, record.address),
    changedTick: requireSnapshotTick(
      record.changedTick,
      "address changed tick",
    ),
    family,
    interfaceName: normalizeSnapshotInterfaceName(
      record.interfaceName,
      limits.maximumInterfaceNameBytes,
    ),
    prefixLength: requireSnapshotPrefixLength(family, record.prefixLength),
    scope: parseAddressScope(record.scope),
  });
}

function parseSocket(
  value: unknown,
  limits: OsNetworkStateLimits,
): OsNetworkSocketRecord {
  const record = requireRecord(value, "socket");
  requireOnlyKeys(
    record,
    [
      "socketId",
      "protocol",
      "family",
      "ownerPid",
      "state",
      "interfaceName",
      "localAddress",
      "localPort",
      "backlog",
      "createdTick",
      "changedTick",
    ],
    "socket",
  );
  const family = parseAddressFamily(record.family);
  const state = parseSocketState(record.state);
  const interfaceName =
    record.interfaceName === undefined
      ? undefined
      : normalizeSnapshotInterfaceName(
          record.interfaceName,
          limits.maximumInterfaceNameBytes,
        );
  const localAddress =
    record.localAddress === undefined
      ? undefined
      : parseAddressText(family, record.localAddress);
  const localPort =
    record.localPort === undefined
      ? undefined
      : requireSnapshotIntegerInRange(
          record.localPort,
          1,
          65_535,
          "local port",
        );
  const backlog =
    record.backlog === undefined
      ? undefined
      : requireSnapshotIntegerInRange(
          record.backlog,
          1,
          limits.maximumBacklog,
          "listener backlog",
        );
  if (state === "open") {
    if (
      interfaceName !== undefined ||
      localAddress !== undefined ||
      localPort !== undefined ||
      backlog !== undefined
    ) {
      throw new OsNetworkStateSnapshotError(
        "an open socket cannot have a bound endpoint",
      );
    }
  } else if (localPort === undefined) {
    throw new OsNetworkStateSnapshotError(
      `${state} socket is missing its local port`,
    );
  }
  const protocol = parseSocketProtocol(record.protocol);
  if (state === "bound" && backlog !== undefined) {
    throw new OsNetworkStateSnapshotError(
      "a bound socket cannot have a listener backlog",
    );
  }
  if (state === "listening" && (protocol !== "tcp" || backlog === undefined)) {
    throw new OsNetworkStateSnapshotError(
      "a listener must be TCP and have a backlog",
    );
  }
  const createdTick = requireSnapshotTick(
    record.createdTick,
    "socket creation tick",
  );
  const changedTick = requireSnapshotTick(
    record.changedTick,
    "socket changed tick",
  );
  if (changedTick < createdTick) {
    throw new OsNetworkStateSnapshotError(
      "socket changed tick predates its creation tick",
    );
  }
  return freezeSocket({
    ...(backlog === undefined ? {} : { backlog }),
    changedTick,
    createdTick,
    family,
    ...(interfaceName === undefined ? {} : { interfaceName }),
    ...(localAddress === undefined ? {} : { localAddress }),
    ...(localPort === undefined ? {} : { localPort }),
    ownerPid: requireSnapshotIntegerInRange(
      record.ownerPid,
      1,
      limits.maximumOwnerPid,
      "socket owner PID",
    ),
    protocol,
    socketId: normalizeSnapshotSocketId(
      record.socketId,
      limits.maximumSocketIdBytes,
    ),
    state,
  });
}

function parseCounters(value: unknown): OsNetworkInterfaceCounters {
  const counters = requireRecord(value, "interface counters");
  const keys = [
    "receiveBytes",
    "receiveDropped",
    "receiveErrors",
    "receivePackets",
    "transmitBytes",
    "transmitDropped",
    "transmitErrors",
    "transmitPackets",
  ] as const;
  requireOnlyKeys(counters, keys, "interface counters");
  return freezeCounters({
    receiveBytes: requireSnapshotNonNegativeSafeInteger(
      counters.receiveBytes,
      "receive bytes",
    ),
    receiveDropped: requireSnapshotNonNegativeSafeInteger(
      counters.receiveDropped,
      "receive dropped",
    ),
    receiveErrors: requireSnapshotNonNegativeSafeInteger(
      counters.receiveErrors,
      "receive errors",
    ),
    receivePackets: requireSnapshotNonNegativeSafeInteger(
      counters.receivePackets,
      "receive packets",
    ),
    transmitBytes: requireSnapshotNonNegativeSafeInteger(
      counters.transmitBytes,
      "transmit bytes",
    ),
    transmitDropped: requireSnapshotNonNegativeSafeInteger(
      counters.transmitDropped,
      "transmit dropped",
    ),
    transmitErrors: requireSnapshotNonNegativeSafeInteger(
      counters.transmitErrors,
      "transmit errors",
    ),
    transmitPackets: requireSnapshotNonNegativeSafeInteger(
      counters.transmitPackets,
      "transmit packets",
    ),
  });
}

function normalizeCounterDelta(
  value: OsNetworkCounterDelta,
): Required<OsNetworkCounterDelta> {
  if (!isRecord(value)) {
    throw new OsNetworkStateTransitionError(
      "interface counters",
      "delta must be an object",
    );
  }
  const keys = [
    "receiveBytes",
    "receiveDropped",
    "receiveErrors",
    "receivePackets",
    "transmitBytes",
    "transmitDropped",
    "transmitErrors",
    "transmitPackets",
  ] as const;
  for (const key of Object.keys(value)) {
    if (!(keys as readonly string[]).includes(key)) {
      throw new OsNetworkStateTransitionError(
        "interface counters",
        `unknown delta field ${key}`,
      );
    }
  }
  return {
    receiveBytes: requireCounterDelta(value.receiveBytes, "receive bytes"),
    receiveDropped: requireCounterDelta(
      value.receiveDropped,
      "receive dropped",
    ),
    receiveErrors: requireCounterDelta(value.receiveErrors, "receive errors"),
    receivePackets: requireCounterDelta(
      value.receivePackets,
      "receive packets",
    ),
    transmitBytes: requireCounterDelta(value.transmitBytes, "transmit bytes"),
    transmitDropped: requireCounterDelta(
      value.transmitDropped,
      "transmit dropped",
    ),
    transmitErrors: requireCounterDelta(
      value.transmitErrors,
      "transmit errors",
    ),
    transmitPackets: requireCounterDelta(
      value.transmitPackets,
      "transmit packets",
    ),
  };
}

function addCounters(
  current: OsNetworkInterfaceCounters,
  delta: Required<OsNetworkCounterDelta>,
): OsNetworkInterfaceCounters {
  const add = (left: number, right: number, name: string): number => {
    const next = left + right;
    if (!Number.isSafeInteger(next)) {
      throw new OsNetworkStateTransitionError(
        "interface counters",
        `${name} overflowed`,
      );
    }
    return next;
  };
  return freezeCounters({
    receiveBytes: add(
      current.receiveBytes,
      delta.receiveBytes,
      "receive bytes",
    ),
    receiveDropped: add(
      current.receiveDropped,
      delta.receiveDropped,
      "receive dropped",
    ),
    receiveErrors: add(
      current.receiveErrors,
      delta.receiveErrors,
      "receive errors",
    ),
    receivePackets: add(
      current.receivePackets,
      delta.receivePackets,
      "receive packets",
    ),
    transmitBytes: add(
      current.transmitBytes,
      delta.transmitBytes,
      "transmit bytes",
    ),
    transmitDropped: add(
      current.transmitDropped,
      delta.transmitDropped,
      "transmit dropped",
    ),
    transmitErrors: add(
      current.transmitErrors,
      delta.transmitErrors,
      "transmit errors",
    ),
    transmitPackets: add(
      current.transmitPackets,
      delta.transmitPackets,
      "transmit packets",
    ),
  });
}

function zeroCounters(): OsNetworkInterfaceCounters {
  return freezeCounters({
    receiveBytes: 0,
    receiveDropped: 0,
    receiveErrors: 0,
    receivePackets: 0,
    transmitBytes: 0,
    transmitDropped: 0,
    transmitErrors: 0,
    transmitPackets: 0,
  });
}

function freezeInterface(
  record: OsNetworkInterfaceRecord,
): OsNetworkInterfaceRecord {
  return Object.freeze({
    ...record,
    counters: freezeCounters(record.counters),
  });
}

function freezeCounters(
  counters: OsNetworkInterfaceCounters,
): OsNetworkInterfaceCounters {
  return Object.freeze({ ...counters });
}

function freezeAddress(record: OsNetworkAddressRecord): OsNetworkAddressRecord {
  return Object.freeze({ ...record });
}

function freezeSocket(record: OsNetworkSocketRecord): OsNetworkSocketRecord {
  return Object.freeze({ ...record });
}

function freezeSnapshot(
  snapshot: OsNetworkStateSnapshotV1,
): OsNetworkStateSnapshotV1 {
  return Object.freeze({
    ...snapshot,
    addresses: Object.freeze([...snapshot.addresses]),
    interfaces: Object.freeze([...snapshot.interfaces]),
    sockets: Object.freeze([...snapshot.sockets]),
  });
}

function normalizeInterfaceName(name: unknown, maximumBytes: number): string {
  if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(name)) {
    throw new OsNetworkStateTransitionError("interface", "name is invalid");
  }
  if (utf8ByteLength(name) > maximumBytes) {
    throw new OsNetworkStateTransitionError(
      `interface ${name}`,
      `name exceeds ${String(maximumBytes)} UTF-8 bytes`,
    );
  }
  return name;
}

function normalizeSnapshotInterfaceName(
  name: unknown,
  maximumBytes: number,
): string {
  try {
    return normalizeInterfaceName(name, maximumBytes);
  } catch (error) {
    throw snapshotValidationError(error);
  }
}

function normalizeSocketId(socketId: unknown, maximumBytes: number): string {
  if (
    typeof socketId !== "string" ||
    socketId.length === 0 ||
    /[\0\r\n]/u.test(socketId)
  ) {
    throw new OsNetworkStateTransitionError("socket", "ID is invalid");
  }
  if (utf8ByteLength(socketId) > maximumBytes) {
    throw new OsNetworkStateTransitionError(
      `socket ${socketId}`,
      `ID exceeds ${String(maximumBytes)} UTF-8 bytes`,
    );
  }
  return socketId;
}

function normalizeSnapshotSocketId(
  socketId: unknown,
  maximumBytes: number,
): string {
  try {
    return normalizeSocketId(socketId, maximumBytes);
  } catch (error) {
    throw snapshotValidationError(error);
  }
}

function normalizeHardwareAddress(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    utf8ByteLength(value) > maximumHardwareAddressBytes ||
    !/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/u.test(value)
  ) {
    throw new OsNetworkStateTransitionError(
      "interface",
      "hardware address is invalid",
    );
  }
  return value.toLowerCase();
}

function parseHardwareAddress(value: unknown): string | undefined {
  try {
    return normalizeHardwareAddress(value);
  } catch (error) {
    throw snapshotValidationError(error);
  }
}

function normalizeAddress(
  family: OsNetworkAddressFamily,
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    utf8ByteLength(value) > maximumAddressTextBytes
  ) {
    throw new OsNetworkStateTransitionError(
      "network address",
      "text is invalid or too long",
    );
  }
  if (family === "ipv4") return normalizeIpv4(value);
  return normalizeIpv6(value);
}

function parseAddressText(
  family: OsNetworkAddressFamily,
  value: unknown,
): string {
  try {
    return normalizeAddress(family, value);
  } catch (error) {
    throw snapshotValidationError(error);
  }
}

function normalizeIpv4(value: string): string {
  const parts = value.split(".");
  if (parts.length !== 4) {
    throw new OsNetworkStateTransitionError("IPv4 address", "is invalid");
  }
  const normalized = parts.map((part) => {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) {
      throw new OsNetworkStateTransitionError("IPv4 address", "is invalid");
    }
    const octet = Number(part);
    if (octet > 255) {
      throw new OsNetworkStateTransitionError("IPv4 address", "is invalid");
    }
    return String(octet);
  });
  return normalized.join(".");
}

function normalizeIpv6(value: string): string {
  let source = value.toLowerCase();
  if (source.includes("%")) {
    throw new OsNetworkStateTransitionError(
      "IPv6 address",
      "zones are unsupported",
    );
  }
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    if (lastColon < 0) {
      throw new OsNetworkStateTransitionError("IPv6 address", "is invalid");
    }
    const ipv4 = normalizeIpv4(source.slice(lastColon + 1));
    const octets = ipv4.split(".").map(Number);
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    source = `${source.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const compressed = source.split("::");
  if (compressed.length > 2) {
    throw new OsNetworkStateTransitionError("IPv6 address", "is invalid");
  }
  const parseGroups = (text: string): string[] => {
    if (text === "") return [];
    const groups = text.split(":");
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) {
      throw new OsNetworkStateTransitionError("IPv6 address", "is invalid");
    }
    return groups;
  };
  const left = parseGroups(compressed[0] ?? "");
  const right = parseGroups(compressed[1] ?? "");
  if (compressed.length === 1 && left.length !== 8) {
    throw new OsNetworkStateTransitionError("IPv6 address", "is invalid");
  }
  if (compressed.length === 2 && left.length + right.length >= 8) {
    throw new OsNetworkStateTransitionError("IPv6 address", "is invalid");
  }
  const zeros = Array.from(
    { length: 8 - left.length - right.length },
    (): string => "0",
  );
  return [...left, ...zeros, ...right]
    .map((group) => group.padStart(4, "0"))
    .join(":");
}

function isWildcardAddress(
  family: OsNetworkAddressFamily,
  address: string,
): boolean {
  return family === "ipv4"
    ? address === "0.0.0.0"
    : address === "0000:0000:0000:0000:0000:0000:0000:0000";
}

function requireInterfaceKind(value: unknown): OsNetworkInterfaceKind {
  if (value !== "ethernet" && value !== "loopback") {
    throw new OsNetworkStateTransitionError("interface", "kind is invalid");
  }
  return value;
}

function parseInterfaceKind(value: unknown): OsNetworkInterfaceKind {
  try {
    return requireInterfaceKind(value);
  } catch (error) {
    throw snapshotValidationError(error);
  }
}

function parseLinkState(value: unknown): OsNetworkLinkState {
  if (value !== "down" && value !== "up") {
    throw new OsNetworkStateSnapshotError("interface link state is invalid");
  }
  return value;
}

function requireAddressFamily(value: unknown): OsNetworkAddressFamily {
  if (value !== "ipv4" && value !== "ipv6") {
    throw new OsNetworkStateTransitionError(
      "network address",
      "family is invalid",
    );
  }
  return value;
}

function parseAddressFamily(value: unknown): OsNetworkAddressFamily {
  try {
    return requireAddressFamily(value);
  } catch (error) {
    throw snapshotValidationError(error);
  }
}

function requireAddressScope(value: unknown): OsNetworkAddressScope {
  if (value !== "global" && value !== "host" && value !== "link") {
    throw new OsNetworkStateTransitionError(
      "network address",
      "scope is invalid",
    );
  }
  return value;
}

function parseAddressScope(value: unknown): OsNetworkAddressScope {
  try {
    return requireAddressScope(value);
  } catch (error) {
    throw snapshotValidationError(error);
  }
}

function requireSocketProtocol(value: unknown): OsNetworkSocketProtocol {
  if (value !== "tcp" && value !== "udp") {
    throw new OsNetworkStateTransitionError("socket", "protocol is invalid");
  }
  return value;
}

function parseSocketProtocol(value: unknown): OsNetworkSocketProtocol {
  try {
    return requireSocketProtocol(value);
  } catch (error) {
    throw snapshotValidationError(error);
  }
}

function parseSocketState(value: unknown): OsNetworkSocketState {
  if (value !== "bound" && value !== "listening" && value !== "open") {
    throw new OsNetworkStateSnapshotError("socket state is invalid");
  }
  return value;
}

function requirePrefixLength(
  family: OsNetworkAddressFamily,
  value: unknown,
): number {
  return requireIntegerInRange(
    value,
    0,
    family === "ipv4" ? 32 : 128,
    "network prefix length",
  );
}

function requireSnapshotPrefixLength(
  family: OsNetworkAddressFamily,
  value: unknown,
): number {
  try {
    return requirePrefixLength(family, value);
  } catch (error) {
    throw snapshotValidationError(error);
  }
}

function requireCounterDelta(value: unknown, name: string): number {
  if (value === undefined) return 0;
  return requireNonNegativeSafeInteger(value, name);
}

function requireTick(value: unknown, name: string): number {
  return requireNonNegativeSafeInteger(value, name);
}

function requireTickNotBefore(
  value: unknown,
  minimum: number,
  entity: string,
): number {
  const tick = requireTick(value, `${entity} tick`);
  if (tick < minimum) {
    throw new OsNetworkStateTransitionError(entity, "tick moved backwards");
  }
  return tick;
}

function requireNonNegativeSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OsNetworkStateTransitionError(
      name,
      "must be a non-negative safe integer",
    );
  }
  return value as number;
}

function requireIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new OsNetworkStateTransitionError(
      name,
      `must be an integer in ${String(minimum)}..${String(maximum)}`,
    );
  }
  return value as number;
}

function requireBoundedString(
  value: unknown,
  name: string,
  maximumBytes: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    utf8ByteLength(value) > maximumBytes ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new OsNetworkStateTransitionError(
      name,
      `must be 1..${String(maximumBytes)} UTF-8 bytes`,
    );
  }
  return value;
}

function requireSnapshotTick(value: unknown, name: string): number {
  return requireSnapshotNonNegativeSafeInteger(value, name);
}

function requireSnapshotNonNegativeSafeInteger(
  value: unknown,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OsNetworkStateSnapshotError(
      `${name} must be a non-negative safe integer`,
    );
  }
  return value as number;
}

function requireSnapshotIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new OsNetworkStateSnapshotError(
      `${name} must be an integer in ${String(minimum)}..${String(maximum)}`,
    );
  }
  return value as number;
}

function addressKey(
  interfaceName: string,
  family: OsNetworkAddressFamily,
  address: string,
  prefixLength: number,
): string {
  return `${interfaceName}\0${family}\0${address}\0${String(prefixLength)}`;
}

function addressRecordKey(record: OsNetworkAddressRecord): string {
  return addressKey(
    record.interfaceName,
    record.family,
    record.address,
    record.prefixLength,
  );
}

function addressIdentity(
  interfaceName: string,
  family: OsNetworkAddressFamily,
  address: string,
): string {
  return `${interfaceName}\0${family}\0${address}`;
}

function endpointKey(
  protocol: OsNetworkSocketProtocol,
  family: OsNetworkAddressFamily,
  localPort: number,
  interfaceName?: string,
  localAddress?: string,
): string {
  return `${protocol}\0${family}\0${interfaceName ?? "*"}\0${localAddress ?? "*"}\0${String(localPort)}`;
}

function socketEndpointKey(record: OsNetworkSocketRecord): string {
  if (record.localPort === undefined) {
    throw new OsNetworkStateSnapshotError(
      `socket ${record.socketId} has no bound endpoint`,
    );
  }
  return endpointKey(
    record.protocol,
    record.family,
    record.localPort,
    record.interfaceName,
    record.localAddress,
  );
}

function socketAddressKey(
  socket: OsNetworkSocketRecord,
  addressKeysByIdentity: ReadonlyMap<string, string>,
): string | undefined {
  if (
    socket.interfaceName === undefined ||
    socket.localAddress === undefined ||
    isWildcardAddress(socket.family, socket.localAddress)
  ) {
    return undefined;
  }
  return addressKeysByIdentity.get(
    addressIdentity(socket.interfaceName, socket.family, socket.localAddress),
  );
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function decrementCount(counts: Map<string, number>, key: string): void {
  const count = counts.get(key);
  if (count === undefined || count <= 1) counts.delete(key);
  else counts.set(key, count - 1);
}

function compareAddresses(
  left: OsNetworkAddressRecord,
  right: OsNetworkAddressRecord,
): number {
  return (
    left.interfaceName.localeCompare(right.interfaceName) ||
    left.family.localeCompare(right.family) ||
    left.address.localeCompare(right.address) ||
    left.prefixLength - right.prefixLength
  );
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new OsNetworkStateSnapshotError(`${name} must be an object`);
  }
  return value;
}

function requireArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new OsNetworkStateSnapshotError(`${name} must be an array`);
  }
  return value;
}

function requireOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  name: string,
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new OsNetworkStateSnapshotError(`${name} has unknown field ${key}`);
    }
  }
  for (const key of keys) {
    if (!(key in value) && !isOptionalSnapshotKey(name, key)) {
      throw new OsNetworkStateSnapshotError(`${name} is missing field ${key}`);
    }
  }
}

function isOptionalSnapshotKey(name: string, key: string): boolean {
  return (
    (name === "interface" && key === "hardwareAddress") ||
    (name === "socket" &&
      (key === "backlog" ||
        key === "interfaceName" ||
        key === "localAddress" ||
        key === "localPort"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotValidationError(error: unknown): OsNetworkStateSnapshotError {
  return new OsNetworkStateSnapshotError(
    error instanceof Error ? error.message : "value is invalid",
  );
}

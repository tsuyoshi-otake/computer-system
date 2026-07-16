import { describe, expect, it } from "vitest";

import {
  OsNetworkState,
  OsNetworkStateSnapshotError,
  OsNetworkStateTransitionError,
} from "../../src/application/os/osNetworkState.js";
import { OsRuntimeState } from "../../src/application/os/osRuntimeState.js";

describe("OS network state boundary", (): void => {
  it("owns typed interface, address, counter, socket, and listener transitions", (): void => {
    const state = new OsNetworkState("c-network");
    state.registerInterface({
      kind: "loopback",
      mtu: 65_536,
      name: "lo",
      tick: 1,
    });
    state.registerInterface({
      hardwareAddress: "02:00:00:00:00:01",
      kind: "ethernet",
      mtu: 1_500,
      name: "eth0",
      tick: 1,
    });
    state.transitionLink("lo", { kind: "bring_up", tick: 2 });
    state.transitionLink("eth0", { kind: "bring_up", tick: 2 });
    state.assignAddress({
      address: "127.0.0.1",
      family: "ipv4",
      interfaceName: "lo",
      prefixLength: 8,
      scope: "host",
      tick: 2,
    });
    state.assignAddress({
      address: "2001:db8::25",
      family: "ipv6",
      interfaceName: "eth0",
      prefixLength: 64,
      scope: "global",
      tick: 3,
    });

    expect(state.networkInterface("eth0")).toMatchObject({
      hardwareAddress: "02:00:00:00:00:01",
      linkState: "up",
    });
    expect(state.address("lo", "ipv4", "127.0.0.1", 8)).toMatchObject({
      scope: "host",
    });
    expect(state.addresses("eth0")[0]?.address).toBe(
      "2001:0db8:0000:0000:0000:0000:0000:0025",
    );

    state.accountInterfaceCounters(
      "eth0",
      {
        receiveBytes: 800,
        receivePackets: 4,
        transmitBytes: 200,
        transmitPackets: 2,
      },
      4,
    );
    expect(state.networkInterface("eth0")?.counters).toMatchObject({
      receiveBytes: 800,
      receivePackets: 4,
      transmitBytes: 200,
      transmitPackets: 2,
    });

    state.openSocket({
      family: "ipv4",
      ownerPid: 7,
      protocol: "tcp",
      socketId: "pid7-http",
      tick: 5,
    });
    state.transitionSocket("pid7-http", {
      interfaceName: "lo",
      kind: "bind",
      localAddress: "127.0.0.1",
      localPort: 8080,
      tick: 6,
    });
    state.transitionSocket("pid7-http", {
      backlog: 8,
      kind: "listen",
      tick: 7,
    });
    expect(
      state.listener("tcp", "ipv4", 8080, "lo", "127.0.0.1"),
    ).toMatchObject({
      ownerPid: 7,
      state: "listening",
    });
    expect(state.listeners()).toHaveLength(1);
    expect(() => state.removeAddress("lo", "ipv4", "127.0.0.1", 8, 8)).toThrow(
      /bound socket/u,
    );
    state.transitionSocket("pid7-http", { kind: "close", tick: 8 });
    state.removeAddress("lo", "ipv4", "127.0.0.1", 8, 9);
    expect(state.socket("pid7-http")).toBeUndefined();
  });

  it("rejects every entry capacity plus one without partial mutations", (): void => {
    const interfaces = new OsNetworkState("c-interface-cap", {
      maximumInterfaces: 1,
    });
    interfaces.registerInterface({
      kind: "loopback",
      mtu: 1_500,
      name: "lo",
      tick: 0,
    });
    const interfaceSnapshot = interfaces.snapshot();
    expect(() =>
      interfaces.registerInterface({
        kind: "ethernet",
        mtu: 1_500,
        name: "eth0",
        tick: 0,
      }),
    ).toThrowError(
      expect.objectContaining({ resource: "interfaces", maximum: 1 }),
    );
    expect(interfaces.snapshot()).toEqual(interfaceSnapshot);

    const addresses = new OsNetworkState("c-address-cap", {
      maximumAddresses: 1,
    });
    addresses.registerInterface({
      kind: "ethernet",
      mtu: 1_500,
      name: "eth0",
      tick: 0,
    });
    addresses.assignAddress({
      address: "192.0.2.1",
      family: "ipv4",
      interfaceName: "eth0",
      prefixLength: 24,
      scope: "global",
      tick: 0,
    });
    const addressSnapshot = addresses.snapshot();
    expect(() =>
      addresses.assignAddress({
        address: "192.0.2.2",
        family: "ipv4",
        interfaceName: "eth0",
        prefixLength: 24,
        scope: "global",
        tick: 0,
      }),
    ).toThrowError(
      expect.objectContaining({ resource: "addresses", maximum: 1 }),
    );
    expect(addresses.snapshot()).toEqual(addressSnapshot);

    const sockets = new OsNetworkState("c-socket-cap", {
      maximumSockets: 1,
    });
    sockets.openSocket({
      family: "ipv4",
      ownerPid: 1,
      protocol: "udp",
      socketId: "one",
      tick: 0,
    });
    const socketSnapshot = sockets.snapshot();
    expect(() =>
      sockets.openSocket({
        family: "ipv4",
        ownerPid: 1,
        protocol: "udp",
        socketId: "two",
        tick: 0,
      }),
    ).toThrowError(
      expect.objectContaining({ resource: "sockets", maximum: 1 }),
    );
    expect(sockets.snapshot()).toEqual(socketSnapshot);
  });

  it("rejects unknown entities and invalid transitions before changing state", (): void => {
    const state = new OsNetworkState("c-invalid", {
      maximumBacklog: 4,
      maximumInterfaceNameBytes: 5,
      maximumSocketIdBytes: 4,
    });
    expect(() =>
      state.transitionLink("eth0", { kind: "bring_up", tick: 1 }),
    ).toThrow(OsNetworkStateTransitionError);
    expect(() =>
      state.registerInterface({
        kind: "ethernet",
        mtu: 1_500,
        name: "ethernet0",
        tick: 0,
      }),
    ).toThrow(/UTF-8 bytes/u);
    expect(() =>
      state.registerInterface({
        kind: "ethernet",
        mtu: 65_537,
        name: "bad0",
        tick: 0,
      }),
    ).toThrow(/MTU/u);
    state.registerInterface({
      kind: "ethernet",
      mtu: 1_500,
      name: "eth0",
      tick: 1,
    });
    const before = state.snapshot();
    expect(() =>
      state.accountInterfaceCounters("eth0", { receiveBytes: 1 }, 2),
    ).toThrow(/up link/u);
    expect(() =>
      state.transitionLink("eth0", {
        kind: "bring_down",
        tick: 2,
      }),
    ).toThrow(/requires an up link/u);
    expect(() =>
      state.assignAddress({
        address: "999.0.0.1",
        family: "ipv4",
        interfaceName: "eth0",
        prefixLength: 24,
        scope: "global",
        tick: 2,
      }),
    ).toThrow(/IPv4/u);
    expect(() =>
      state.assignAddress({
        address: "192.0.2.1",
        family: "ipv4",
        interfaceName: "eth0",
        prefixLength: 33,
        scope: "global",
        tick: 2,
      }),
    ).toThrow(/prefix/u);
    expect(() =>
      state.transitionSocket("none", { kind: "close", tick: 2 }),
    ).toThrow(/does not exist/u);
    expect(() =>
      state.openSocket({
        family: "ipv4",
        ownerPid: 1,
        protocol: "udp",
        socketId: "oversized",
        tick: 2,
      }),
    ).toThrow(/UTF-8 bytes/u);
    expect(() =>
      state.openSocket({
        family: "ipv4",
        ownerPid: 32_768,
        protocol: "udp",
        socketId: "bad1",
        tick: 2,
      }),
    ).toThrow(/owner PID/u);
    expect(state.snapshot()).toEqual(before);

    state.openSocket({
      family: "ipv4",
      ownerPid: 1,
      protocol: "udp",
      socketId: "udp1",
      tick: 2,
    });
    state.transitionSocket("udp1", {
      kind: "bind",
      localPort: 53,
      tick: 3,
    });
    expect(() =>
      state.transitionSocket("udp1", {
        backlog: 1,
        kind: "listen",
        tick: 4,
      }),
    ).toThrow(/only TCP/u);
    expect(() =>
      state.transitionSocket("udp1", {
        kind: "close",
        tick: 1,
      }),
    ).toThrow(/tick moved backwards/u);
    expect(() =>
      state.transitionLink("eth0", { kind: "unknown", tick: 4 } as never),
    ).toThrow(/unknown link transition/u);

    state.openSocket({
      family: "ipv4",
      ownerPid: 1,
      protocol: "tcp",
      socketId: "tcp1",
      tick: 4,
    });
    state.transitionSocket("tcp1", {
      kind: "bind",
      localPort: 80,
      tick: 4,
    });
    expect(() =>
      state.transitionSocket("tcp1", {
        backlog: 5,
        kind: "listen",
        tick: 4,
      }),
    ).toThrow(/listener backlog/u);

    state.transitionLink("eth0", { kind: "bring_up", tick: 4 });
    state.accountInterfaceCounters(
      "eth0",
      { receiveBytes: Number.MAX_SAFE_INTEGER },
      4,
    );
    const maximumCounter = state.snapshot();
    expect(() =>
      state.accountInterfaceCounters("eth0", { receiveBytes: 1 }, 4),
    ).toThrow(/overflowed/u);
    expect(state.snapshot()).toEqual(maximumCounter);
  });

  it("round-trips strict snapshots and produces an idempotent cold projection", (): void => {
    const state = populatedState();
    const full = state.snapshot();
    expect(OsNetworkState.restore("c-network", full).snapshot()).toEqual(full);

    const cold = state.persistentSnapshot();
    expect(cold.interfaces).toHaveLength(1);
    expect(cold.interfaces[0]).toMatchObject({
      changedTick: 0,
      linkState: "down",
    });
    expect(cold.interfaces[0]?.counters.receiveBytes).toBe(0);
    expect(cold.addresses).toHaveLength(1);
    expect(cold.addresses[0]?.changedTick).toBe(0);
    expect(cold.sockets).toEqual([]);
    expect(
      OsNetworkState.restore("c-network", cold).persistentSnapshot(),
    ).toEqual(cold);

    expect(() =>
      OsNetworkState.restore("c-network", { ...full, future: true }),
    ).toThrow(OsNetworkStateSnapshotError);
    expect(() => OsNetworkState.restore("wrong", full)).toThrow(
      /Computer ID does not match/u,
    );
    expect(() =>
      OsNetworkState.restore("c-network", { ...full, schema: 2 }),
    ).toThrow(/unsupported schema/u);
    expect(() =>
      OsNetworkState.restore("c-network", {
        ...full,
        addresses: [
          {
            ...full.addresses[0],
            interfaceName: "missing",
          },
        ],
      }),
    ).toThrow(/unknown interface/u);
    expect(() =>
      OsNetworkState.restore("c-network", {
        ...full,
        sockets: [{ ...full.sockets[0], state: "connected" }],
      }),
    ).toThrow(/socket state is invalid/u);
  });

  it("integrates optionally with OS runtime snapshots and propagates revision changes", (): void => {
    const runtime = new OsRuntimeState("c-runtime-network");
    const legacyCompatible = runtime.snapshot();
    expect(legacyCompatible).not.toHaveProperty("network");
    const originalRevision = runtime.revision;

    runtime.network.registerInterface({
      kind: "loopback",
      mtu: 65_536,
      name: "lo",
      tick: 1,
    });
    runtime.network.transitionLink("lo", { kind: "bring_up", tick: 1 });
    runtime.network.assignAddress({
      address: "127.0.0.1",
      family: "ipv4",
      interfaceName: "lo",
      prefixLength: 8,
      scope: "host",
      tick: 1,
    });
    expect(runtime.revision).toBe(originalRevision + 3);

    const full = runtime.snapshot();
    expect(full.network).toBeDefined();
    expect(
      OsRuntimeState.restore("c-runtime-network", full).snapshot(),
    ).toEqual(full);
    const cold = runtime.persistentSnapshot();
    expect(cold.network?.interfaces[0]).toMatchObject({ linkState: "down" });
    expect(
      OsRuntimeState.restore("c-runtime-network", cold).persistentSnapshot(),
    ).toEqual(cold);
    expect(
      OsRuntimeState.restore("c-runtime-network", legacyCompatible).snapshot(),
    ).toEqual(legacyCompatible);
  });
});

function populatedState(): OsNetworkState {
  const state = new OsNetworkState("c-network");
  state.registerInterface({
    kind: "ethernet",
    mtu: 1_500,
    name: "eth0",
    tick: 1,
  });
  state.transitionLink("eth0", { kind: "bring_up", tick: 2 });
  state.assignAddress({
    address: "192.0.2.25",
    family: "ipv4",
    interfaceName: "eth0",
    prefixLength: 24,
    scope: "global",
    tick: 2,
  });
  state.accountInterfaceCounters(
    "eth0",
    { receiveBytes: 64, receivePackets: 1 },
    3,
  );
  state.openSocket({
    family: "ipv4",
    ownerPid: 8,
    protocol: "tcp",
    socketId: "http",
    tick: 4,
  });
  state.transitionSocket("http", {
    interfaceName: "eth0",
    kind: "bind",
    localAddress: "192.0.2.25",
    localPort: 80,
    tick: 5,
  });
  state.transitionSocket("http", { backlog: 4, kind: "listen", tick: 6 });
  return state;
}

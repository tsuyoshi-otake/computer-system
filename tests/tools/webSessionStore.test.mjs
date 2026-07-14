import { describe, expect, it, vi } from "vitest";

import {
  permanentComputerCode,
  WebSessionError,
  WebSessionStore,
} from "../../tools/web-session-store.mjs";

describe("Web terminal session store", () => {
  it("exchanges a one-use handoff without exposing the bearer token", () => {
    const store = createStore();
    const issued = store.issue(identity());

    expect(issued).not.toHaveProperty("token");
    expect(issued.handoffCode).toMatch(/^[0-9]{4}$/u);
    expect(issued.handoffCode).toBe("0001");
    const consumed = store.consumeHandoff(issued.handoffCode);
    expect(consumed.token).toMatch(/^[A-Za-z0-9_-]{20,}$/u);
    expect(store.authenticate(consumed.token).computerId).toBe("c-000001");
    expect(consumed.session.mode).toBe("writer");
    expect(() => store.consumeHandoff(issued.handoffCode)).toThrow(
      WebSessionError,
    );
  });

  it("keeps a Computer code stable and rejects an active collision", () => {
    expect(permanentComputerCode("c-000001")).toBe("0001");
    expect(permanentComputerCode("computer-10001")).toBe("0001");
    const store = createStore();
    store.issue(identity());
    expect(() =>
      store.issue({
        ...identity(),
        requestId: "r1-2",
        computerId: "computer-10001",
      }),
    ).toThrow(/same four-digit code/u);
  });

  it("finalizes expiry once and rejects the expired token", () => {
    let now = 1_000;
    const store = createStore({ clock: () => now, sessionTtlMs: 100 });
    const issued = store.issue(identity());
    const { token } = store.consumeHandoff(issued.handoffCode);
    const listener = vi.fn();
    store.subscribe(token, listener);

    now = 1_101;
    expect(store.expire()).toBe(1);
    expect(store.expire()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "state",
      session: { state: "expired", finalReason: "session_expired" },
    });
    expect(() => store.authenticate(token)).toThrow(/no longer active/u);
  });

  it("expires an unused permanent code after two minutes", () => {
    let now = 1_000;
    const store = createStore({ clock: () => now });
    const issued = store.issue(identity());
    expect(issued.handoffExpiresAt).toBe(121_000);

    now = 121_001;
    expect(store.expire()).toBe(1);
    expect(() => store.consumeHandoff(issued.handoffCode)).toThrow(
      WebSessionError,
    );
    expect(store.issue({ ...identity(), requestId: "r1-2" }).handoffCode).toBe(
      "0001",
    );
  });

  it("bounds active sessions and event-stream subscribers", () => {
    const store = createStore({ maxSessions: 1, maxConnectionsPerSession: 1 });
    const issued = store.issue(identity());
    const { token } = store.consumeHandoff(issued.handoffCode);
    const subscription = store.subscribe(token, () => undefined);

    expect(() => store.subscribe(token, () => undefined)).toThrow(/Too many/u);
    expect(() =>
      store.issue({
        ...identity(),
        requestId: "r1-2",
        computerId: "c-000002",
      }),
    ).toThrow(/capacity/u);
    subscription.unsubscribe();
    expect(store.close(issued.sessionId, "test_closed")).toBe(true);
    expect(store.close(issued.sessionId, "duplicate")).toBe(false);
  });

  it("gives each newly opened session control and demotes the previous writer", () => {
    const store = createStore();
    const first = consume(store, identity());
    const firstListener = vi.fn();
    store.subscribe(first.token, firstListener);
    const second = consume(store, {
      ...identity(),
      requestId: "r1-2",
    });
    const other = consume(store, {
      ...identity(),
      requestId: "r1-3",
      computerId: "c-000002",
    });
    const secondListener = vi.fn();
    store.subscribe(second.token, secondListener);

    expect(first.session.mode).toBe("writer");
    expect(second.session.mode).toBe("writer");
    expect(other.session.mode).toBe("writer");
    expect(store.isWriter(first.session.sessionId)).toBe(false);
    expect(store.isWriter(second.session.sessionId)).toBe(true);
    expect(firstListener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "state",
        session: expect.objectContaining({ mode: "viewer" }),
      }),
    );

    expect(store.takeControl(first.session.sessionId).mode).toBe("writer");
    expect(store.isWriter(first.session.sessionId)).toBe(true);
    expect(store.isWriter(second.session.sessionId)).toBe(false);
    expect(secondListener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "state",
        session: expect.objectContaining({ mode: "viewer" }),
      }),
    );
  });

  it("keeps the previous session view-only when the current writer closes", () => {
    const store = createStore();
    const first = consume(store, identity());
    const second = consume(store, {
      ...identity(),
      requestId: "r1-2",
    });
    expect(store.close(second.session.sessionId, "writer_closed")).toBe(true);
    expect(store.isWriter(first.session.sessionId)).toBe(false);

    const third = consume(store, {
      ...identity(),
      requestId: "r1-3",
    });
    expect(third.session.mode).toBe("writer");
    expect(store.isWriter(first.session.sessionId)).toBe(false);
  });

  it("rotates the bearer token only after the Computer returns in range", () => {
    const store = createStore();
    const connected = consume(store, identity());
    const listener = vi.fn();
    store.subscribe(connected.token, listener);
    expect(
      store.updateAccess(connected.session.sessionId, "out_of_range"),
    ).toBe(true);
    expect(() => store.reconnect("0001")).toThrow(/within 3 blocks/u);
    expect(store.isInRange(connected.session.sessionId)).toBe(false);

    expect(store.updateAccess(connected.session.sessionId, "in_range")).toBe(
      true,
    );
    const reconnected = store.reconnect("0001");
    expect(reconnected.token).not.toBe(connected.token);
    expect(reconnected.session).toMatchObject({
      access: "in_range",
      connectionCode: "0001",
      mode: "writer",
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "replaced" }),
    );
    expect(() => store.authenticate(connected.token)).toThrow(/valid/u);
    expect(store.authenticate(reconnected.token).computerId).toBe("c-000001");
  });
});

function createStore(options = {}) {
  let value = 1;
  return new WebSessionStore({
    clock: () => 1_000,
    random: (size) => Buffer.alloc(size, value++),
    ...options,
  });
}

function identity() {
  return {
    requestId: "r1-1",
    playerId: "player-1",
    computerId: "c-000001",
  };
}

function consume(store, value) {
  const issued = store.issue(value);
  return store.consumeHandoff(issued.handoffCode);
}

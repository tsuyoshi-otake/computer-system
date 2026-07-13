import { describe, expect, it, vi } from "vitest";

import {
  WebSessionError,
  WebSessionStore,
} from "../../tools/web-session-store.mjs";

describe("Web terminal session store", () => {
  it("exchanges a one-use handoff without exposing the bearer token", () => {
    const store = createStore();
    const issued = store.issue(identity());

    expect(issued).not.toHaveProperty("token");
    expect(issued.handoffCode).toMatch(/^[A-Za-z0-9_-]+$/u);
    const consumed = store.consumeHandoff(issued.handoffCode);
    expect(consumed.token).toMatch(/^[A-Za-z0-9_-]{20,}$/u);
    expect(store.authenticate(consumed.token).computerId).toBe("computer-1");
    expect(() => store.consumeHandoff(issued.handoffCode)).toThrow(
      WebSessionError,
    );
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
        computerId: "computer-2",
      }),
    ).toThrow(/capacity/u);
    subscription.unsubscribe();
    expect(store.close(issued.sessionId, "test_closed")).toBe(true);
    expect(store.close(issued.sessionId, "duplicate")).toBe(false);
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
    computerId: "computer-1",
  };
}

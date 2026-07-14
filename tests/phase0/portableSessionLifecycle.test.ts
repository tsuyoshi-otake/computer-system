import { describe, expect, it, vi } from "vitest";

import {
  PortableSessionLifecycle,
  type PortableSession,
} from "../../src/phase0/portableSessionLifecycle.js";

describe("PortableSessionLifecycle", () => {
  it("tracks held, inventory, and container locations until drop closes it", () => {
    const lifecycle = new PortableSessionLifecycle();
    expect(
      lifecycle.use({ instanceId: "p1", location: "held", ownerId: "alex" })
        .outcome,
    ).toBe("opened");
    expect(
      lifecycle.observe({
        instanceId: "p1",
        location: "inventory",
        ownerId: "alex",
      }).outcome,
    ).toBe("updated");
    expect(
      lifecycle.observe({ instanceId: "p1", location: "container" }).outcome,
    ).toBe("updated");
    expect(
      lifecycle.observe({ instanceId: "p1", location: "dropped" }).outcome,
    ).toBe("closed");
    expect(lifecycle.activeCount).toBe(0);
  });

  it("closes every session owned by a disconnected player", () => {
    const lifecycle = new PortableSessionLifecycle();
    lifecycle.use({ instanceId: "p1", location: "held", ownerId: "alex" });
    lifecycle.use({ instanceId: "p2", location: "held", ownerId: "alex" });
    lifecycle.use({ instanceId: "p3", location: "held", ownerId: "steve" });

    expect(lifecycle.disconnect("alex").map(({ outcome }) => outcome)).toEqual([
      "closed",
      "closed",
    ]);
    expect(lifecycle.activeCount).toBe(1);
  });

  it("rejects another owner for the same instance without replacing the original", () => {
    const lifecycle = new PortableSessionLifecycle();
    lifecycle.use({ instanceId: "p1", location: "held", ownerId: "alex" });

    expect(
      lifecycle.use({ instanceId: "p1", location: "held", ownerId: "steve" })
        .outcome,
    ).toBe("duplicate");
    expect(lifecycle.get("p1")?.ownerId).toBe("alex");
  });

  it("closes the former owner explicitly before a transferred item is reopened", () => {
    const lifecycle = new PortableSessionLifecycle();
    lifecycle.use({ instanceId: "p1", location: "held", ownerId: "alex" });

    expect(
      lifecycle.observe({
        instanceId: "p1",
        location: "transferred",
        ownerId: "alex",
      }),
    ).toMatchObject({ outcome: "closed" });
    expect(
      lifecycle.use({ instanceId: "p1", location: "held", ownerId: "steve" }),
    ).toMatchObject({ outcome: "opened" });
    expect(lifecycle.get("p1")?.ownerId).toBe("steve");
  });

  it("reconciles only active sessions and respects its budget", () => {
    const lifecycle = new PortableSessionLifecycle();
    lifecycle.use({
      instanceId: "active-1",
      location: "held",
      ownerId: "alex",
    });
    lifecycle.use({
      instanceId: "active-2",
      location: "held",
      ownerId: "steve",
    });
    const inspect = vi.fn(
      (session: PortableSession): PortableSession => session,
    );

    const result = lifecycle.reconcile(1, inspect);

    expect(result.checked).toBe(1);
    expect(result.remaining).toBe(1);
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("returns an explicit ignored terminal outcome for dormant items", () => {
    const lifecycle = new PortableSessionLifecycle();
    expect(
      lifecycle.observe({ instanceId: "dormant", location: "inventory" }),
    ).toEqual({ outcome: "ignored", reason: "not-active" });
  });
});

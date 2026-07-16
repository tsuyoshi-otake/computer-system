import { describe, expect, it } from "vitest";

import { ComputerLifecycle } from "../../src/domain/computer/lifecycle.js";

describe("Computer lifecycle", (): void => {
  it("boots, waits, resumes, and shuts down with an explicit owner", (): void => {
    const lifecycle = new ComputerLifecycle();
    expect(lifecycle.transition({ kind: "power_on" })).toMatchObject({
      current: { kind: "booting" },
      owner: "adapter",
    });
    expect(lifecycle.transition({ kind: "boot_complete" })).toMatchObject({
      current: { kind: "running" },
      owner: "scheduler",
    });
    expect(
      lifecycle.transition({ kind: "vm_sleep", wakeTick: 10 }),
    ).toMatchObject({
      current: { kind: "sleeping", wakeTick: 10 },
      owner: "scheduler",
    });
    expect(lifecycle.transition({ kind: "vm_ready" })).toMatchObject({
      current: { kind: "running" },
    });
    expect(
      lifecycle.transition({ kind: "vm_wait_event", filter: "redstone" }),
    ).toMatchObject({ current: { kind: "waiting_event", filter: "redstone" } });
    expect(lifecycle.transition({ kind: "shutdown" })).toMatchObject({
      current: { kind: "stopping" },
      owner: "adapter",
    });
    expect(lifecycle.transition({ kind: "stopped" })).toMatchObject({
      current: { kind: "off" },
      owner: "none",
    });
  });

  it("reboots through booting instead of becoming accidentally terminal", (): void => {
    const lifecycle = runningLifecycle();
    expect(lifecycle.transition({ kind: "reboot" })).toMatchObject({
      current: { kind: "rebooting" },
      owner: "adapter",
    });
    expect(lifecycle.transition({ kind: "reboot_ready" })).toMatchObject({
      current: { kind: "booting" },
      owner: "adapter",
    });
    expect(lifecycle.transition({ kind: "boot_complete" })).toMatchObject({
      current: { kind: "running" },
      owner: "scheduler",
    });
  });

  it("makes crash and orphan branches terminal until their explicit recovery", (): void => {
    const crashed = runningLifecycle();
    expect(
      crashed.transition({ kind: "crash", message: "boom" }),
    ).toMatchObject({
      current: { kind: "crashed", message: "boom" },
      owner: "none",
    });
    expect(crashed.transition({ kind: "vm_ready" })).toMatchObject({
      outcome: "ignored",
      reason: "already_terminal",
    });
    expect(crashed.transition({ kind: "reset" })).toMatchObject({
      current: { kind: "off" },
    });

    const orphaned = runningLifecycle();
    expect(orphaned.transition({ kind: "block_missing" })).toMatchObject({
      current: { kind: "orphaned" },
      owner: "storage",
    });
    expect(orphaned.transition({ kind: "shutdown" })).toMatchObject({
      outcome: "ignored",
      reason: "already_terminal",
    });
    expect(orphaned.transition({ kind: "block_restored" })).toMatchObject({
      current: { kind: "off" },
    });
  });

  it("rejects invalid transitions and identifies duplicate commands", (): void => {
    const lifecycle = new ComputerLifecycle();
    expect(lifecycle.transition({ kind: "boot_complete" })).toMatchObject({
      outcome: "rejected",
      event: "boot_complete",
    });
    expect(lifecycle.transition({ kind: "stopped" })).toMatchObject({
      outcome: "ignored",
      reason: "duplicate_event",
    });
    lifecycle.transition({ kind: "power_on" });
    lifecycle.transition({ kind: "shutdown" });
    expect(lifecycle.transition({ kind: "shutdown" })).toMatchObject({
      outcome: "ignored",
      reason: "duplicate_event",
    });
  });
});

function runningLifecycle(): ComputerLifecycle {
  const lifecycle = new ComputerLifecycle();
  lifecycle.transition({ kind: "power_on" });
  lifecycle.transition({ kind: "boot_complete" });
  return lifecycle;
}

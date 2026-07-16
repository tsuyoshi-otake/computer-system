export type TerminalTargetResult =
  | { readonly outcome: "selected"; readonly computerId: string }
  | { readonly outcome: "missing"; readonly ownerId: string };

export type TerminalTargetDisconnectResult =
  | { readonly outcome: "disconnected"; readonly computerId: string }
  | { readonly outcome: "missing"; readonly ownerId: string };

export class TerminalTargetRegistry {
  private readonly selected = new Map<string, string>();

  select(ownerId: string, computerId: string): TerminalTargetResult {
    requireIdentifier(ownerId, "owner");
    requireIdentifier(computerId, "computer");
    this.selected.set(ownerId, computerId);
    return { outcome: "selected", computerId };
  }

  resolve(ownerId: string): TerminalTargetResult {
    requireIdentifier(ownerId, "owner");
    const computerId = this.selected.get(ownerId);
    return computerId === undefined
      ? { outcome: "missing", ownerId }
      : { outcome: "selected", computerId };
  }

  disconnect(ownerId: string): TerminalTargetDisconnectResult {
    requireIdentifier(ownerId, "owner");
    const computerId = this.selected.get(ownerId);
    if (computerId === undefined) return { outcome: "missing", ownerId };
    this.selected.delete(ownerId);
    return { outcome: "disconnected", computerId };
  }
}

function requireIdentifier(value: string, kind: string): void {
  if (value.trim().length === 0)
    throw new Error(`Terminal ${kind} ID is empty`);
}

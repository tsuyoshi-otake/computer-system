export type PocketLocation =
  "held" | "inventory" | "container" | "dropped" | "disconnected";

export type PocketSessionState = "open" | "closed" | "duplicate";

export interface PocketObservation {
  readonly instanceId: string;
  readonly location: PocketLocation;
  readonly ownerId?: string;
}

export interface PocketSession extends PocketObservation {
  readonly state: PocketSessionState;
}

export type PocketTransition =
  | { readonly outcome: "opened"; readonly session: PocketSession }
  | { readonly outcome: "updated"; readonly session: PocketSession }
  | { readonly outcome: "closed"; readonly session: PocketSession }
  | { readonly outcome: "duplicate"; readonly session: PocketSession }
  | { readonly outcome: "ignored"; readonly reason: "not-active" };

export interface ReconcileResult {
  readonly checked: number;
  readonly remaining: number;
  readonly transitions: readonly PocketTransition[];
}

export class PocketSessionLifecycle {
  readonly #active = new Map<string, PocketSession>();
  #cursor = 0;

  get activeCount(): number {
    return this.#active.size;
  }

  get(instanceId: string): PocketSession | undefined {
    return this.#active.get(instanceId);
  }

  use(observation: PocketObservation): PocketTransition {
    const existing = this.#active.get(observation.instanceId);
    if (
      existing !== undefined &&
      existing.ownerId !== undefined &&
      observation.ownerId !== undefined &&
      existing.ownerId !== observation.ownerId
    ) {
      return {
        outcome: "duplicate",
        session: { ...observation, state: "duplicate" },
      };
    }

    const session: PocketSession = { ...observation, state: "open" };
    this.#active.set(observation.instanceId, session);
    return { outcome: existing === undefined ? "opened" : "updated", session };
  }

  observe(observation: PocketObservation): PocketTransition {
    const existing = this.#active.get(observation.instanceId);
    if (existing === undefined) {
      return { outcome: "ignored", reason: "not-active" };
    }

    if (
      existing.ownerId !== undefined &&
      observation.ownerId !== undefined &&
      existing.ownerId !== observation.ownerId
    ) {
      return {
        outcome: "duplicate",
        session: { ...observation, state: "duplicate" },
      };
    }

    if (
      observation.location === "dropped" ||
      observation.location === "disconnected"
    ) {
      const session: PocketSession = { ...observation, state: "closed" };
      this.#active.delete(observation.instanceId);
      return { outcome: "closed", session };
    }

    const session: PocketSession = { ...observation, state: "open" };
    this.#active.set(observation.instanceId, session);
    return { outcome: "updated", session };
  }

  disconnect(ownerId: string): readonly PocketTransition[] {
    const transitions: PocketTransition[] = [];
    for (const session of [...this.#active.values()]) {
      if (session.ownerId === ownerId) {
        transitions.push(
          this.observe({
            instanceId: session.instanceId,
            location: "disconnected",
            ownerId,
          }),
        );
      }
    }
    return transitions;
  }

  reconcile(
    budget: number,
    inspect: (session: PocketSession) => PocketObservation,
  ): ReconcileResult {
    const sessions = [...this.#active.values()];
    if (sessions.length === 0 || budget <= 0) {
      return { checked: 0, remaining: sessions.length, transitions: [] };
    }

    const checked = Math.min(Math.floor(budget), sessions.length);
    const transitions: PocketTransition[] = [];
    for (let offset = 0; offset < checked; offset += 1) {
      const index = (this.#cursor + offset) % sessions.length;
      const session = sessions[index];
      if (session === undefined) {
        throw new Error("Pocket reconciliation cursor was out of bounds.");
      }
      transitions.push(this.observe(inspect(session)));
    }
    this.#cursor = (this.#cursor + checked) % Math.max(this.#active.size, 1);
    return {
      checked,
      remaining: Math.max(this.#active.size - checked, 0),
      transitions,
    };
  }
}

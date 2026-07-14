export type PortableLocation =
  | "held"
  | "inventory"
  | "container"
  | "dropped"
  | "disconnected"
  | "transferred";

export type PortableSessionState = "open" | "closed" | "duplicate";

export interface PortableObservation {
  readonly instanceId: string;
  readonly location: PortableLocation;
  readonly ownerId?: string;
}

export interface PortableSession extends PortableObservation {
  readonly state: PortableSessionState;
}

export type PortableTransition =
  | { readonly outcome: "opened"; readonly session: PortableSession }
  | { readonly outcome: "updated"; readonly session: PortableSession }
  | { readonly outcome: "closed"; readonly session: PortableSession }
  | { readonly outcome: "duplicate"; readonly session: PortableSession }
  | { readonly outcome: "ignored"; readonly reason: "not-active" };

export interface ReconcileResult {
  readonly checked: number;
  readonly remaining: number;
  readonly transitions: readonly PortableTransition[];
}

export class PortableSessionLifecycle {
  readonly #active = new Map<string, PortableSession>();
  #cursor = 0;

  get activeCount(): number {
    return this.#active.size;
  }

  get(instanceId: string): PortableSession | undefined {
    return this.#active.get(instanceId);
  }

  use(observation: PortableObservation): PortableTransition {
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

    const session: PortableSession = { ...observation, state: "open" };
    this.#active.set(observation.instanceId, session);
    return { outcome: existing === undefined ? "opened" : "updated", session };
  }

  observe(observation: PortableObservation): PortableTransition {
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
      observation.location === "disconnected" ||
      observation.location === "transferred"
    ) {
      const session: PortableSession = { ...observation, state: "closed" };
      this.#active.delete(observation.instanceId);
      return { outcome: "closed", session };
    }

    const session: PortableSession = { ...observation, state: "open" };
    this.#active.set(observation.instanceId, session);
    return { outcome: "updated", session };
  }

  disconnect(ownerId: string): readonly PortableTransition[] {
    const transitions: PortableTransition[] = [];
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
    inspect: (session: PortableSession) => PortableObservation,
  ): ReconcileResult {
    const sessions = [...this.#active.values()];
    if (sessions.length === 0 || budget <= 0) {
      return { checked: 0, remaining: sessions.length, transitions: [] };
    }

    const checked = Math.min(Math.floor(budget), sessions.length);
    const transitions: PortableTransition[] = [];
    for (let offset = 0; offset < checked; offset += 1) {
      const index = (this.#cursor + offset) % sessions.length;
      const session = sessions[index];
      if (session === undefined) {
        throw new Error("Portable reconciliation cursor was out of bounds.");
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

import { requireComputerId } from "../../domain/computer/identity.js";

export type WebTerminalRequestSource = "debug" | "interaction";

export type WebTerminalRequestAdmissionResult =
  | { readonly outcome: "admitted" }
  | { readonly outcome: "capacity" | "duplicate" };

interface AdmissionEntry {
  readonly key: string;
  readonly playerId: string;
  readonly requestId: string;
  readonly source: WebTerminalRequestSource;
  expiresAtTick?: number;
  state: "cooldown" | "pending";
}

export class WebTerminalRequestAdmission {
  private readonly entriesByKey = new Map<string, AdmissionEntry>();
  private readonly keysByRequest = new Map<string, string>();

  constructor(
    private readonly maximumEntries = 32,
    private readonly cooldownTicks = 10,
  ) {
    requirePositiveInteger(maximumEntries, "admission capacity");
    requirePositiveInteger(cooldownTicks, "admission cooldown");
  }

  admit(options: {
    readonly computerId: string;
    readonly currentTick: number;
    readonly playerId: string;
    readonly requestId: string;
    readonly source: WebTerminalRequestSource;
  }): WebTerminalRequestAdmissionResult {
    validateTick(options.currentTick);
    validateBoundedIdentifier(options.playerId, "player ID");
    validateBoundedIdentifier(options.requestId, "request ID");
    requireComputerId(options.computerId);
    if (options.source !== "interaction" && options.source !== "debug") {
      throw new Error("Invalid Web terminal request source");
    }
    this.prune(options.currentTick);
    if (this.keysByRequest.has(options.requestId)) {
      throw new Error(
        `Web terminal request ${options.requestId} already exists`,
      );
    }
    const key = admissionKey(
      options.source,
      options.playerId,
      options.computerId,
    );
    if (this.entriesByKey.has(key)) return { outcome: "duplicate" };
    if (this.entriesByKey.size >= this.maximumEntries) {
      return { outcome: "capacity" };
    }
    const entry: AdmissionEntry = {
      key,
      playerId: options.playerId,
      requestId: options.requestId,
      source: options.source,
      state: "pending",
    };
    this.entriesByKey.set(key, entry);
    this.keysByRequest.set(options.requestId, key);
    return { outcome: "admitted" };
  }

  finalize(
    requestId: string,
    outcome: "accepted" | "failed",
    currentTick: number,
  ): boolean {
    validateBoundedIdentifier(requestId, "request ID");
    validateTick(currentTick);
    const key = this.keysByRequest.get(requestId);
    if (key === undefined) return false;
    this.keysByRequest.delete(requestId);
    const entry = this.entriesByKey.get(key);
    if (entry === undefined || entry.requestId !== requestId) return false;
    if (outcome === "failed") {
      this.entriesByKey.delete(key);
      return true;
    }
    entry.state = "cooldown";
    entry.expiresAtTick = currentTick + this.cooldownTicks;
    return true;
  }

  prune(currentTick: number): number {
    validateTick(currentTick);
    let removed = 0;
    for (const [key, entry] of this.entriesByKey) {
      if (
        entry.state === "cooldown" &&
        entry.expiresAtTick !== undefined &&
        entry.expiresAtTick <= currentTick
      ) {
        this.entriesByKey.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.entriesByKey.size;
  }
}

function admissionKey(
  source: WebTerminalRequestSource,
  playerId: string,
  computerId: string,
): string {
  return `${source}\0${playerId}\0${computerId}`;
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`Web terminal ${name} must be a positive integer`);
  }
}

function validateTick(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Web terminal tick must be a non-negative integer");
  }
}

function validateBoundedIdentifier(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new Error(`Invalid Web terminal ${name}`);
  }
}

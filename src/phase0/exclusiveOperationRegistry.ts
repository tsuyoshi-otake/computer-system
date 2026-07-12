export type OperationTerminalStatus = "committed" | "rolled_back";

export interface OperationConflict {
  readonly ownerId: string;
  readonly resource: string;
  readonly status: "conflict";
}

export class OperationLease {
  private terminalStatus: OperationTerminalStatus | undefined;

  public constructor(
    private readonly registry: ExclusiveOperationRegistry,
    public readonly operationId: string,
    public readonly resources: readonly string[],
  ) {}

  public get status(): "active" | OperationTerminalStatus {
    return this.terminalStatus ?? "active";
  }

  public commit(): OperationTerminalStatus {
    return this.finalize("committed");
  }

  public rollback(): OperationTerminalStatus {
    return this.finalize("rolled_back");
  }

  private finalize(status: OperationTerminalStatus): OperationTerminalStatus {
    if (this.terminalStatus !== undefined) {
      if (this.terminalStatus !== status) {
        throw new Error(
          `Operation ${this.operationId} already ended as ${this.terminalStatus}.`,
        );
      }
      return this.terminalStatus;
    }

    this.registry.finalize(this.operationId, this.resources);
    this.terminalStatus = status;
    return status;
  }
}

export class ExclusiveOperationRegistry {
  private readonly owners = new Map<string, string>();

  public get activeResourceCount(): number {
    return this.owners.size;
  }

  public tryBegin(
    operationId: string,
    resources: readonly string[],
  ): OperationConflict | OperationLease {
    if (operationId.length === 0) {
      throw new Error("Operation ID must not be empty.");
    }

    const normalized = [...new Set(resources)].sort();
    if (normalized.length === 0) {
      throw new Error("An operation must own at least one resource.");
    }

    for (const resource of normalized) {
      const ownerId = this.owners.get(resource);
      if (ownerId !== undefined) {
        return { ownerId, resource, status: "conflict" };
      }
    }

    for (const resource of normalized) {
      this.owners.set(resource, operationId);
    }
    return new OperationLease(this, operationId, normalized);
  }

  public finalize(operationId: string, resources: readonly string[]): void {
    for (const resource of resources) {
      if (this.owners.get(resource) !== operationId) {
        throw new Error(
          `Operation ${operationId} no longer owns resource ${resource}.`,
        );
      }
    }
    for (const resource of resources) {
      this.owners.delete(resource);
    }
  }
}

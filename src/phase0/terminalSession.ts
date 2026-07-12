export type TerminalCloseReason = "ClientClosed" | "ServerClosed" | "UserBusy";

export type TerminalFinalizationKind =
  | "cancelled"
  | "competing_form"
  | "disconnected"
  | "failed"
  | "server_closed"
  | "terminated";

export interface TerminalFinalization {
  readonly kind: TerminalFinalizationKind;
  readonly detail?: string;
}

export interface TerminalLineEvent {
  readonly type: "terminal_line";
  readonly line: string;
}

export class TerminalSession {
  private finalization: TerminalFinalization | undefined;
  private terminationRequested = false;

  submitLine(line: string): TerminalLineEvent | undefined {
    if (this.finalization !== undefined) {
      return undefined;
    }

    return { type: "terminal_line", line };
  }

  requestTermination(): boolean {
    if (this.finalization !== undefined || this.terminationRequested) {
      return false;
    }

    this.terminationRequested = true;
    return true;
  }

  finalizeClose(reason: TerminalCloseReason): TerminalFinalization {
    if (this.finalization !== undefined) {
      return this.finalization;
    }

    if (reason === "ClientClosed") {
      return this.finish({ kind: "cancelled" });
    }
    if (reason === "UserBusy") {
      return this.finish({ kind: "competing_form" });
    }
    return this.finish({
      kind: this.terminationRequested ? "terminated" : "server_closed",
    });
  }

  finalizeFailure(error: unknown, playerValid: boolean): TerminalFinalization {
    if (this.finalization !== undefined) {
      return this.finalization;
    }

    if (!playerValid) {
      return this.finish({ kind: "disconnected" });
    }

    return this.finish({
      kind: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  getFinalization(): TerminalFinalization | undefined {
    return this.finalization;
  }

  private finish(finalization: TerminalFinalization): TerminalFinalization {
    this.finalization = finalization;
    return finalization;
  }
}

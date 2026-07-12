import type {
  TerminalCloseReason,
  TerminalFinalization,
  TerminalLineEvent,
} from "../../domain/terminal/terminalSession.js";
import { TerminalSession } from "../../domain/terminal/terminalSession.js";

export type TerminalSessionEvent =
  | TerminalLineEvent
  | { readonly type: "terminal_closed"; readonly result: TerminalFinalization };

export class ManagedTerminalSession {
  private readonly session = new TerminalSession();
  private closeEvent: TerminalSessionEvent | undefined;

  constructor(private readonly emit: (event: TerminalSessionEvent) => void) {}

  submitLine(line: string): boolean {
    const event = this.session.submitLine(line);
    if (event === undefined) return false;
    this.emit(event);
    return true;
  }

  requestTermination(): boolean {
    return this.session.requestTermination();
  }

  finalizeClose(reason: TerminalCloseReason): TerminalFinalization {
    return this.finalize(this.session.finalizeClose(reason));
  }

  finalizeFailure(error: unknown, playerValid: boolean): TerminalFinalization {
    return this.finalize(this.session.finalizeFailure(error, playerValid));
  }

  private finalize(result: TerminalFinalization): TerminalFinalization {
    if (this.closeEvent === undefined) {
      this.closeEvent = { type: "terminal_closed", result };
      this.emit(this.closeEvent);
    }
    return result;
  }
}

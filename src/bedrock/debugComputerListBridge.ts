import { identityService } from "./computerRegistry.js";

const responseMarker = "CS_DEBUG_COMPUTER_LIST ";
const requestPattern =
  /^(l[a-z0-9]+-[a-z0-9]+) ([0-9]{1,10}) ([1-9]|[1-5][0-9]|6[0-4])$/u;

export function handleDebugComputerListRequest(message: string): void {
  const match = requestPattern.exec(message);
  if (match === null) {
    emit({ status: "rejected", error: "invalid_request" });
    return;
  }
  const [, requestId, cursorText, limitText] = match;
  try {
    const cursor = Number.parseInt(cursorText ?? "", 10);
    const limit = Number.parseInt(limitText ?? "", 10);
    const page = identityService().blockObservationPage(cursor, limit);
    emit({
      requestId,
      status: "completed",
      cursor,
      nextCursor: page.nextCursor,
      total: page.total,
      computers: page.observations.map((observation) => ({
        computerId: observation.computerId,
        family: observation.family,
        form: observation.form,
        physicalKey: observation.physicalKey,
      })),
    });
  } catch (error: unknown) {
    emit({
      requestId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function emit(payload: Readonly<Record<string, unknown>>): void {
  console.warn(responseMarker + JSON.stringify(payload));
}

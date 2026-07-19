import { describe, expect, it } from "vitest";

import { Cs486CompileError } from "../../src/application/toolchain/cs486AsmDiagnostics.js";
import {
  concatGuestToolchainTranscriptsOrFailure,
  createGuestToolchainTranscript,
  guestToolchainTranscriptFromCompileError,
  guestToolchainTranscriptFromStreams,
  maximumGuestDiagnosticNotes,
  maximumGuestTranscriptBytes,
  maximumGuestTranscriptEntries,
  maximumGuestTranscriptRows,
  renderGuestToolchainTranscript,
} from "../../src/application/toolchain/guestToolchainTranscript.js";

describe("GuestToolchainTranscript", (): void => {
  it("derives DOS text and navigation from one structured diagnostic", (): void => {
    const error = new Cs486CompileError("duplicate symbol foo", 3, {
      code: "CSASM042",
      column: 1,
      notes: [
        {
          message: "foo was first defined here",
          span: {
            end: { column: 4, line: 2, offset: 13, source: "C:\\BAD.ASM" },
            start: { column: 1, line: 2, offset: 10, source: "C:\\BAD.ASM" },
          },
        },
      ],
      source: "C:\\BAD.ASM",
    });

    const transcript = guestToolchainTranscriptFromCompileError(error, "ASM");
    const rendered = renderGuestToolchainTranscript(transcript, {
      profile: "dos",
    });

    expect(rendered.stderr).toContain(
      "C:\\BAD.ASM(3,1): error CSASM042: duplicate symbol foo\r\n",
    );
    expect(rendered.stderr).toContain(
      "C:\\BAD.ASM(2,1): note: foo was first defined here\r\n",
    );
    expect(rendered.navigableDiagnostics[0]).toMatchObject({
      column: 1,
      fileName: "C:\\BAD.ASM",
      line: 3,
      outputLine: 0,
      diagnostic: {
        code: "CSASM042",
        notes: [{ message: "foo was first defined here" }],
      },
    });
  });

  it("rejects every transcript capacity plus one before rendering", (): void => {
    expect(() =>
      createGuestToolchainTranscript(
        Array.from(
          { length: maximumGuestTranscriptEntries + 1 },
          () =>
            ({
              channel: "stdout",
              kind: "text",
              text: "x",
            }) as const,
        ),
      ),
    ).toThrow(/entries exceed/u);
    expect(() =>
      createGuestToolchainTranscript([
        {
          channel: "stdout",
          kind: "text",
          text: "x".repeat(maximumGuestTranscriptBytes + 1),
        },
      ]),
    ).toThrow(/bytes exceed/u);
    expect(() =>
      createGuestToolchainTranscript([
        {
          channel: "stdout",
          kind: "text",
          text: "x\n".repeat(maximumGuestTranscriptRows + 1),
        },
      ]),
    ).toThrow(/rows exceed/u);
    expect(() =>
      createGuestToolchainTranscript([
        {
          diagnostic: {
            code: "CSASM001",
            message: "too many notes",
            notes: Array.from(
              { length: maximumGuestDiagnosticNotes + 1 },
              () => ({ message: "note" }),
            ),
            severity: "error",
          },
          kind: "diagnostic",
        },
      ]),
    ).toThrow(/notes exceed/u);
  });

  it("turns aggregate overflow into one bounded observable failure", (): void => {
    const maximumSized = guestToolchainTranscriptFromStreams(
      "x".repeat(maximumGuestTranscriptBytes - 16),
      "",
    );
    const merged = concatGuestToolchainTranscriptsOrFailure(
      [guestToolchainTranscriptFromStreams("prefix", ""), maximumSized],
      "workbench: toolchain output limit exceeded\r\n",
    );

    expect(merged.limitExceeded).toBe(true);
    expect(
      renderGuestToolchainTranscript(merged.transcript, { profile: "dos" })
        .stderr,
    ).toBe("workbench: toolchain output limit exceeded\r\n");
  });
});

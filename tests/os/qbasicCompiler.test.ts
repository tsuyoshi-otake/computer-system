import { describe, expect, it } from "vitest";

import { compileCs486Source } from "../../src/application/toolchain/highLevelCompilers.js";
import { runCs486 } from "../../src/domain/cpu/cs486.js";

function run(source: string): string {
  return runCs486(compileCs486Source("basic", source), {
    instructionLimit: 100_000,
    memoryBytes: 128 * 1_024,
  }).output;
}

describe("CS QBASIC compiler", (): void => {
  it("compiles case-insensitive scalar declarations, comparisons, IF, FOR, and WHILE", (): void => {
    expect(
      run(
        [
          "dim Total as LONG",
          "FOR i% = 1 TO 5",
          "IF i% MOD 2 = 1 THEN total = total + i%",
          "NEXT i%",
          'PRINT "TOTAL="; total',
          "WHILE total < 20: total = total + 1: WEND",
          "? total",
          "END",
        ].join("\n"),
      ),
    ).toBe("TOTAL=9\n20\n");
  });

  it("supports DO/LOOP, negative STEP, hexadecimal, boolean, and integer operators", (): void => {
    expect(
      run(
        [
          "X = &H3",
          "DO WHILE X > 0",
          "PRINT X;",
          "X = X - 1",
          "LOOP",
          "PRINT",
          "FOR I = 3 TO 1 STEP -1",
          "PRINT I;",
          "NEXT",
          "PRINT",
          "PRINT (7 \\ 2) + (7 MOD 2)",
          "PRINT NOT FALSE AND TRUE",
          "END",
        ].join("\n"),
      ),
    ).toBe("321\n321\n4\n-1\n");
  });

  it("resolves numbered and named GOTO/GOSUB targets", (): void => {
    expect(
      run(
        [
          "10 GOSUB AddAnswer",
          "20 IF ANSWER = 42 THEN 40 ELSE GOTO 90",
          "40 PRINT ANSWER",
          "50 END",
          "AddAnswer:",
          "ANSWER = 6 * 7",
          "RETURN",
          '90 PRINT "FAILED"',
          "END",
        ].join("\n"),
      ),
    ).toBe("42\n");
  });

  it("prints QBasic doubled quotes and apostrophe comments", (): void => {
    expect(
      run(['PRINT "A ""quote""" \' ignored', "PRINT 42", "END"].join("\n")),
    ).toBe('A "quote"\n42\n');
  });

  it("rejects unimplemented string variables and function calls explicitly", (): void => {
    expect(() =>
      compileCs486Source("basic", 'DIM NAME$\nNAME$ = "CS"\n'),
    ).toThrow("string variables are not yet implemented");
    expect(() => compileCs486Source("basic", 'PRINT "A" + "B"\n')).toThrow(
      "string expressions are not yet implemented",
    );
    expect(() => compileCs486Source("basic", "PRINT Answer()\n")).toThrow(
      "function calls are not yet implemented",
    );
  });

  it.each([
    'SHELL "COMMAND.COM"',
    "OUT &H3F8, 65",
    "X = PEEK(0)",
    "POKE 0, 1",
    "CALL ABSOLUTE(0)",
    'OPEN "COM1" FOR OUTPUT AS #1',
    'OPEN "LPT1" FOR OUTPUT AS #1',
  ])("rejects unsafe DOS/host access explicitly: %s", (statement): void => {
    expect(() => compileCs486Source("basic", `${statement}\nEND\n`)).toThrow(
      "sandboxed CS QBASIC 1.0",
    );
  });

  it("distinguishes unsupported QuickBASIC, GW-BASIC, labels, and block errors", (): void => {
    expect(() => compileCs486Source("basic", "BYVAL X\n")).toThrow(
      "QuickBASIC-only",
    );
    expect(() => compileCs486Source("basic", "RENUM\n")).toThrow("GW-BASIC");
    expect(() => compileCs486Source("basic", "GOTO missing\n")).toThrow(
      "undefined line or label",
    );
    expect(() => compileCs486Source("basic", "NEXT\n")).toThrow(
      "NEXT without FOR",
    );
    expect(() => compileCs486Source("basic", "FOR I=1 TO 2\n")).toThrow(
      "FOR without NEXT",
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  dosShellSyntaxFeatures,
  parseShellProgram,
  ShellSyntaxError,
} from "../../src/application/os/shellSyntax.js";

describe("BusyBox shell syntax", (): void => {
  it("parses quoting, pipelines, redirects, and control operators", (): void => {
    const program = parseShellProgram(
      `printf "%s\\n" 'hello world' | grep hello > out && cat < out`,
    );

    expect(program).toEqual({
      chains: [
        {
          pipeline: {
            commands: [
              {
                words: ["printf", "%s\\n", "hello world"],
                redirects: [],
              },
              {
                words: ["grep", "hello"],
                redirects: [{ mode: "write", path: "out" }],
              },
            ],
          },
        },
        {
          operator: "&&",
          pipeline: {
            commands: [
              {
                words: ["cat"],
                redirects: [{ mode: "read", path: "out" }],
              },
            ],
          },
        },
      ],
    });
  });

  it("keeps single-quoted variables literal and expands other variables", (): void => {
    const program = parseShellProgram(`echo '$HOME' "$HOME":$?`, (name) =>
      name === "?" ? "7" : "/home",
    );
    expect(program.chains[0]?.pipeline.commands[0]?.words).toEqual([
      "echo",
      "$HOME",
      "/home:7",
    ]);
  });

  it("rejects incomplete and unbounded syntax explicitly", (): void => {
    expect(() => parseShellProgram("echo 'missing")).toThrow(ShellSyntaxError);
    expect(() => parseShellProgram("echo ok |")).toThrow(/expected command/u);
    expect(() => parseShellProgram("cat >")).toThrow(/expected path/u);
    expect(parseShellProgram("sleep 1 &")).toEqual({
      chains: [
        {
          pipeline: {
            background: true,
            commands: [
              {
                redirects: [],
                words: ["sleep", "1"],
              },
            ],
          },
        },
      ],
    });
    expect(() => parseShellProgram("sleep 1 & echo late")).toThrow(
      /must terminate/u,
    );
    expect(() =>
      parseShellProgram("sleep 1 &", () => undefined, dosShellSyntaxFeatures),
    ).toThrow(/background jobs/u);
  });
});

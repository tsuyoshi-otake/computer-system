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
            operators: ["pipe-stdout"],
            commands: [
              {
                words: ["printf", "%s\\n", "hello world"],
                redirects: [],
              },
              {
                words: ["grep", "hello"],
                redirects: [
                  { descriptor: 1, kind: "open", mode: "write", path: "out" },
                ],
              },
            ],
          },
        },
        {
          operator: "&&",
          pipeline: {
            operators: [],
            commands: [
              {
                words: ["cat"],
                redirects: [
                  { descriptor: 0, kind: "open", mode: "read", path: "out" },
                ],
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
            operators: [],
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

  it("preserves Linux descriptor redirect order and pipe kind", (): void => {
    expect(
      parseShellProgram("probe >all 2>&1 |& next 2>>err 2>last <input >output"),
    ).toEqual({
      chains: [
        {
          pipeline: {
            commands: [
              {
                redirects: [
                  {
                    descriptor: 1,
                    kind: "open",
                    mode: "write",
                    path: "all",
                  },
                  { descriptor: 2, kind: "duplicate", target: 1 },
                ],
                words: ["probe"],
              },
              {
                redirects: [
                  {
                    descriptor: 2,
                    kind: "open",
                    mode: "append",
                    path: "err",
                  },
                  {
                    descriptor: 2,
                    kind: "open",
                    mode: "write",
                    path: "last",
                  },
                  {
                    descriptor: 0,
                    kind: "open",
                    mode: "read",
                    path: "input",
                  },
                  {
                    descriptor: 1,
                    kind: "open",
                    mode: "write",
                    path: "output",
                  },
                ],
                words: ["next"],
              },
            ],
            operators: ["pipe-stdout-and-stderr"],
          },
        },
      ],
    });
  });

  it("lowers Linux &> into ordered stdout and stderr redirects", (): void => {
    expect(parseShellProgram("probe &>combined")).toEqual({
      chains: [
        {
          pipeline: {
            commands: [
              {
                redirects: [
                  {
                    descriptor: 1,
                    kind: "open",
                    mode: "write",
                    path: "combined",
                  },
                  { descriptor: 2, kind: "duplicate", target: 1 },
                ],
                words: ["probe"],
              },
            ],
            operators: [],
          },
        },
      ],
    });
  });

  it("binds bounded literal here-documents to standard input", (): void => {
    expect(parseShellProgram("cat <<EOF\none\ntwo\nEOF")).toEqual({
      chains: [
        {
          pipeline: {
            commands: [
              {
                redirects: [
                  {
                    content: "one\ntwo\n",
                    delimiter: "EOF",
                    descriptor: 0,
                    kind: "here-document",
                  },
                ],
                words: ["cat"],
              },
            ],
            operators: [],
          },
        },
      ],
    });
    expect(() => parseShellProgram("cat <<EOF\none")).toThrow(
      /missing its terminating delimiter/u,
    );
  });

  it("rejects Linux-only descriptor syntax in DOS before execution", (): void => {
    for (const source of [
      "echo ok 2>err",
      "echo ok 2>>err",
      "echo ok 2>&1",
      "echo ok &>all",
      "echo ok <<EOF",
      "echo ok |& more",
    ]) {
      expect(() =>
        parseShellProgram(source, () => undefined, dosShellSyntaxFeatures),
      ).toThrow(/not supported/u);
    }
  });
});

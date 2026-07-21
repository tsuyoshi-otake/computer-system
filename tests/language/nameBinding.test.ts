import { describe, expect, it } from "vitest";

import { parse } from "../../src/domain/language/parser.js";
import {
  analyzeScopes,
  type ScopeInfo,
  type ScopeSymbol,
} from "../../src/domain/language/scope.js";

function symbol(scope: ScopeInfo, name: string): ScopeSymbol | undefined {
  return scope.symbols.find((candidate) => candidate.name === name);
}

describe("Computer System Python name binding", (): void => {
  it("normalizes Unicode identifiers while retaining authored source spans", (): void => {
    const module = parse("変数 = 1\nK = 変数\n");

    expect(module.body[0]).toMatchObject({
      targets: [{ name: "変数", span: { start: { column: 1 } } }],
    });
    expect(module.body[1]).toMatchObject({
      targets: [{ name: "K", span: { start: { column: 1 } } }],
      value: { name: "変数" },
    });
  });

  it("parses global and nonlocal declarations as explicit statements", (): void => {
    const module = parse(`
def update():
    global shared, other
    nonlocal captured
`);

    expect(module.body[0]).toMatchObject({
      body: [
        {
          kind: "GlobalStatement",
          names: [{ name: "shared" }, { name: "other" }],
        },
        {
          kind: "NonlocalStatement",
          names: [{ name: "captured" }],
        },
      ],
    });
  });

  it("classifies explicit globals, nonlocals, and captured cells", (): void => {
    const analysis = analyzeScopes(
      parse(`
shared = 1
def outer():
    captured = 2
    def inner():
        global shared
        nonlocal captured
        captured = captured + 1
        shared = shared + 1
        return captured
    return inner
`),
    );
    const outer = analysis.root.children[0]!;
    const inner = outer.children[0]!;

    expect(symbol(outer, "captured")).toMatchObject({ binding: "cell" });
    expect(symbol(inner, "captured")).toMatchObject({
      binding: "free",
      declaredNonlocal: true,
    });
    expect(symbol(inner, "shared")).toMatchObject({
      binding: "global",
      declaredGlobal: true,
    });
  });

  it.each([
    ["module nonlocal", "nonlocal value\n", /module scope/u],
    [
      "parameter global",
      "def f(value):\n    global value\n",
      /parameter and global/u,
    ],
    [
      "use before global",
      "def f():\n    print(value)\n    global value\n",
      /used prior to global declaration/u,
    ],
    [
      "missing nonlocal binding",
      "def f():\n    nonlocal value\n",
      /no binding for nonlocal/u,
    ],
    [
      "conflicting declarations",
      "def f():\n    global value\n    nonlocal value\n",
      /both global and nonlocal/u,
    ],
  ])("rejects %s", (_name, source, message): void => {
    expect((): void => {
      analyzeScopes(parse(source));
    }).toThrow(message);
  });
});

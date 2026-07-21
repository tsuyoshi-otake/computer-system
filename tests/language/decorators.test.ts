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

describe("Computer System Python decorator syntax and scope", (): void => {
  it("parses assignment-expression decorators before functions and classes", (): void => {
    const module = parse(`
@outer(1)
@inner
def sample(value=2):
    return value
@chosen := outer
class Item(object):
    pass
`);

    expect(module.body).toMatchObject([
      {
        decorators: [
          { kind: "CallExpression" },
          { kind: "IdentifierExpression", name: "inner" },
        ],
        kind: "FunctionDefinition",
        name: "sample",
      },
      {
        bases: [{ kind: "IdentifierExpression", name: "object" }],
        decorators: [
          {
            kind: "NamedExpression",
            target: { kind: "IdentifierExpression", name: "chosen" },
          },
        ],
        kind: "ClassDefinition",
        name: "Item",
      },
    ]);
  });

  it("collects decorators in the containing scope before defaults and bases", (): void => {
    const analysis = analyzeScopes(
      parse(`
def build():
    decorator = None
    base = object
    @selected := decorator
    def sample(value=selected):
        return value
    @decorator
    class Item(base):
        pass
    return [selected, sample, Item]
`),
    );
    const build = analysis.root.children[0]!;
    const sample = build.children[0]!;
    const item = build.children[1]!;

    expect(symbol(build, "decorator")).toMatchObject({
      assigned: true,
      binding: "local",
      referenced: true,
    });
    expect(symbol(build, "selected")).toMatchObject({
      assigned: true,
      binding: "local",
      referenced: true,
    });
    expect(symbol(build, "base")).toMatchObject({
      binding: "local",
      referenced: true,
    });
    expect(symbol(sample, "selected")).toBeUndefined();
    expect(item.kind).toBe("class");
  });

  it("bounds decorator count and rejects detached or tuple decorators", (): void => {
    const exact = `@first\n@second\ndef sample():\n    pass\n`;
    expect(
      parse(exact, { parser: { maxItemsPerConstruct: 2 } }).body[0],
    ).toMatchObject({ decorators: [{}, {}], kind: "FunctionDefinition" });
    expect(() => parse(exact, { parser: { maxItemsPerConstruct: 1 } })).toThrow(
      /Construct item limit exceeded/u,
    );
    expect(() => parse("@first\nvalue = 1\n")).toThrow(
      /Decorator must be followed by def, async def, or class/u,
    );
    expect(() => parse("@first, second\ndef sample():\n    pass\n")).toThrow(
      /Expected newline/u,
    );
  });
});

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

describe("Computer System Python class syntax and scope", (): void => {
  it("parses executable class bodies with zero, one, or authored multiple bases", (): void => {
    const module = parse(`
class Plain:
    pass
class Derived(Plain):
    value = 1
class AuthoredPair(Plain, Derived):
    pass
`);

    expect(module.body).toMatchObject([
      { bases: [], kind: "ClassDefinition", name: "Plain" },
      {
        bases: [{ kind: "IdentifierExpression", name: "Plain" }],
        body: [{ kind: "AssignmentStatement" }],
        kind: "ClassDefinition",
        name: "Derived",
      },
      {
        bases: [
          { kind: "IdentifierExpression", name: "Plain" },
          { kind: "IdentifierExpression", name: "Derived" },
        ],
        kind: "ClassDefinition",
        name: "AuthoredPair",
      },
    ]);
  });

  it("keeps class locals out of method closures while forwarding enclosing function cells", (): void => {
    const analysis = analyzeScopes(
      parse(`
global_value = 100
def build():
    captured = 7
    class Sample:
        before = captured
        captured = 9
        def read(self):
            return captured + global_value
    return Sample
`),
    );
    const build = analysis.root.children[0]!;
    const sample = build.children[0]!;
    const read = sample.children[0]!;

    expect(sample.kind).toBe("class");
    expect(symbol(sample, "before")).toMatchObject({
      assigned: true,
      binding: "local",
    });
    expect(symbol(sample, "captured")).toMatchObject({
      assigned: true,
      binding: "local",
      referenced: true,
    });
    expect(sample.freeNames).toContain("captured");
    expect(symbol(build, "captured")).toMatchObject({ binding: "cell" });
    expect(symbol(read, "captured")).toMatchObject({ binding: "free" });
    expect(symbol(read, "global_value")).toMatchObject({ binding: "global" });
  });

  it("reserves one hidden class cell for __class__ and builtin super references", (): void => {
    const analysis = analyzeScopes(
      parse(`
def outer():
    __class__ = "outer"
    class Sample:
        copied = __class__
        def explicit(self):
            return __class__
        def cooperative(self):
            return super()
        shadowed = lambda super: super()
    return Sample
`),
    );
    const outer = analysis.root.children[0]!;
    const sample = outer.children[0]!;
    const explicit = sample.children[0]!;
    const cooperative = sample.children[1]!;
    const shadowed = sample.children[2]!;

    expect(sample.needsClassCell).toBe(true);
    expect(sample.freeNames).toContain("__class__");
    expect(symbol(sample, "__class__")).toMatchObject({ binding: "free" });
    expect(explicit.freeNames).toContain("__class__");
    expect(symbol(explicit, "__class__")).toMatchObject({ binding: "free" });
    expect(cooperative.freeNames).toContain("__class__");
    expect(symbol(cooperative, "super")).toMatchObject({ binding: "global" });
    expect(shadowed.freeNames).not.toContain("__class__");
    expect(symbol(shadowed, "super")).toMatchObject({
      binding: "local",
      parameter: true,
    });
  });

  it("evaluates a base in the enclosing scope and bounds class scope count and nesting", (): void => {
    const module = parse(`
Base = object
class Outer(Base):
    class Inner:
        pass
`);
    const analysis = analyzeScopes(module, {
      maxScopeNesting: 2,
      maxScopes: 3,
      maxSymbolsPerScope: 3,
    });

    expect(symbol(analysis.root, "Base")).toMatchObject({
      binding: "global",
      referenced: true,
    });
    expect(analysis.root.children[0]!.children[0]!.kind).toBe("class");
    expect(() => analyzeScopes(module, { maxScopes: 2 })).toThrow(
      /Scope count limit exceeded/u,
    );
    expect(() => analyzeScopes(module, { maxScopeNesting: 1 })).toThrow(
      /Scope nesting limit exceeded/u,
    );
  });
});

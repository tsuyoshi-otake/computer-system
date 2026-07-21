import { describe, expect, it } from "vitest";

import type {
  ClassDefinition,
  FunctionDefinition,
  TypeAliasStatement,
} from "../../src/domain/language/ast.js";
import { parse } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python 3.14 type-parameter syntax and scopes", (): void => {
  it("parses generic functions, classes, aliases, bounds, packs, and defaults", (): void => {
    const module = parse(`
def identity[T, U: (Text, Bytes) = Text, *Ts = Shape, **P = Signature](value: T) -> U:
    return value
class Box[T: Bound](Base):
    value: T
type Pair[T, U = T] = (T, U)
type = 1
`);
    const identity = module.body[0] as FunctionDefinition;
    const box = module.body[1] as ClassDefinition;
    const pair = module.body[2] as TypeAliasStatement;

    expect(identity.typeParameters).toMatchObject([
      { kind: "TypeVariable", name: "T" },
      {
        bound: { kind: "TupleExpression" },
        defaultValue: { kind: "IdentifierExpression", name: "Text" },
        kind: "TypeVariable",
        name: "U",
      },
      {
        defaultValue: { kind: "IdentifierExpression", name: "Shape" },
        kind: "TypeVariableTuple",
        name: "Ts",
      },
      {
        defaultValue: { kind: "IdentifierExpression", name: "Signature" },
        kind: "ParameterSpecification",
        name: "P",
      },
    ]);
    expect(identity.parameters[0]?.annotation).toMatchObject({
      kind: "IdentifierExpression",
      name: "T",
    });
    expect(box).toMatchObject({
      bases: [{ kind: "IdentifierExpression", name: "Base" }],
      typeParameters: [
        {
          bound: { kind: "IdentifierExpression", name: "Bound" },
          kind: "TypeVariable",
          name: "T",
        },
      ],
    });
    expect(pair).toMatchObject({
      kind: "TypeAliasStatement",
      name: "Pair",
      typeParameters: [
        { kind: "TypeVariable", name: "T" },
        {
          defaultValue: { kind: "IdentifierExpression", name: "T" },
          kind: "TypeVariable",
          name: "U",
        },
      ],
      value: { kind: "TupleExpression" },
    });
    expect(module.body[3]).toMatchObject({
      kind: "AssignmentStatement",
      targets: [{ kind: "IdentifierExpression", name: "type" }],
    });
  });

  it("uses an overlay scope while keeping decorators and defaults outside", (): void => {
    const module = parse(`
T = 10
def decorate(value):
    return value
@decorate(T)
def generic[T: Outer](value: T = T) -> T:
    return T
class Container:
    Local = 20
    def method[T: Local](self, value: T = Local) -> T:
        return T
type Alias[T: Outer, U = T] = (T, U)
`);
    const analysis = analyzeScopes(module);
    const generic = module.body[2] as FunctionDefinition;
    const container = module.body[3] as ClassDefinition;
    const method = container.body[1] as FunctionDefinition;
    const alias = module.body[4] as TypeAliasStatement;

    expect(
      analysis.annotationScopes
        .get(generic)
        ?.symbols.find(({ name }) => name === "T"),
    ).toMatchObject({ assigned: true, binding: "cell", referenced: true });
    expect(
      analysis.functionScopes
        .get(generic)
        ?.symbols.find(({ name }) => name === "T"),
    ).toMatchObject({ binding: "free", referenced: true });
    expect(
      analysis.root.symbols.find(({ name }) => name === "T"),
    ).toMatchObject({ binding: "global", referenced: true });
    expect(
      analysis.annotationScopes
        .get(method)
        ?.symbols.find(({ name }) => name === "Local"),
    ).toMatchObject({ binding: "local", referenced: true });
    expect(
      analysis.annotationScopes
        .get(alias)
        ?.symbols.find(({ name }) => name === "U"),
    ).toMatchObject({ assigned: true, binding: "cell", referenced: true });
  });

  it("rejects malformed lists and annotation-scope-only expressions", (): void => {
    expect(() => parse("def empty[]():\n    pass\n")).toThrow(
      /Type parameter list cannot be empty/u,
    );
    expect(() => parse("def duplicate[T, T]():\n    pass\n")).toThrow(
      /Duplicate type parameter T/u,
    );
    expect(() => parse("def ordered[T = Default, U]():\n    pass\n")).toThrow(
      /Non-default type parameter follows default/u,
    );
    expect(() => parse("def packed[*Ts: Bound]():\n    pass\n")).toThrow(
      /Only a type variable may declare/u,
    );
    expect(() => parse("def forward[T: U, U]():\n    pass\n")).toThrow(
      /cannot reference later type parameter U/u,
    );
    expect(() => parse("type Alias[T] = (captured := T)\n")).toThrow(
      /Annotation expressions cannot contain/u,
    );
    expect(() => parse("class Invalid[T: (yield Value)]:\n    pass\n")).toThrow(
      /Annotation expressions cannot contain/u,
    );
  });

  it("forbids nonlocal rebinding of an enclosing type parameter", (): void => {
    expect(() =>
      analyzeScopes(
        parse(`
def outer[T]():
    def inner():
        nonlocal T
        return T
    return inner
`),
      ),
    ).toThrow(/nonlocal binding not allowed for type parameter T/u);
  });

  it("enforces exact construct and shared scope ceilings", (): void => {
    expect(() =>
      parse("def exact[T, U]():\n    pass\n", {
        parser: { maxItemsPerConstruct: 2 },
      }),
    ).not.toThrow();
    expect(() =>
      parse("def overflow[T, U, V]():\n    pass\n", {
        parser: { maxItemsPerConstruct: 2 },
      }),
    ).toThrow(/Construct item limit exceeded/u);

    const generic = parse("def exact[T]():\n    return T\n");
    expect(() => analyzeScopes(generic, { maxScopes: 3 })).not.toThrow();
    expect(() => analyzeScopes(generic, { maxScopes: 2 })).toThrow(
      /Scope count limit exceeded/u,
    );
  });
});

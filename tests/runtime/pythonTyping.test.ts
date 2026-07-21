import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python 3.14 typing runtime", (): void => {
  it("imports the intrinsic module without a filesystem module", (): void => {
    const machine = runPythonCs486Core(`
import typing
from typing import Any, Never, NoReturn, Self, LiteralString, NoDefault
module_name = typing.__name__
same_any = Any is typing.Any
same_never = Never is typing.Never
same_no_return = NoReturn is typing.NoReturn
same_self = Self is typing.Self
same_literal_string = LiteralString is typing.LiteralString
same_no_default = NoDefault is typing.NoDefault
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("module_name")).toBe("typing");
    for (const name of [
      "same_any",
      "same_never",
      "same_no_return",
      "same_self",
      "same_literal_string",
      "same_no_default",
    ]) {
      expect(machine.globals.get(name)).toBe(true);
    }
  });

  it("does not allow a guest typing.py file to shadow the intrinsic module", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.writeFile("/typing.py", "shadowed = True\n");
    const machine = runPythonCs486Core(
      `
import typing
intrinsic = typing.__name__ == "typing"
shadow_rejected = False
try:
    typing.shadowed
except AttributeError:
    shadow_rejected = True
`,
      { filesystem },
    );

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("intrinsic")).toBe(true);
    expect(machine.globals.get("shadow_rejected")).toBe(true);
  });

  it("provides stable bounded special forms and Python-style reflection", (): void => {
    const machine = runPythonCs486Core(`
from typing import Optional, Union, Literal, Annotated, Callable, get_origin, get_args
optional = Optional[int]
optional_same = Optional[int] is optional
optional_origin = get_origin(optional) is Union
optional_first = get_args(optional)[0] is int
optional_second_name = get_args(optional)[1].__name__
literal = Literal["ready", 3]
literal_origin = get_origin(literal) is Literal
literal_count = len(get_args(literal))
annotated = Annotated[int, "unit", 7]
annotated_origin = get_origin(annotated) is Annotated
annotated_metadata = annotated.__metadata__
callable_alias = Callable[[int, str], bool]
callable_origin = get_origin(callable_alias) is Callable
callable_count = len(get_args(callable_alias))
plain_origin = get_origin(17)
plain_args = get_args(int)
list_origin = get_origin(list[str]) is list
list_argument = get_args(list[str])[0] is str
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("optional_same")).toBe(true);
    expect(machine.globals.get("optional_origin")).toBe(true);
    expect(machine.globals.get("optional_first")).toBe(true);
    expect(machine.globals.get("optional_second_name")).toBe("NoneType");
    expect(machine.globals.get("literal_origin")).toBe(true);
    expect(machine.globals.get("literal_count")).toBe(2);
    expect(machine.globals.get("annotated_origin")).toBe(true);
    expect(machine.globals.get("annotated_metadata")).toMatchObject({
      kind: "tuple",
      values: ["unit", 7],
    });
    expect(machine.globals.get("callable_origin")).toBe(true);
    expect(machine.globals.get("callable_count")).toBe(2);
    expect(machine.globals.get("plain_origin")).toBeNull();
    expect(machine.globals.get("plain_args")).toMatchObject({
      kind: "tuple",
      values: [],
    });
    expect(machine.globals.get("list_origin")).toBe(true);
    expect(machine.globals.get("list_argument")).toBe(true);
  });

  it("constructs TypeVar, ParamSpec, and TypeVarTuple with stable projections", (): void => {
    const machine = runPythonCs486Core(`
from typing import TypeVar, ParamSpec, TypeVarTuple, NoDefault
T = TypeVar("T", int, str, covariant=True, default=bool)
P = ParamSpec("P", default=tuple)
Ts = TypeVarTuple("Ts", default=tuple)
t_name = T.__name__
t_constraints = T.__constraints__
t_default = T.__default__ is bool
t_covariant = T.__covariant__
p_default = P.__default__ is tuple
p_args_origin = P.args.__origin__ is P
p_kwargs_origin = P.kwargs.__origin__ is P
ts_default = Ts.__default__ is tuple
open_list = list[T]
open_parameter = open_list.__parameters__[0] is T
missing = TypeVar("Missing")
missing_default = missing.__default__ is NoDefault
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("t_name")).toBe("T");
    expect(machine.globals.get("t_constraints")).toMatchObject({
      kind: "tuple",
    });
    expect(machine.globals.get("t_default")).toBe(true);
    expect(machine.globals.get("t_covariant")).toBe(true);
    expect(machine.globals.get("p_default")).toBe(true);
    expect(machine.globals.get("p_args_origin")).toBe(true);
    expect(machine.globals.get("p_kwargs_origin")).toBe(true);
    expect(machine.globals.get("ts_default")).toBe(true);
    expect(machine.globals.get("open_parameter")).toBe(true);
    expect(machine.globals.get("missing_default")).toBe(true);
  });

  it("keeps typing helpers runtime-only and preserves object identity", (): void => {
    const machine = runPythonCs486Core(`
from typing import cast, assert_type, assert_never, reveal_type
value = [1, 2]
cast_same = cast(list[int], value) is value
assert_same = assert_type(value, list[int]) is value
reveal_same = reveal_type(value) is value
never_failed = False
try:
    assert_never("reachable")
except AssertionError:
    never_failed = True
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("cast_same")).toBe(true);
    expect(machine.globals.get("assert_same")).toBe(true);
    expect(machine.globals.get("reveal_same")).toBe(true);
    expect(machine.globals.get("never_failed")).toBe(true);
  });

  it("rejects invalid form and constructor calls without corrupting state", (): void => {
    const machine = runPythonCs486Core(`
from typing import Optional, Callable, TypeVar, ParamSpec
optional_failed = False
callable_failed = False
constraint_failed = False
variance_failed = False
paramspec_failed = False
try:
    Optional[int, str]
except TypeError:
    optional_failed = True
try:
    Callable[int]
except TypeError:
    callable_failed = True
try:
    TypeVar("T", int)
except TypeError:
    constraint_failed = True
try:
    TypeVar("T", covariant=True, contravariant=True)
except ValueError:
    variance_failed = True
try:
    ParamSpec("P", int)
except TypeError:
    paramspec_failed = True
after = 23
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("optional_failed")).toBe(true);
    expect(machine.globals.get("callable_failed")).toBe(true);
    expect(machine.globals.get("constraint_failed")).toBe(true);
    expect(machine.globals.get("variance_failed")).toBe(true);
    expect(machine.globals.get("paramspec_failed")).toBe(true);
    expect(machine.globals.get("after")).toBe(23);
  });

  it("keeps typing and alias reflection attributes read-only", (): void => {
    const machine = runPythonCs486Core(`
from typing import Any, Annotated, NoDefault, ParamSpec
P = ParamSpec("P")
alias = Annotated[int, "tag"]
token_read_only = False
projection_read_only = False
metadata_read_only = False
no_default_read_only = False
try:
    Any.__name__ = "changed"
except AttributeError:
    token_read_only = True
try:
    P.args.__origin__ = int
except AttributeError:
    projection_read_only = True
try:
    alias.__metadata__ = ()
except AttributeError:
    metadata_read_only = True
try:
    NoDefault.__name__ = "changed"
except AttributeError:
    no_default_read_only = True
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("token_read_only")).toBe(true);
    expect(machine.globals.get("projection_read_only")).toBe(true);
    expect(machine.globals.get("metadata_read_only")).toBe(true);
    expect(machine.globals.get("no_default_read_only")).toBe(true);
  });

  it("rejects cache capacity plus one while retaining the published alias", (): void => {
    const machine = runPythonCs486Core(
      `
from typing import Final
first = Final[int]
failed = False
try:
    Final[str]
except ResourceLimitError:
    failed = True
same = Final[int] is first
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
      },
    );

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("same")).toBe(true);
  });

  it("accounts typing aliases in reachable heap ownership", (): void => {
    const baseline = runPythonCs486Core("from typing import Final\n");
    const withAlias = runPythonCs486Core(
      "from typing import Final\nalias = Final[int]\n",
    );

    expect(baseline.state.kind).toBe("completed");
    expect(withAlias.state.kind).toBe("completed");
    expect(withAlias.program.runtime.memoryUsageBytes).toBeGreaterThan(
      baseline.program.runtime.memoryUsageBytes,
    );
  });

  it("remains resumable under small CS486 instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
from typing import Optional, get_origin, get_args, Union
alias = Optional[int]
same = get_origin(alias) is Union and get_args(alias)[0] is int
`);
    let slices = 0;
    while (
      slices < 2_000 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runSlice(8);
      slices += 1;
    }

    expect(slices).toBeGreaterThan(1);
    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("same")).toBe(true);
  });
});

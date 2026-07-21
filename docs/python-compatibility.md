# Computer System Python compatibility contract

Computer System Python 1.0 is targeting the Python 3.14 language and core
semantics under the `python-3.14-cs` profile. It is an independent, bounded
implementation for CS486 computers, not CPython embedded in the Add-On. The
current implementation is still a partial subset and must not be described as
Python 3.14 compatible until every claim gate in
[`python-314-compatibility.json`](python-314-compatibility.json) passes.

## Stable execution contract

- `python` is the canonical command. `micropython` remains a compatibility alias
  for existing worlds and scripts.
- Python source compiles into the same validated CS486 process used by the other
  guest languages. There is no separate Python VM, instruction pointer,
  scheduler, or host-language execution path.
- Desktop CS486DX and CS486DX2 profiles admit user Python. Portable CS386SX
  profiles reject it with command status 127.
- Guest state stays bounded by parser/compiler budgets, the outer process
  scheduler, `GuestRamLedger`, the guest filesystem, and existing guest I/O
  owners.
- `GuestProcessMemoryGrant`, backed by `GuestRamLedger`, owns one physical
  process reservation containing the declared managed-runtime residency.
  `PythonHeapAccounting` measures the reachable Python value graph inside that
  reservation and enforces its managed quota; it never acquires a duplicate RAM
  lease.
- Imports search the script directory, `/lib/python`, then
  `/usr/lib/computer-system/python`. Supported `.py` trees may contain regular
  packages marked by `__init__.py`; namespace packages and dynamic import hooks
  are unavailable. Native guest extensions use the versioned CS486OBJ format;
  they do not use the CPython extension ABI.

## Current frontend ceilings

The direct lexer, parser, and scope analyzer apply immutable limits per parse.
They check capacity before adding the next token, AST construct, scope, or
symbol, and reject authored excess with a located `LanguageSyntaxError`.
Application module-graph byte, module-count, and import-depth limits remain a
separate outer boundary.

| Layer                 | Current per-parse ceiling                                 |
| --------------------- | --------------------------------------------------------- |
| Lexer                 | 512,000 decoded source code units; 131,072 tokens         |
| Names and literals    | 512 code units per identifier; 65,536 per literal         |
| Lexical structure     | delimiter nesting 64; indentation depth 64                |
| Parser                | 16,384 statements; block and expression nesting 64        |
| Calls and collections | 256 parameters; 256 arguments; 4,096 items per construct  |
| Formatted strings     | 256 embedded expressions, sharing the parent parse budget |
| Scope analysis        | 1,024 scopes; nesting 64; 4,096 symbols per scope         |

## Implemented name-binding foundation

Identifiers accept Unicode XID start/continue characters and are normalized to
NFKC for lookup while diagnostics retain the authored source span. Every name
operation carries a compile-time `global`, `local`, `cell`, or `free` binding.
`global` and `nonlocal` use whole-function declaration rules; an uninitialized
local reports `UnboundLocalError`, and nested functions retain shared closure
cells after defining frames return. Defaults and initialized captured values are
measured only when their managed function remains reachable. A failed source
module initialization removes its pending alias and cache state so a later
import can retry deterministically.

## Implemented regular packages and imports

The parser and scope analyzer accept dotted imports, aliases, absolute and
explicit-relative `from` imports, parenthesized name lists, and module-level
wildcard imports. A regular package is a guest directory containing
`__init__.py`; package initialization wins over a same-name `.py` module,
parents initialize before children, and each module executes once per process.
Plain dotted imports bind the top-level package, `as` binds the resolved leaf,
and imported children are published on their parent namespace.

Modules receive stable `__name__`, `__package__`, and `__file__` values before
their code runs; packages additionally receive a bounded `__path__` list.
Ordinary circular imports observe the exact partially initialized namespace. An
escaping initialization fault removes the incomplete cache entry and child
publication so a later import may retry. The graph admits 64 modules including
`__main__`, import depth 16, and 512,000 aggregate UTF-8 source bytes. Namespace
packages, zip imports, and dynamic import hooks remain explicit exclusions.

## Implemented structural pattern matching

`match` and `case` are soft keywords, so existing programs may still bind those
names outside a match statement. A subject is evaluated exactly once, then cases
are tried from top to bottom. The bounded subset includes literal and singleton,
dotted value, capture, wildcard, OR, AS, fixed/starred list-or-tuple sequence,
built-in dictionary mapping, and C3 multiple-inheritance class patterns. Mapping
patterns support an independent `**rest` dictionary; class patterns use
inherited `__match_args__` plus ordinary instance/class attribute lookup.

A failed pattern publishes no captures, including a failed OR alternative. Once
the complete pattern succeeds, all captures pass one managed-heap and namespace
preflight and publish together before its guard runs. As in Python, those names
remain bound when the guard evaluates false or raises. A missing class attribute
means the pattern did not match; non-`AttributeError` failures propagate through
the normal exception path. Patterns share the parser nesting and 4,096-item
construct ceilings and add a 4,096-node compiler ceiling. Each case executes as
one bounded managed operation whose work contributes to CS486 cycle debt.

Custom sequence/mapping protocols and descriptor or metaclass customization
remain outside this implemented phase.

## Implemented deferred annotations

Annotated assignments, every function parameter kind, and return annotations use
Python 3.14-style deferred evaluation. Function annotations evaluate in authored
parameter/return order when `__annotations__` is first accessed. Simple module
and class annotations are registered only when their statement executes, so
conditional definitions remain observable. A successful access publishes and
caches one mutable dictionary after capacity and managed-heap admission; a
faulting access publishes nothing and retries on the next access. A partially
initialized module instead returns a fresh executed-so-far dictionary so a
circular importer cannot freeze an incomplete cache.

Annotation scopes are separate bounded scopes. They may capture enclosing
function cells, and class or method annotations may read the completed
immediately enclosing class namespace. A simple function-local annotation only
classifies its name as local: its annotation expression never executes and does
not appear in the function dictionary. Attribute, subscript, slice, and
parenthesized-name annotations are non-simple; their target and optional RHS
retain ordinary evaluation/assignment behavior, but their annotation is never
evaluated or published. `yield`, `yield from`, and `:=` are rejected in the
annotation scope itself while a nested function remains its own scope.

Each annotation evaluator is an ordinary managed function on the same CS486
process and therefore shares call depth, scheduler slices, modeled cycle debt,
fault routing, and reachable-heap accounting. Results use the 4,096-entry
collection ceiling; annotation scopes count toward the shared 1,024-scope and
64-level nesting ceilings. The direct `__annotate__` API, `annotationlib`
alternate formats, future-import stringization, broader `typing` semantics, and
writable/deletable annotation descriptors are not implemented in this phase.

## Implemented type parameters and lazy type aliases

Generic `def`, `class`, and soft-keyword `type` statements accept bounded Python
3.14 type parameter lists. Plain, `*Ts`, and `**P` parameters become runtime
TypeVar-, TypeVarTuple-, and ParamSpec-shaped objects and are published in
authored order through one stable `__type_params__` tuple on the completed
function, class, or alias. Their names stay inside the annotation scope:
function defaults and decorator expressions use the containing scope, while
function annotations, class bodies/bases, and alias values may retain the type
parameter cells.

A plain type variable may have one bound or tuple constraints; all three kinds
may have a default. `__bound__`, `__constraints__`, `__default__`, and a type
alias's `__value__` evaluate only on first access through ordinary managed CS486
calls. A successful result is cached with stable identity after managed heap
admission. A fault publishes no cache and a later access retries. Parameters
without defaults share the internal `typing.NoDefault`-shaped sentinel. The
wrapper annotation scope, evaluator closures, parameter objects, stable tuples,
cached values, and in-progress evaluation state all remain in the same reachable
graph and share call depth, scheduler slices, cycle debt, scope limits, the
4,096-item ceiling, and the existing process RAM reservation.

Generic classes and type aliases can be subscribed with one or more runtime
arguments. `Box[int]`, `Alias[str]`, `list[int]`, `dict[str, int]`,
`tuple[int, str]`, and `set[int]` produce stable cached aliases with read-only
`__origin__`, `__args__`, and `__parameters__`. Open aliases retain their type
parameters and may be subscribed again; nested aliases substitute those
parameters recursively under the shared 64-level nesting ceiling. Missing
ordinary or `ParamSpec` arguments use lazily evaluated defaults. One
`TypeVarTuple` consumes the bounded variable-width portion of a subscription. An
explicit `ParamSpec` accepts list or tuple form; when it is the only type
parameter, an expanded argument list is normalized to one tuple-shaped slot.

Calling a parameterized user class or supported collection alias erases its type
arguments and calls the original runtime object. Parameterized aliases are
deliberately rejected as `isinstance`/`issubclass` class-info values because the
profile does not enforce annotations at runtime. Cache publication preflights
the reachable managed heap and the process admits at most 4,096 distinct aliases
by default. The full `typing` and `annotationlib` APIs, `evaluate_*` alternate
formats, variance introspection, custom `__class_getitem__` or metaclass
subscription, runtime type enforcement, and writable/deletable reflection
attributes remain deferred.

## Implemented bounded `typing` runtime core

`typing` is a reserved runtime-owned intrinsic module. It is available in the
core, production, and MCP environments without a guest module file, and a guest
`typing.py` cannot shadow it. Resolution never invokes host Python and does not
add an installer or a second evaluator.

The module exposes stable `Any`, `Never`, `NoReturn`, `Self`, `LiteralString`,
and `NoDefault` values; bounded `Union`, `Optional`, `Literal`, `Annotated`,
`Callable`, qualifier, guard, unpack, and concatenate forms; and runtime
`TypeVar`, `ParamSpec`, and `TypeVarTuple` constructors. `get_origin` and
`get_args` reflect supported aliases, while `cast`, `assert_type`, and
`reveal_type` return their supplied value unchanged. `assert_never` raises
`AssertionError` when reached. These APIs do not enforce annotations at runtime.

Typing values, aliases, projections, and metadata are process-local, read-only
where reflected, and accounted through the same bounded generic cache, 4,096
collection ceiling, 64-level nesting limit, managed heap, faults, modeled cycle
debt, and CS486 slices. Full static-checker behavior, `get_type_hints` and
`ForwardRef` evaluation, `TypedDict`/`NamedTuple` generation, overload registry,
structural `Protocol` checks, `runtime_checkable`, and arbitrary metaclass or
`__class_getitem__` hooks remain unavailable.

Function definitions distinguish positional-only, positional-or-keyword,
keyword-only, variadic positional, and variadic keyword parameters. Defaults are
evaluated once, from left to right, when the definition executes. Call items are
also evaluated left to right; iterable and mapping unpacking then perform
duplicate and string-key validation. The default runtime admits at most 4,096
expanded positional-plus-keyword arguments even though the source-level call
syntax limit counts at most 256 call items. Comparison chains short-circuit and
evaluate each operand at most once.

Conditional expressions evaluate their condition before evaluating exactly one
result branch and associate from right to left. Expression-only `lambda`
functions share the same five parameter kinds, definition-time defaults,
argument binder, call-depth limit, closure cells, reachable-heap accounting, and
CS486 call/return path as `def`; no lambda-specific interpreter is introduced.
Identifier-only assignment expressions evaluate one RHS, store through the
existing lexical global/local/cell/free binding, and return that same value.
Unparenthesized forms are accepted in `if`/`while` tests, list/set display
items, comprehension results, and positional call arguments. Restricted
subexpressions require parentheses. Inside a comprehension, the target binds in
the containing non-comprehension scope; iterable forms and conflicts with any
enclosing iteration target are rejected before compilation. `assert` evaluates
its condition once, skips its optional message on success, and evaluates the
message once before raising `AssertionError` on failure. The CS Profile
currently has no `-O` optimization mode, so `__debug__` is always `True`, cannot
be rebound, and assertions are never compiled out. Ordinary assignment evaluates
its right-hand side once before assigning chained identifier, attribute,
subscription, slice, or destructuring targets from left to right. Augmented
assignment evaluates an identifier, attribute, or subscription target exactly
once before its right-hand side and reuses the bounded numeric operator path.
Annotated assignment, slice deletion, and augmented slice assignment remain
outside this verified subset.

List and tuple displays expand iterable `*` items from left to right. Dictionary
displays expand `**` mappings in the same order and later entries overwrite
earlier keys. Nested list/tuple assignment targets consume one RHS; one starred
target per nesting level receives a newly allocated list of remaining values.
Source construct limits still apply before compilation, while every expanded
runtime element is admitted against the default 4,096-item collection ceiling
and the same reachable managed heap.

List, set, and dictionary comprehensions support bounded synchronous `for` and
`if` clauses. The leftmost iterable is evaluated once in the enclosing scope;
iteration targets, later iterables, filters, and result expressions run in an
implicit nested scope and do not leak. Clauses nest left to right, and
dictionary keys are evaluated before their values. Targets reuse identifier and
bounded list/tuple destructuring. Generator expressions, asynchronous
comprehensions, class-scope behavior, and custom data-model iteration remain
outside this phase.

Mutable sets support explicit and starred displays, `set()` with zero or one
iterable, deterministic iteration, membership, `len`, and equality. Primitive
values and recursively hashable tuples use a canonical bounded key, including
Python numeric equality for booleans and integral numbers; mutable values raise
`TypeError`. Unique growth is preflighted against the collection ceiling, and
hash construction is bounded by the runtime string ceiling. Deterministic
iteration is a CS-profile guarantee, not a portable ordering promise from Python
itself.

Bounded class definitions evaluate zero or more bases exactly once from left to
right in the enclosing scope and execute the suite in a distinct class
namespace. A non-class base fails before the suite. After a successful suite,
the runtime constructs a C3 MRO; duplicate or inconsistent bases retain already
observable suite side effects but do not publish the class name, so a failed
redefinition preserves the previous binding. Class bodies can read enclosing
function cells, while methods skip class locals as lexical bindings and retain
those same enclosing cells. A method or lambda that references `__class__` or
builtin `super` receives one hidden class cell, distinct from authored outer,
class-body, and parameter bindings. Successful completion initializes it to the
exact class after C3 and heap admission and before `__set_name__`; a rejected
set-name completion clears it. Instance reads use descriptor precedence: an
inherited data descriptor, the instance namespace, an inherited non-data
descriptor, then an inherited class value. Managed user functions are non-data
descriptors; one found through class lookup becomes a bound method, while the
same function stored directly on an instance remains unbound. Calling a class
resolves inherited `__new__` through the canonical C3 MRO. A plain managed
`def __new__` is implicitly static and receives the requested class followed by
the original positional and keyword arguments exactly once.
`object.__new__(cls)` strictly accepts one class and allocates a heap-accounted
bare instance. When a custom `__new__` returns an instance of the requested
class or a subclass, construction resolves `__init__` from the returned
instance's class, forwards the original arguments, and requires a `None` return.
Any other result is returned unchanged without initialization. The retained
result and follow-up initializer use the compiled after-call trampoline,
existing call-depth limit, resumable instruction slices, and reachable heap.
Cooperative chains may terminate at `object.__init__`. `super()`, `super(type)`,
and `super(type, instance-or-subclass)` are available; a bound proxy continues
after `type` in the receiver C3 MRO and reuses ordinary managed descriptor
binding. `object`, `isinstance`, and `issubclass` use that same C3 membership.
Class and instance namespaces share the default 4,096-entry collection ceiling
and reachable heap accounting. Each MRO includes at most 64 classes, counting
the class itself and root `object`. Classes expose `__name__`, `__base__`, and
stable read-only `__bases__`/`__mro__` tuples, while instances expose
`__class__`. Super proxies expose stable read-only `__thisclass__`, `__self__`,
and `__self_class__`. Each class-body value with inherited `__set_name__` is
notified in namespace order before the class is published.

Function and class decorators accept bounded `assignment_expression` forms.
Their expressions run in the containing scope from top to bottom before function
defaults or class bases/suite execution. The resulting callables are applied
from bottom to top through the same CS486 call/return path, and only the final
result is bound to the definition name. Expression or application failure
preserves an earlier binding. One definition admits at most 4,096 decorators.
This same decorator path powers intrinsic `property`, `staticmethod`, and
`classmethod`.

Built-in strings, lists, tuples, dictionaries, sets, and iterator objects now
share one cursor protocol. `iter(iterator)` preserves object identity and
current position. `next(iterator)` advances once and raises catchable
`StopIteration` at stable exhaustion; the optional default form returns that
value instead. `for`, unpacking, starred displays, iterable call expansion,
slice replacement, and `set()` consume the same current position. Built-in
advancement is O(1), while whole consumption is O(remaining values) under the
source and managed-memory limits. User-defined `__iter__` and `__next__` use
class and inherited special lookup, ignore instance-only attributes, and run
through the same bounded Python call path. `__iter__` may return a built-in
cursor, generator, self-iterator, or separate class-backed iterator. When the
class path has no `__iter__`, an inherited `__getitem__` supplies the legacy
sequence protocol: each independent retained cursor requests integer indexes
from zero and advances only after a successful result. `IndexError` or an
escaping `StopIteration` makes it stably exhausted; another fault propagates
without changing its position. Any class-level `__iter__`, including explicit
`None`, takes precedence and disables this fallback. The source and index remain
reachable, and every item request is an ordinary bounded managed CS486 call.
`iter`, `next`, `for`, unpacking, starred displays, iterable call expansion,
slice replacement, `set()`, synchronous comprehensions, generator expressions,
and `yield from` share this protocol. Materializing consumers resume each user
iterator or generator step through ordinary bounded CS486 calls. Calls, target
stores, slice mutation, and result publication wait until iteration and all
applicable arity/capacity checks succeed. The current iterator, accumulated
values, pending operands/arguments/targets, and original physical return slot
remain in one reachable continuation. `StopIteration` ends traversal, the
optional `next` default is returned exactly, and `yield from` receives the
exception's `value`; other faults retain their identity.
`iter(callable, sentinel)` evaluates both operands once and invokes the callable
without arguments through the ordinary bounded CS486 call path. It supports
managed functions and lambdas, bound methods, classes, native functions and
waits, and filesystem-loaded CS486 extension exports. A result equal under the
current CS Profile `==` semantics is consumed as the sentinel and makes
exhaustion stable. A callable-raised `StopIteration` does the same; another
fault propagates and leaves the iterator live. The callable, sentinel, and
exhaustion state remain reachable inside one accounted class-backed iterator, so
all existing lazy and materializing consumers share the behavior. Custom
`__call__`, custom `__eq__`, and async iteration remain deferred.

A directly containing `def` or `lambda` with `yield` now creates a lazy
generator function. Calling it validates and binds arguments without executing
the body. `next()`, `for`, and `send(None)` resume the same compiled CS486
control flow and make a suspended yield expression evaluate to `None`;
`send(value)` makes it evaluate to that exact managed value. Sending non-`None`
to a created generator raises `TypeError` without consuming it. Locals, closure
cells, the managed value stack, the next target, active exception handlers,
handled exceptions, and pending `finally` continuations survive suspension.
`throw(exception)` injects at the suspended yield; the legacy type/value form is
bounded to an optional `None` traceback. `close()` injects `GeneratorExit`, runs
pending finalizers, returns a handled generator return value, rejects a yielded
value with `RuntimeError`, and propagates another fault. `GeneratorExit` derives
from `BaseException`, so `except Exception` does not catch it. An escaping
`StopIteration` becomes `RuntimeError`. Suspended state and stored bound
`send`/`throw`/`close` methods remain reachable through `PythonHeapAccounting`.
`yield from expression` evaluates one iterable once, delegates its values
lazily, and captures a subgenerator return value; built-in exhaustion supplies
`None`, while user-iterator exhaustion supplies the exact `StopIteration.value`.
`send`, `throw`, and `close` forward to generator delegates on the same CS486
call/return path. Built-in iterators expose their missing methods exactly at the
yield-from point. Delegates and their suspended children remain in the same
reachable heap. Synchronous generator expressions reuse the comprehension
implicit scope and generator protocol. Their leftmost iterable expression and
`iter()` run once at construction, while elements, filters, and later iterables
remain lazy. Targets do not leak, contained `:=` stores bind in the containing
scope, and the sole-call-argument form may omit its extra parentheses. Automatic
garbage-collection close and other generator consumers remain deferred.

Synchronous `with` statements accept one or more items, optional assignment
targets, and parenthesized item lists. Each manager expression is evaluated from
left to right; its class-backed `__exit__` is retained before `__enter__` runs,
and successfully entered managers exit from right to left. Target assignment is
inside the protected region. Normal completion, `return`, `break`, and
`continue` pass `None, None, None` and ignore the exit result. A fault passes a
stable exception type, the exact exception value, and the CS Profile traceback
value `None`; a truthy result suppresses it, while a false result reraises the
same value. Exit faults replace the active fault and route through already
entered outer managers. Bound exits survive generator suspension and `close()`
through the existing finalizer state and reachable heap. Admission preflights
the bound receiver plus three explicit exit arguments before entering.
`contextlib`, generator-based context-manager decorators, descriptor or
metaclass customization of special-method lookup, and runtime traceback objects
remain deferred.

`async def`, `await`, `async for`, and `async with` resume through the same
CS486 call/return path without an event loop. An `async def` containing `yield`
creates an unstarted asynchronous generator. Its `__anext__()`, `asend()`,
`athrow()`, and `aclose()` methods return single-use awaitable operations;
normal exhaustion is `StopAsyncIteration`, and close injects `GeneratorExit`
while retaining locals, handlers, finalizers, and operation arguments in the
managed heap. Eager asynchronous comprehensions run in coroutine-owned implicit
scopes, while asynchronous generator expressions remain lazy.

`BaseExceptionGroup` and `ExceptionGroup` construct non-empty nested exception
trees with read-only `message`, `exceptions`, and `args`, plus bounded
`derive()`, `subgroup()`, and `split()`. An `except*` suite recursively splits
the authored tree for each handler in order. Managed Python functions, lambdas,
and bound methods may serve as subgroup predicates through ordinary CS486 calls.
Ordinary exceptions are temporarily wrapped for matching and reraised naked when
unmatched; original reraised subgroups retain their identity, while new handler
faults and unmatched leaves merge deterministically before the existing
`finally` owner runs. Group continuation state remains reachable across
generator and coroutine suspension. Trees admit at most 64 levels and 4,096
nodes. A single `try` may not mix `except` and `except*`; bare `except*` and
`return`, `break`, or `continue` inside an `except*` suite are rejected.
Native/class/extension predicate callables and full runtime traceback objects
remain deferred, so the broader exception feature group remains partial.

Python 3.14 template strings accept `t`/`T` and raw `tr`/`rt` prefixes. They
share replacement-field parsing with formatted strings, including authored
expression text, debug equals, `s`/`r`/`a` conversions, escaped braces, and
eagerly evaluated nested format fields. A template retains values instead of
formatting them. The intrinsic `string.templatelib` module exposes read-only
`Template` and `Interpolation` values, direct constructors, `convert()`,
empty-string-omitting iteration, Template-only concatenation, and the documented
Interpolation pattern surface. Reflection tuples, expression and format text,
iteration, and values remain in the managed heap. One parse admits 256
replacement fields; runtime strings admit 65,536 code units and template
collections 4,096 items. Custom `__format__` dispatch, the complete format
mini-language, and metaclass customization remain deferred.

Inherited class-owned descriptors implement Python's instance precedence: data
descriptor, instance attribute, non-data descriptor, then class value. Managed
`__get__` receives the accessed instance or `None` plus the most-derived
accessed class; managed `__set__` owns an instance write and managed
`__delete__` or a property deleter owns deletion before the attribute map
mutates. Class construction calls inherited `__set_name__` once for each
authored class value in namespace order and publishes the class only after every
call succeeds. Ordinary managed functions remain non-data descriptors, and bound
methods expose read-only `__self__` and `__func__`. Intrinsic `property`,
`staticmethod`, and `classmethod` provide managed getters/setters, replacement
decorators, unchanged static access, and most-derived class binding through the
same CS486 call path. Descriptor continuations, receivers, owners, pending
values, wrappers, and bound methods remain in the managed heap under the
64-entry MRO and 64-call-depth ceilings, 4,096-item namespace ceiling, and outer
instruction slices. Explicit instance reads invoke inherited `__getattribute__`;
only an `AttributeError`, including one from a descriptor getter, proceeds to
inherited `__getattr__`. Explicit writes and deletions invoke inherited
`__setattr__` and `__delattr__`; `object.__getattribute__`,
`object.__setattr__`, and `object.__delattr__` provide bounded base delegation.
The `getattr`, `setattr`, and `delattr` built-ins use the same path, and
`getattr` returns its optional default only after lookup and `__getattr__` both
end in `AttributeError`. Implicit special-method lookup remains class-owned and
bypasses these instance hooks.

`del` supports names in global/local/cell/free scopes, instance/class/namespace
attributes, built-in list and dictionary items, list slices including extended
slices, and nested list/tuple target lists. Targets delete left to right; a
later error preserves earlier deletions and prevents later targets from running.

This phase still does not implement metaclasses, custom generic subscription
hooks, `__slots__`, operator protocols, arbitrary native descriptors,
module-level or metaclass attribute hooks, user-defined `__delitem__`, arbitrary
native/asynchronous descriptor or attribute hooks, or object-lifetime `__del__`.
The tuple form of the `isinstance`/`issubclass` class-info argument is also
deferred. Those remain part of the incomplete data-model group.

Built-in strings, lists, and tuples support one-dimensional slices with omitted,
negative, clipped, and positive/negative-step integer components. Strings slice
by Unicode code point. Lists additionally support ordinary slice replacement,
which may resize the list, and extended-slice replacement, which requires the
replacement length to match. A zero step raises `ValueError`; invalid components
or replacement values raise `TypeError`. Final capacity and extended arity are
validated before the list is mutated, so rejection cannot leave a partial write.
Slice assignment evaluates the RHS before the target object, start, stop, and
step expressions.

Integer literals accept decimal, binary, octal, hexadecimal, and valid
underscore grouping. Values outside the host safe-integer range remain exact,
and arithmetic, floor division/modulo, powers, shifts, and bitwise operations
preserve arbitrary precision. The default magnitude ceiling is 262,144 bits
(minimum configurable ceiling 53); growing powers and left shifts are rejected
before allocation. Reachable integer limb storage counts toward the same managed
heap. Float support still uses a partial IEEE 754 binary64 model and is not yet
a complete Python numeric-tower claim.

This is one verified subset of the larger target. The remaining custom
class/data-model protocols, extended context protocols, complete set API, and
the remaining Python 3.14 surface are still incomplete.

## Targeted Python surface

The end-state includes the Python 3.14 grammar and observable core-language
semantics: lexical analysis, expressions, statements, scopes, functions,
closures, Unicode text, arbitrary-precision integers, exceptions, classes and
the data model, iterators, generators, context managers, packages and relative
imports, bounded `eval` and `exec`, the remaining exception and traceback
details, the remaining pattern-matching data-model protocols, annotation
introspection formats and broader typing semantics, and scheduler-backed
asynchronous libraries.

Built-ins and standard-library modules are tracked independently from the
grammar. Each library module will be classified as `compatible`,
`guest-adapted`, or `unavailable`. A guest-adapted module must document the
observable difference and must not expose the host operating system.

## Deliberate exclusions

The CS profile does not provide `pip`, `ensurepip`, `venv`, PyPI or wheel
installation. It also excludes CPython bytecode and `.pyc` files, CPython JIT
and free-threading/GIL behavior, subinterpreters, the Python C API, and CPython
`.so` or `.pyd` extension modules. Guest programs cannot escape to host
processes, filesystems, networks, or JavaScript.

These exclusions are profile boundaries, not unfinished compatibility claims.
Python packages made entirely from supported `.py` source remain part of the
target, while guest native code is supplied through bounded CS486OBJ modules.

## Claim states

The machine-readable manifest is the source of truth for feature status:

- `planned`: no supported compatibility claim yet.
- `partial`: a bounded subset exists, but the feature group is incomplete.
- `compatible`: the Python 3.14 behavior in the CS profile has conformance
  evidence.
- `guest-adapted`: used by the future standard-library manifest for a deliberate
  CS guest-environment adaptation.
- `unavailable`: used by the future standard-library manifest for a module the
  profile does not expose.

Until the full gate passes, public documentation must say “targeting Python 3.14
syntax and core semantics,” not “Python 3.14 compatible.”

## Verification contract

Verify: `npm run test:python314`.

Expect: the manifest schema, target, hardware gate, import roots, exclusions,
feature inventory, and documentation terminology agree, and the current Python
compiler/runtime regression suite passes.

Verify: `npm run validate`.

Expect: formatting, lint, TypeScript, every host test, the production Bedrock
pack build, and the 16-chapter Pages build pass before a phase is handed off.

The final compatibility claim additionally requires real Bedrock Dedicated
Server execution and a real-browser review of the published manual.

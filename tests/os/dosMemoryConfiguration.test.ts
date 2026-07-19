import { describe, expect, it } from "vitest";

import {
  dosMemoryConfigurationLimits,
  planDosMemoryConfiguration,
  type DosConfigurationDriverResolution,
  type DosConfigurationDriverResolutionRequest,
  type DosConfigurationDriverResolver,
} from "../../src/application/os/dosMemoryConfiguration.js";

interface ResolverFixture {
  readonly requests: DosConfigurationDriverResolutionRequest[];
  readonly resolver: DosConfigurationDriverResolver;
}

function resolvedDriver(
  kind: "emm386" | "himem" | "resident",
  canonicalPath: string,
  moduleId: string,
  displayName: string,
  residentBytes: number,
): DosConfigurationDriverResolution {
  return {
    canonicalPath,
    displayName,
    kind,
    moduleId,
    residentBytes,
    status: "resolved",
  };
}

function resolverFixture(
  entries: Readonly<Record<string, DosConfigurationDriverResolution>>,
): ResolverFixture {
  const requests: DosConfigurationDriverResolutionRequest[] = [];
  return {
    requests,
    resolver: {
      resolve(request): DosConfigurationDriverResolution {
        requests.push(request);
        return (
          entries[request.path] ??
          entries["C:\\DOS\\" + request.path] ?? {
            reason: "missing",
            status: "rejected",
          }
        );
      },
    },
  };
}

function standardResolver(): ResolverFixture {
  return resolverFixture({
    "C:\\DOS\\ANSI.SYS": resolvedDriver(
      "resident",
      "C:\\DOS\\ANSI.SYS",
      "ansi",
      "ANSI.SYS",
      4 * 1_024,
    ),
    "C:\\DOS\\EMM386.EXE": resolvedDriver(
      "emm386",
      "C:\\DOS\\EMM386.EXE",
      "emm386",
      "EMM386.EXE",
      8 * 1_024,
    ),
    "C:\\DOS\\HIMEM.SYS": resolvedDriver(
      "himem",
      "C:\\DOS\\HIMEM.SYS",
      "himem",
      "HIMEM.SYS",
      8 * 1_024,
    ),
    "C:\\DOS\\MOUSE.SYS": resolvedDriver(
      "resident",
      "C:\\DOS\\MOUSE.SYS",
      "mouse",
      "MOUSE.SYS",
      6 * 1_024,
    ),
  });
}

describe("CS-DOS memory configuration planner", (): void => {
  it("plans ordered CONFIG.SYS directives without resolving placement", (): void => {
    const fixture = standardResolver();
    const result = planDosMemoryConfiguration(
      [
        "FILES=40",
        "BUFFERS = 30",
        "DEVICE=C:/DOS/HIMEM.SYS",
        "DEVICE=C:\\DOS\\EMM386.EXE noems",
        "DOS=HIGH,UMB",
        "DEVICEHIGH=C:\\DOS\\ANSI.SYS /Q",
        "DEVICE=C:\\DOS\\MOUSE.SYS",
      ].join("\r\n"),
      fixture.resolver,
    );

    expect(result.committable).toBe(true);
    if (!result.committable) throw new Error("expected a committable plan");
    expect(result.diagnostics).toEqual([]);
    expect(result.plan.files).toBe(40);
    expect(result.plan.buffers).toBe(30);
    expect(result.plan.dos).toEqual({
      kernelDirectiveLine: 5,
      requestedKernelPlacement: "high",
      upperMemory: "enabled",
      upperMemoryDirectiveLine: 5,
    });
    expect(result.plan.drivers).toEqual([
      {
        arguments: [],
        canonicalPath: "C:\\DOS\\HIMEM.SYS",
        directive: "device",
        displayName: "HIMEM.SYS",
        kind: "himem",
        lineNumber: 3,
        moduleId: "himem",
        placement: {
          actualPlacement: null,
          allocationOrder: ["conventional"],
          requestedPlacement: "conventional",
        },
        residentBytes: 8 * 1_024,
        sourcePath: "C:\\DOS\\HIMEM.SYS",
      },
      {
        arguments: ["NOEMS"],
        canonicalPath: "C:\\DOS\\EMM386.EXE",
        directive: "device",
        displayName: "EMM386.EXE",
        kind: "emm386",
        lineNumber: 4,
        moduleId: "emm386",
        placement: {
          actualPlacement: null,
          allocationOrder: ["conventional"],
          requestedPlacement: "conventional",
        },
        residentBytes: 8 * 1_024,
        sourcePath: "C:\\DOS\\EMM386.EXE",
      },
      {
        arguments: ["/Q"],
        canonicalPath: "C:\\DOS\\ANSI.SYS",
        directive: "devicehigh",
        displayName: "ANSI.SYS",
        kind: "resident",
        lineNumber: 6,
        moduleId: "ansi",
        placement: {
          actualPlacement: null,
          allocationOrder: ["upper", "conventional"],
          requestedPlacement: "upper",
        },
        residentBytes: 4 * 1_024,
        sourcePath: "C:\\DOS\\ANSI.SYS",
      },
      {
        arguments: [],
        canonicalPath: "C:\\DOS\\MOUSE.SYS",
        directive: "device",
        displayName: "MOUSE.SYS",
        kind: "resident",
        lineNumber: 7,
        moduleId: "mouse",
        placement: {
          actualPlacement: null,
          allocationOrder: ["conventional"],
          requestedPlacement: "conventional",
        },
        residentBytes: 6 * 1_024,
        sourcePath: "C:\\DOS\\MOUSE.SYS",
      },
    ]);
    expect(fixture.requests).toHaveLength(4);
    expect(fixture.requests.every((request) => Object.isFrozen(request))).toBe(
      true,
    );
  });

  it("rejects order-dependent directives before invoking the resolver", (): void => {
    const fixture = standardResolver();
    const result = planDosMemoryConfiguration(
      [
        "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
        "DOS=HIGH",
        "DOS=UMB",
        "DEVICEHIGH=C:\\DOS\\ANSI.SYS",
      ].join("\n"),
      fixture.resolver,
    );

    expect(result).toMatchObject({ committable: false, plan: null });
    expect(
      result.diagnostics.map(({ code, lineNumber }) => ({ code, lineNumber })),
    ).toEqual([
      { code: "dependency-order", lineNumber: 1 },
      { code: "dependency-order", lineNumber: 2 },
      { code: "dependency-order", lineNumber: 3 },
      { code: "dependency-order", lineNumber: 4 },
    ]);
    expect(fixture.requests).toEqual([]);
  });

  it("collects conflicts without exposing a partially valid plan", (): void => {
    const fixture = standardResolver();
    const result = planDosMemoryConfiguration(
      [
        "DEVICE=C:\\DOS\\HIMEM.SYS",
        "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
        "DOS=HIGH,UMB",
        "DOS=LOW",
        "DOS=NOUMB",
        "FILES=20",
        "FILES=30",
        "BUFFERS=10",
        "BUFFERS=11",
      ].join("\n"),
      fixture.resolver,
    );

    expect(result.committable).toBe(false);
    expect(result.plan).toBeNull();
    expect(
      result.diagnostics.map(({ code, lineNumber }) => ({ code, lineNumber })),
    ).toEqual([
      { code: "conflicting-directive", lineNumber: 4 },
      { code: "conflicting-directive", lineNumber: 5 },
      { code: "conflicting-directive", lineNumber: 7 },
      { code: "conflicting-directive", lineNumber: 9 },
    ]);
  });

  it("rejects conflicting, duplicate, and unsupported DOS tokens", (): void => {
    const result = planDosMemoryConfiguration(
      ["DOS=HIGH,LOW", "DOS=UMB,NOUMB", "DOS=LOW,LOW", "DOS=LOW,PAGING"].join(
        "\n",
      ),
      standardResolver().resolver,
    );

    expect(result.committable).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "conflicting-dos-tokens",
      "conflicting-dos-tokens",
      "duplicate-dos-token",
      "unsupported-dos-token",
    ]);
  });

  it("rejects unsupported driver modes, missing capsules, and unknown directives", (): void => {
    const fixture = resolverFixture({
      "C:\\DOS\\MISSING.SYS": { reason: "missing", status: "rejected" },
    });
    const result = planDosMemoryConfiguration(
      [
        "DEVICE=C:\\DOS\\HIMEM.SYS /TEST",
        "DEVICE=C:\\DOS\\EMM386.EXE",
        "DEVICE=C:\\DOS\\EMM386.EXE RAM",
        "DEVICE=C:\\DOS\\MISSING.SYS",
        "DEVICEHIGH=",
        "SHELL=C:\\4DOS.COM",
        "FILES=0",
        "BUFFERS=100",
      ].join("\n"),
      fixture.resolver,
    );

    expect(result.committable).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "driver-arguments-invalid",
      "driver-arguments-invalid",
      "driver-arguments-invalid",
      "driver-not-resolved",
      "driver-arguments-invalid",
      "unsupported-directive",
      "numeric-value-invalid",
      "numeric-value-invalid",
    ]);
    expect(fixture.requests.map(({ path }) => path)).toEqual([
      "C:\\DOS\\MISSING.SYS",
    ]);
  });

  it("contains resolver failures and rejects invalid capsule metadata", (): void => {
    const resolver: DosConfigurationDriverResolver = {
      resolve(request): DosConfigurationDriverResolution {
        if (request.path.endsWith("THROW.SYS")) throw new Error("host detail");
        return {
          canonicalPath: request.path,
          displayName: "INVALID.SYS",
          kind: request.expectedKind,
          moduleId: "INVALID MODULE ID",
          residentBytes: 0,
          status: "resolved",
        };
      },
    };
    const result = planDosMemoryConfiguration(
      ["DEVICE=THROW.SYS", "DEVICE=INVALID.SYS"].join("\n"),
      resolver,
    );

    expect(result.committable).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "driver-resolution-failed",
      "driver-resolution-invalid",
    ]);
    expect(result.diagnostics[0]?.message).not.toContain("host detail");
  });

  it("rejects duplicate resolved modules", (): void => {
    const resolution = resolvedDriver(
      "resident",
      "C:\\DOS\\SHARED.SYS",
      "shared",
      "SHARED.SYS",
      1_024,
    );
    const fixture = resolverFixture({
      "C:\\DOS\\ONE.SYS": resolution,
      "C:\\DOS\\TWO.SYS": resolution,
    });
    const result = planDosMemoryConfiguration(
      ["DEVICE=ONE.SYS", "DEVICE=TWO.SYS"].join("\n"),
      fixture.resolver,
    );

    expect(result.committable).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.diagnostics).toMatchObject([
      { code: "driver-duplicate", lineNumber: 2 },
    ]);
  });

  it("accepts exactly 64 physical lines and rejects the 65th before resolution", (): void => {
    const fixture = standardResolver();
    const atLimit = Array.from(
      { length: dosMemoryConfigurationLimits.lines },
      (_, index) => `; line ${String(index + 1)}`,
    ).join("\r\n");
    const overLimit = `${atLimit}\r\nDEVICE=C:\\DOS\\HIMEM.SYS`;

    expect(
      planDosMemoryConfiguration(`${atLimit}\r\n`, fixture.resolver),
    ).toMatchObject({ committable: true });
    const rejected = planDosMemoryConfiguration(overLimit, fixture.resolver);
    expect(rejected).toMatchObject({ committable: false, plan: null });
    expect(rejected.diagnostics).toMatchObject([
      { code: "line-limit-exceeded", lineNumber: 65 },
    ]);
    expect(fixture.requests).toEqual([]);
  });

  it("bounds driver resolution, line size, source size, and diagnostics", (): void => {
    const requests: DosConfigurationDriverResolutionRequest[] = [];
    const resolver: DosConfigurationDriverResolver = {
      resolve(request): DosConfigurationDriverResolution {
        requests.push(request);
        return resolvedDriver(
          "resident",
          request.path,
          `driver-${String(request.lineNumber)}`,
          `DRIVER${String(request.lineNumber)}.SYS`,
          1_024,
        );
      },
    };
    const drivers = Array.from(
      { length: dosMemoryConfigurationLimits.driverLoads + 1 },
      (_, index) => `DEVICE=DRIVER${String(index + 1)}.SYS`,
    ).join("\n");
    const driverResult = planDosMemoryConfiguration(drivers, resolver);
    expect(driverResult).toMatchObject({ committable: false, plan: null });
    expect(driverResult.diagnostics).toMatchObject([
      {
        code: "driver-limit-exceeded",
        lineNumber: dosMemoryConfigurationLimits.driverLoads + 1,
      },
    ]);
    expect(requests).toHaveLength(dosMemoryConfigurationLimits.driverLoads);

    const longLine = planDosMemoryConfiguration(
      ";".padEnd(dosMemoryConfigurationLimits.lineCharacters + 1, "x"),
      resolver,
    );
    expect(longLine.diagnostics).toMatchObject([{ code: "line-too-long" }]);

    const longSource = planDosMemoryConfiguration(
      "x".repeat(dosMemoryConfigurationLimits.sourceCharacters + 1),
      resolver,
    );
    expect(longSource.diagnostics).toMatchObject([
      { code: "source-limit-exceeded", lineNumber: 0 },
    ]);

    const invalidLines = Array.from(
      { length: dosMemoryConfigurationLimits.lines },
      (_, index) => `UNKNOWN${String(index)}=1`,
    ).join("\n");
    const diagnosticsResult = planDosMemoryConfiguration(
      invalidLines,
      resolver,
    );
    expect(diagnosticsResult.diagnostics).toHaveLength(
      dosMemoryConfigurationLimits.diagnostics,
    );
  });

  it("is idempotent and returns deeply frozen plans and diagnostics", (): void => {
    const source = [
      "FILES=40",
      "FILES=40",
      "BUFFERS=30",
      "DEVICE=C:\\DOS\\HIMEM.SYS",
      "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
      "DOS=HIGH",
      "DOS=UMB",
      "DEVICEHIGH=C:\\DOS\\ANSI.SYS",
    ].join("\n");

    const first = planDosMemoryConfiguration(
      source,
      standardResolver().resolver,
    );
    const second = planDosMemoryConfiguration(
      source,
      standardResolver().resolver,
    );
    expect(first).toEqual(second);
    expect(first.committable).toBe(true);
    if (!first.committable) throw new Error("expected a committable plan");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.plan)).toBe(true);
    expect(Object.isFrozen(first.plan.dos)).toBe(true);
    expect(Object.isFrozen(first.plan.drivers)).toBe(true);
    expect(Object.isFrozen(first.plan.drivers[2])).toBe(true);
    expect(Object.isFrozen(first.plan.drivers[2]?.arguments)).toBe(true);
    expect(Object.isFrozen(first.plan.drivers[2]?.placement)).toBe(true);
    expect(
      Object.isFrozen(first.plan.drivers[2]?.placement.allocationOrder),
    ).toBe(true);

    const failed = planDosMemoryConfiguration(
      "DOS=HIGH,LOW",
      standardResolver().resolver,
    );
    expect(Object.isFrozen(failed)).toBe(true);
    expect(Object.isFrozen(failed.diagnostics)).toBe(true);
    expect(Object.isFrozen(failed.diagnostics[0])).toBe(true);
  });
});

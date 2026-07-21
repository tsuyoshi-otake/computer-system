import { beforeAll, describe, expect, it } from "vitest";

import { linuxFilesystemImage } from "../../src/application/os/osFilesystemImages.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
  type Cs486DataModel,
} from "../../src/domain/cpu/cs486Compatibility.js";
import type { Cs486Object } from "../../src/domain/cpu/cs486Object.js";

describe("guest deterministic math.h and libm", () => {
  const files = new Map<string, string>();

  beforeAll(() => {
    for (const file of linuxFilesystemImage.files)
      files.set(file.path, file.contents);
  });

  it.each([cs486Word32DataModel, cs486Byte8DataModel])(
    "compiles twice and runs bounded libm vectors in %s",
    (dataModel) => {
      const libm = compileImageSource("/usr/src/cs-libm/libm.c", dataModel);
      expect(compileImageSource("/usr/src/cs-libm/libm.c", dataModel)).toEqual(
        libm,
      );
      const application = compileApplication(
        [
          "#include <float.h>",
          "#include <math.h>",
          "#include <errno.h>",
          "int errno = 0;",
          "int main(void){",
          "  int exponent = 0; double integer = 0.0; float integerf = 0.0f;",
          "  if(FLT_RADIX != 2 || FLT_MANT_DIG != 24 || DBL_MANT_DIG != 53) return 1;",
          "  if(sqrt(9.0) != 3.0 || sqrtf(2.25f) != 1.5f) return 2;",
          "  if(floor(-2.25) != -3.0 || ceil(-2.25) != -2.0) return 3;",
          "  if(trunc(-2.75) != -2.0 || round(-2.5) != -3.0) return 4;",
          "  if(fabs(-3.5) != 3.5 || copysign(2.0, -1.0) != -2.0) return 5;",
          "  if(fmod(5.5, 2.0) != 1.5 || ldexp(1.5, 3) != 12.0) return 6;",
          "  if(frexp(12.0, &exponent) != 0.75 || exponent != 4) return 7;",
          "  if(modf(-3.25, &integer) != -0.25 || integer != -3.0) return 8;",
          "  if(modff(3.75f, &integerf) != 0.75f || integerf != 3.0f) return 9;",
          "  if(!isfinite(1.0) || isinf(1.0) || isnan(1.0) || !signbit(-0.0)) return 10;",
          "  exponent = 99; double negative_zero = frexp(-0.0, &exponent);",
          "  if(!signbit(negative_zero) || exponent != 0 || !signbit(sqrt(-0.0))) return 13;",
          "  double infinite_integer = 0.0; double infinite_fraction = modf(HUGE_VAL, &infinite_integer);",
          "  if(!isinf(infinite_integer) || infinite_fraction != 0.0 || signbit(infinite_fraction)) return 14;",
          "  if(!isnan(copysign(NAN, -1.0)) || !signbit(copysign(NAN, -1.0))) return 15;",
          "  if(fabsf(-INFINITY) != INFINITY || floorf(-0.0f) != -0.0f || !signbit(floorf(-0.0f))) return 16;",
          "  errno = 0; double invalid = sqrt(-1.0);",
          "  if(!isnan(invalid) || errno != EDOM) return 11;",
          "  errno = 0; invalid = fmod(HUGE_VAL, 2.0);",
          "  if(!isnan(invalid) || errno != EDOM) return 17;",
          "  errno = 0; double overflow = ldexp(DBL_MAX, 1);",
          "  if(!isinf(overflow) || errno != ERANGE) return 12;",
          "  return 42;",
          "}",
        ].join("\n"),
        dataModel,
      );
      expect(runObjects([application, libm]).registers.eax).toBe(42);
    },
  );

  it.each([cs486Word32DataModel, cs486Byte8DataModel])(
    "default-promotes float varargs and renders bounded %%f in %s",
    (dataModel) => {
      const libc = compileImageSource("/usr/src/cs-libc/libc.c", dataModel);
      const application = compileApplication(
        [
          "#include <errno.h>",
          "#include <stdio.h>",
          "#include <string.h>",
          "int main(void){",
          "  char buffer[64];",
          '  int length = snprintf(buffer, 64, "%.3f|%08.2f|%-6.1f", 1.25f, -2.5, 3.0f);',
          '  if(length != 21 || strcmp(buffer, "1.250|-0002.50|3.0   ") != 0) return 1;',
          "  errno = 0;",
          '  if(snprintf(buffer, 64, "%.19f", 1.0) != -1 || errno != EINVAL) return 2;',
          "  return 42;",
          "}",
        ].join("\n"),
        dataModel,
      );

      expect(runObjects([application, libc]).registers.eax).toBe(42);
    },
  );

  it("fails explicitly for transcendental APIs outside the first libm profile", () => {
    expect(() =>
      compileApplication(
        "#include <math.h>\nint main(void){return (int)sin(0.0);}",
        cs486Word32DataModel,
      ),
    ).toThrow(/sin/u);
  });

  function compileImageSource(
    path: string,
    dataModel: Cs486DataModel,
  ): Cs486Object {
    return compileCs486Object("c", files.get(path)!, {
      dataModel,
      include,
      sourceName: path,
    });
  }

  function compileApplication(
    source: string,
    dataModel: Cs486DataModel,
  ): Cs486Object {
    return compileCs486Object("c", source, {
      dataModel,
      include,
      sourceName: "/tmp/libm-test.c",
    });
  }

  function include(request: {
    readonly path: string;
  }): { readonly source: string; readonly sourceName: string } | undefined {
    const sourceName = `/usr/include/${request.path}`;
    const source = files.get(sourceName);
    return source === undefined ? undefined : { source, sourceName };
  }
});

function runObjects(
  objects: readonly Cs486Object[],
): ReturnType<typeof runCs486> {
  const executable = linkCs486Objects(objects, { entry: "main" });
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared")
    throw new Error("libm linker produced a legacy executable");
  return runCs486(executable, {
    memoryBytes: requirements.linearAddressSpaceBytes,
  });
}

import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("CS-Linux floating C portability workload", (): void => {
  it.each([
    { computerId: "c-007301", id: "word", option: "" },
    { computerId: "c-007302", id: "byte", option: "-mbyte8 " },
  ])(
    "builds a deterministic mixed numeric CLI and geometry archive in $id mode",
    ({ computerId, option }): void => {
      const record = new ComputerRecord(computerId, "advanced");
      const shell = new ShellSession(record.filesystem, { osProfile: "linux" });
      record.filesystem.makeDirectory("/work");
      record.filesystem.writeFile(
        "/work/geometry.h",
        [
          "struct point { double x; double y; };",
          "typedef double (*point_metric)(struct point *value);",
          "double point_length(struct point *value);",
          "double sum_metrics(struct point *values, int count, point_metric metric);",
        ].join("\n"),
      );
      record.filesystem.writeFile(
        "/work/geometry.c",
        [
          '#include "geometry.h"',
          "#include <math.h>",
          "double point_length(struct point *value){",
          "  return sqrt(value->x * value->x + value->y * value->y);",
          "}",
          "double sum_metrics(struct point *values, int count, point_metric metric){",
          "  if(values == (struct point *)0 || metric == (point_metric)0 || count < 0 || count > 16) return NAN;",
          "  double total = 0.0; int index = 0;",
          "  while(index < count){total = total + metric(&values[index]); index = index + 1;}",
          "  return total;",
          "}",
        ].join("\n"),
      );
      record.filesystem.writeFile(
        "/work/main.c",
        [
          '#include "geometry.h"',
          "#include <stdio.h>",
          "int main(void){",
          "  struct point points[3] = {{3.0, 4.0}, {5.0, 12.0}, {8.0, 15.0}};",
          "  double total = sum_metrics(points, 3, point_length);",
          '  int written = printf("total=%.3f count=%d\\n", total, 3);',
          "  return total == 35.0 && written == 21 ? 0 : 1;",
          "}",
        ].join("\n"),
      );

      expect(
        shell.submit(
          `cc ${option}-I/work -c /work/geometry.c -o /work/geometry.o`,
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      const firstObject = record.filesystem.readFile("/work/geometry.o");
      expect(
        shell.submit(
          `cc ${option}-I/work -c /work/geometry.c -o /work/geometry.o`,
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      expect(record.filesystem.readFile("/work/geometry.o")).toBe(firstObject);
      expect(
        shell.submit("ar rcs /work/libgeometry.csa /work/geometry.o"),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      const firstArchive = record.filesystem.readFile("/work/libgeometry.csa");
      expect(
        shell.submit("ar rcs /work/libgeometry.csa /work/geometry.o"),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      expect(record.filesystem.readFile("/work/libgeometry.csa")).toBe(
        firstArchive,
      );
      expect(
        shell.submit(
          `cc ${option}-I/work /work/main.c /work/libgeometry.csa -lm -o /work/geometry`,
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });

      const result = shell.submit("run --stats /work/geometry");

      expect(result).toMatchObject({
        exitCode: 0,
        stdout: "total=35.000 count=3\n",
      });
      expect(result.stderr).toMatch(/CPU cycles/u);
      expect(result.stderr).toMatch(/memory: L1/u);
    },
  );
});

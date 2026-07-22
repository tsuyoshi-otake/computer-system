import type { Cs486Executable } from "../../domain/cpu/cs486.js";
import { hostedCLibcFiles } from "../os/hostedCLibcImage.js";
import type { Cs486CFrontendOptions } from "./cs486CFrontend.js";
import type {
  Cs486CPreprocessorInclude,
  Cs486CPreprocessorIncludeRequest,
} from "./cs486CPreprocessor.js";
import { linkCs486Objects } from "./cs486Linker.js";
import { guestNethackSourceFiles } from "./guestNethack.js";
import { compileCs486Object } from "./highLevelCompilers.js";

const moduleNames = Object.freeze([
  "main",
  "world",
  "monsters",
  "items",
  "player",
  "display",
  "input",
  "save",
  "rng",
]);

/**
 * Host-build owner for the immutable NetHack executable.
 *
 * Production Behavior Pack code consumes only the checked-in generated payload
 * and must never call this compiler/linker path during Script API module load.
 */
export function buildGuestNethackExecutable(): Cs486Executable {
  const includes = new Map<string, string>();
  for (const file of hostedCLibcFiles) {
    if (file.path.startsWith("/usr/include/"))
      includes.set(file.path.slice("/usr/include/".length), file.contents);
  }
  includes.set("nethack.h", guestNethackSourceFiles.get("nethack.h")!);
  const options = (sourceName: string): Cs486CFrontendOptions => ({
    include: (
      request: Cs486CPreprocessorIncludeRequest,
    ): Cs486CPreprocessorInclude | undefined => {
      const source = includes.get(request.path);
      return source === undefined
        ? undefined
        : {
            source,
            sourceName:
              request.path === "nethack.h"
                ? "/usr/src/nethack/nethack.h"
                : `/usr/include/${request.path}`,
          };
    },
    sourceName,
  });
  const objects = moduleNames.map((name) =>
    compileCs486Object(
      "c",
      guestNethackSourceFiles.get(`${name}.c`)!,
      options(`/usr/src/nethack/${name}.c`),
    ),
  );
  const libcSource = hostedCLibcFiles.find(
    ({ path }) => path === "/usr/src/cs-libc/libc.c",
  )?.contents;
  if (libcSource === undefined)
    throw new Error("CS libc source is unavailable");
  objects.push(
    compileCs486Object("c", libcSource, options("/usr/src/cs-libc/libc.c")),
  );
  return linkCs486Objects(objects, { entry: "main" });
}

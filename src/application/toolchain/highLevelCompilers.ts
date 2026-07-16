import { assembleCs486Object } from "./cs486Assembler.js";
import type { Cs486Executable } from "../../domain/cpu/cs486.js";
import type { Cs486Object } from "../../domain/cpu/cs486Object.js";
import { linkCs486Objects } from "./cs486Linker.js";
import {
  compileCs486CFrontend,
  type Cs486CFrontendOptions,
} from "./cs486CFrontend.js";
import { compileQBasicAssembly } from "./qbasicCompiler.js";

export type Cs486SourceLanguage = "basic" | "c" | "cpp";

export function compileCs486Source(
  language: Cs486SourceLanguage,
  source: string,
  options: Cs486CFrontendOptions = {},
): Cs486Executable {
  return linkCs486Objects([compileCs486Object(language, source, options)], {
    entry: language === "basic" ? "basic_main" : "main",
  });
}

export function compileCs486Object(
  language: Cs486SourceLanguage,
  source: string,
  options: Cs486CFrontendOptions = {},
): Cs486Object {
  if (language !== "basic") {
    const compiled = compileCs486CFrontend(language, source, options);
    return assembleCs486Object(compiled.assembly, {
      dataBytes: compiled.dataBytes,
      language,
    });
  }
  const compiled = compileQBasicAssembly(source);
  return assembleCs486Object(compiled.assembly, {
    dataBytes: compiled.dataBytes,
    language,
  });
}

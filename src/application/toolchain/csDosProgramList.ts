import { sha256Hex } from "../os/passwordHash.js";

export type CsDosProgramSourceLanguage = "asm" | "c" | "cpp";

export interface CsDosProgramSource {
  readonly language: CsDosProgramSourceLanguage;
  readonly path: string;
}

export interface CsDosProgramList {
  readonly definitions: readonly {
    readonly name: string;
    readonly replacement?: string;
  }[];
  readonly entry: string;
  readonly includePaths: readonly string[];
  readonly listingPath?: string;
  readonly mapPath?: string;
  readonly objectPaths: readonly string[];
  readonly outputPath: string;
  readonly sources: readonly CsDosProgramSource[];
  readonly undefines: readonly string[];
}

export interface CsDosProgramFingerprintInput {
  readonly contents: string;
  readonly path: string;
}

const maximumProgramCharacters = 32_768;
const maximumProgramLines = 256;
const maximumSources = 64;
const maximumObjects = 64;
const maximumIncludePaths = 16;
const maximumDefinitions = 128;
const maximumPathCharacters = 128;
const maximumDefinitionCharacters = 256;

export function parseCsDosProgramList(source: string): CsDosProgramList {
  if (source.length > maximumProgramCharacters) {
    throw new Error("Program List source limit exceeded");
  }
  const lines = source
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  if (lines.length > maximumProgramLines) {
    throw new Error("Program List line limit exceeded");
  }
  const significant = lines
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(
      ({ text }) =>
        text.length > 0 && !text.startsWith(";") && !text.startsWith("#"),
    );
  if (significant.shift()?.text !== "CS PROGRAM LIST 1.0") {
    throw new Error("Program List must begin with CS PROGRAM LIST 1.0");
  }

  const sources: CsDosProgramSource[] = [];
  const objectPaths: string[] = [];
  const includePaths: string[] = [];
  const definitions: {
    readonly name: string;
    readonly replacement?: string;
  }[] = [];
  const undefines: string[] = [];
  let entry = "main";
  let entrySeen = false;
  let outputPath: string | undefined;
  let listingPath: string | undefined;
  let mapPath: string | undefined;
  const inputIdentities = new Set<string>();
  const generatedBasenames = new Set<string>();
  const generatedObjectIdentities = new Set<string>();

  for (const item of significant) {
    const equals = item.text.indexOf("=");
    if (equals <= 0) {
      throw new Error(
        `Program List line ${String(item.line)} requires KEY=VALUE`,
      );
    }
    const key = item.text.slice(0, equals).trim().toUpperCase();
    const value = item.text.slice(equals + 1).trim();
    if (key === "SOURCE") {
      assertPath(value, item.line);
      if (sources.length >= maximumSources) {
        throw new Error("Program List source count limit exceeded");
      }
      const language = sourceLanguage(value, item.line);
      const identity = dosIdentity(value);
      if (inputIdentities.has(identity)) {
        throw new Error(`duplicate Program List input ${value}`);
      }
      inputIdentities.add(identity);
      const basename = dosBasenameWithoutExtension(value);
      if (generatedBasenames.has(basename)) {
        throw new Error(`same-basename OBJ collision for ${value}`);
      }
      generatedBasenames.add(basename);
      const objectIdentity = dosIdentity(replaceDosExtension(value, ".OBJ"));
      if (inputIdentities.has(objectIdentity)) {
        throw new Error(
          `generated OBJ collides with authored input for ${value}`,
        );
      }
      generatedObjectIdentities.add(objectIdentity);
      sources.push({ language, path: value });
      continue;
    }
    if (key === "OBJECT") {
      assertPath(value, item.line);
      if (!/\.OBJ$/iu.test(value)) {
        throw new Error(
          `Program List line ${String(item.line)} OBJECT must end in .OBJ`,
        );
      }
      if (objectPaths.length >= maximumObjects) {
        throw new Error("Program List object count limit exceeded");
      }
      const identity = dosIdentity(value);
      if (inputIdentities.has(identity)) {
        throw new Error(`duplicate Program List input ${value}`);
      }
      if (generatedObjectIdentities.has(identity)) {
        throw new Error(`OBJECT collides with a generated OBJ: ${value}`);
      }
      inputIdentities.add(identity);
      objectPaths.push(value);
      continue;
    }
    if (key === "INCLUDE") {
      assertPath(value, item.line);
      if (includePaths.length >= maximumIncludePaths) {
        throw new Error("Program List include path count limit exceeded");
      }
      if (
        includePaths.some((path) => dosIdentity(path) === dosIdentity(value))
      ) {
        throw new Error(`duplicate Program List include path ${value}`);
      }
      includePaths.push(value);
      continue;
    }
    if (key === "DEFINE") {
      if (definitions.length >= maximumDefinitions) {
        throw new Error("Program List definition count limit exceeded");
      }
      if (value.length > maximumDefinitionCharacters) {
        throw new Error("Program List definition length limit exceeded");
      }
      const definition = parseDefinition(value, item.line);
      if (definitions.some(({ name }) => name === definition.name)) {
        throw new Error(`duplicate Program List definition ${definition.name}`);
      }
      definitions.push(definition);
      continue;
    }
    if (key === "UNDEF") {
      if (undefines.length >= maximumDefinitions) {
        throw new Error("Program List undefine count limit exceeded");
      }
      assertIdentifier(value, item.line, "UNDEF");
      if (undefines.includes(value)) {
        throw new Error(`duplicate Program List undefine ${value}`);
      }
      undefines.push(value);
      continue;
    }
    if (key === "ENTRY") {
      if (entrySeen) throw new Error("duplicate Program List ENTRY");
      assertIdentifier(value, item.line, "ENTRY");
      entry = value;
      entrySeen = true;
      continue;
    }
    if (key === "OUTPUT" || key === "LISTING" || key === "MAP") {
      assertPath(value, item.line);
      if (key === "OUTPUT") {
        if (outputPath !== undefined) {
          throw new Error("duplicate Program List OUTPUT");
        }
        outputPath = value;
      } else if (key === "LISTING") {
        if (listingPath !== undefined) {
          throw new Error("duplicate Program List LISTING");
        }
        listingPath = value;
      } else {
        if (mapPath !== undefined)
          throw new Error("duplicate Program List MAP");
        mapPath = value;
      }
      continue;
    }
    throw new Error(
      `unsupported Program List key ${key} on line ${String(item.line)}`,
    );
  }
  if (sources.length === 0 && objectPaths.length === 0) {
    throw new Error("Program List has no SOURCE or OBJECT inputs");
  }
  if (sources.length + objectPaths.length > 64) {
    throw new Error("Program List linker input count limit exceeded");
  }
  if (outputPath === undefined) {
    throw new Error("Program List OUTPUT is required");
  }
  const generatedOutputs = [outputPath, listingPath, mapPath].filter(
    (path): path is string => path !== undefined,
  );
  const generatedOutputIdentities = new Set<string>();
  for (const generated of generatedOutputs) {
    const identity = dosIdentity(generated);
    if (inputIdentities.has(identity)) {
      throw new Error(
        "Program List generated output collides with an authored input",
      );
    }
    if (generatedObjectIdentities.has(identity)) {
      throw new Error(
        "Program List generated output collides with a generated OBJ",
      );
    }
    if (generatedOutputIdentities.has(identity)) {
      throw new Error("Program List generated output paths collide");
    }
    generatedOutputIdentities.add(identity);
  }

  return {
    definitions,
    entry,
    includePaths,
    listingPath,
    mapPath,
    objectPaths,
    outputPath,
    sources,
    undefines,
  };
}

export function fingerprintCsDosProgram(
  program: CsDosProgramList,
  inputs: readonly CsDosProgramFingerprintInput[],
  compilerIdentity = "CS-DOS-TOOLCHAIN-1.0",
): string {
  if (inputs.length > 256) {
    throw new Error("Program fingerprint input limit exceeded");
  }
  return sha256Hex(
    JSON.stringify({
      compilerIdentity,
      inputs: inputs.map(({ contents, path }) => ({
        digest: sha256Hex(contents),
        path: dosIdentity(path),
      })),
      program,
    }),
  );
}

function sourceLanguage(
  path: string,
  line: number,
): CsDosProgramSourceLanguage {
  if (/\.ASM$/iu.test(path)) return "asm";
  if (/\.CPP$/iu.test(path)) return "cpp";
  if (/\.C$/iu.test(path)) return "c";
  throw new Error(
    `Program List line ${String(line)} SOURCE must end in .ASM, .C, or .CPP`,
  );
}

function parseDefinition(
  value: string,
  line: number,
): { readonly name: string; readonly replacement?: string } {
  const equals = value.indexOf("=");
  const name = (equals < 0 ? value : value.slice(0, equals)).trim();
  assertIdentifier(name, line, "DEFINE");
  const replacement = equals < 0 ? undefined : value.slice(equals + 1);
  return replacement === undefined ? { name } : { name, replacement };
}

function assertIdentifier(value: string, line: number, key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(value)) {
    throw new Error(
      `Program List line ${String(line)} has invalid ${key} identifier`,
    );
  }
}

function assertPath(value: string, line: number): void {
  if (
    value.length === 0 ||
    value.length > maximumPathCharacters ||
    /[\0\r\n*?]/u.test(value)
  ) {
    throw new Error(
      `Program List line ${String(line)} has invalid or oversized path`,
    );
  }
}

function dosIdentity(value: string): string {
  return value.replaceAll("/", "\\").toUpperCase();
}

function dosBasenameWithoutExtension(value: string): string {
  const base = dosIdentity(value).split("\\").at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? base : base.slice(0, dot);
}

function replaceDosExtension(value: string, extension: string): string {
  const slash = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
  const dot = value.lastIndexOf(".");
  return `${dot > slash ? value.slice(0, dot) : value}${extension}`;
}

import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  validateCs486Executable,
  type Cs486Executable,
} from "../../src/domain/cpu/cs486.js";
import {
  validateCs486Object,
  type Cs486Object,
} from "../../src/domain/cpu/cs486Object.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

type CFamilyLanguage = "c" | "cpp";
type ProfileId = "dos" | "linux";

interface ProfileFixture {
  readonly filesystem: InMemoryFilesystem;
  readonly newline: "\n" | "\r\n";
  readonly shell: ShellSession;
}

const profiles = [
  { name: "CS-Linux", profile: "linux" },
  { name: "CS-DOS", profile: "dos" },
] as const;

const languages = [
  {
    command: "cc",
    language: "c",
    source: [
      "int answer() {",
      "return 6 * 7;",
      "}",
      "int main() {",
      "int result = answer();",
      'printf("%d\\n", result);',
      "return 0;",
      "}",
    ],
  },
  {
    command: "c++",
    language: "cpp",
    source: [
      "int answer() {",
      "return 6 * 7;",
      "}",
      "int main() {",
      "int result = answer();",
      "std::cout << result << std::endl;",
      "return 0;",
      "}",
    ],
  },
] as const;

describe.each(profiles)("$name C-family profile contract", ({ profile }) => {
  it.each(languages)(
    "compiles and runs the supported $language subset through guest paths",
    ({ command, language, source }): void => {
      const fixture = createFixture(profile);
      const sourcePath = guestPath(
        profile,
        `ANSWER.${sourceExtension(language)}`,
      );
      const outputPath = guestPath(profile, executableName(language));
      fixture.filesystem.writeFile(
        storagePath(profile, `answer.${sourceExtension(language)}`),
        `${source.join(fixture.newline)}${fixture.newline}`,
      );

      const compilation = fixture.shell.submit(
        compileCommand(profile, command, sourcePath, outputPath),
      );
      expect(compilation).toMatchObject({ exitCode: 0, stderr: "" });
      expect(
        fixture.filesystem.exists(
          storagePath(profile, executableName(language).toLowerCase()),
        ),
      ).toBe(true);

      expect(fixture.shell.submit(outputPath)).toMatchObject({
        exitCode: 0,
        stderr: "",
        stdout: `42${fixture.newline}`,
      });

      const executable = decodeExecutable(
        fixture.filesystem.readFile(
          storagePath(profile, executableName(language).toLowerCase()),
        ),
      );
      expect(
        executable.instructions.some((instruction) => instruction.op === "mul"),
        `${profile} ${language} should fold the constant 6 * 7 expression`,
      ).toBe(false);
    },
  );

  it.each(languages)(
    "preserves nested $language calls and an observable void call statement",
    ({ command, language }): void => {
      const fixture = createFixture(profile);
      const sourceName = `NESTED.${sourceExtension(language)}`;
      const outputName = nestedExecutableName(language);
      const sourcePath = guestPath(profile, sourceName);
      const outputPath = guestPath(profile, outputName);
      const printPrefix =
        language === "cpp" ? "std::cout << 4;" : 'printf("%d", 4);';
      const printAnswer =
        language === "cpp"
          ? "std::cout << answer << std::endl;"
          : 'printf("%d\\n", answer);';
      fixture.filesystem.writeFile(
        storagePath(profile, sourceName.toLowerCase()),
        [
          "void mark() {",
          printPrefix,
          "return;",
          "}",
          "int leaf() {",
          "return 2;",
          "}",
          "int branch() {",
          "return leaf() + leaf();",
          "}",
          "int main() {",
          "int prefix = 38;",
          "mark();",
          "int answer = prefix + branch();",
          printAnswer,
          "return 0;",
          "}",
          "",
        ].join(fixture.newline),
      );

      expect(
        fixture.shell.submit(
          compileCommand(profile, command, sourcePath, outputPath),
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      expect(fixture.shell.submit(outputPath)).toMatchObject({
        exitCode: 0,
        stderr: "",
        stdout: `442${fixture.newline}`,
      });
    },
  );

  it.each(languages)(
    "retains an unused trapping $language division through dead-code elimination",
    ({ command, language }): void => {
      const fixture = createFixture(profile);
      const sourceName = `DIVZERO.${sourceExtension(language)}`;
      const outputName = divisionExecutableName(language);
      const sourcePath = guestPath(profile, sourceName);
      const outputPath = guestPath(profile, outputName);
      fixture.filesystem.writeFile(
        storagePath(profile, sourceName.toLowerCase()),
        ["int main() {", "int unused = 1 / 0;", "return 0;", "}", ""].join(
          fixture.newline,
        ),
      );

      expect(
        fixture.shell.submit(
          compileCommand(profile, command, sourcePath, outputPath),
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      const result = fixture.shell.submit(outputPath);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      if (profile === "dos") expect(result.stderr).toBe("Command failed.\r\n");
      else expect(result.stderr).toMatch(/division by zero/iu);
      expect(result.stderr.endsWith(fixture.newline)).toBe(true);
    },
  );
});

describe.each(languages)(
  "$language deterministic object contract",
  ({ command, language }) => {
    it("emits byte-identical instructions, sections, symbols, and relocations across Linux and DOS paths/newlines", (): void => {
      const sourceLines = [
        "extern int external_answer();",
        "int main() {",
        "int adjustment = 2;",
        "return external_answer() + adjustment;",
        "}",
        "",
      ];
      const linux = createFixture("linux");
      const dos = createFixture("dos");
      linux.filesystem.writeFile(
        `/work/parity.${sourceExtension(language)}`,
        sourceLines.join("\n"),
      );
      dos.filesystem.writeFile(
        `/drives/c/work/parity.${sourceExtension(language)}`,
        sourceLines.join("\r\n"),
      );

      expect(
        linux.shell.submit(
          `${command} -c /work/parity.${sourceExtension(language)} -o /work/first.o`,
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      expect(
        linux.shell.submit(
          `${command} -c /work/parity.${sourceExtension(language)} -o /work/second.o`,
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      expect(
        dos.shell.submit(
          `${command.toUpperCase()} /C C:\\WORK\\PARITY.${sourceExtension(language).toUpperCase()} /OUT:C:\\WORK\\PARITY.O`,
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });

      const linuxFirst = linux.filesystem.readFile("/work/first.o");
      const linuxSecond = linux.filesystem.readFile("/work/second.o");
      const dosEncoded = dos.filesystem.readFile("/drives/c/work/parity.o");
      expect(linuxSecond).toBe(linuxFirst);
      expect(dosEncoded).toBe(linuxFirst);

      const linuxObject = decodeObject(linuxFirst);
      const dosObject = decodeObject(dosEncoded);
      expect(dosObject.sections).toEqual(linuxObject.sections);
      expect(dosObject.symbols).toEqual(linuxObject.symbols);
      expect(dosObject.relocations).toEqual(linuxObject.relocations);
      expect(dosObject.assembly).toBe(linuxObject.assembly);
      expect(linuxObject.symbols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            functionSignature: "()->i32",
            name: "external_answer",
          }),
          expect.objectContaining({
            functionSignature: "()->i32",
            name: "main",
          }),
        ]),
      );
      expect(dosObject.relocations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            symbol: "external_answer",
            type: "text-target",
          }),
        ]),
      );
    });
  },
);

describe.each(languages)(
  "$language compiler rejection parity",
  ({ command, language }) => {
    it("rejects the same malformed expression explicitly in Linux and DOS", (): void => {
      const diagnostics = new Map<ProfileId, string>();
      for (const profile of ["linux", "dos"] as const) {
        const fixture = createFixture(profile);
        const sourceName = `BROKEN.${sourceExtension(language)}`;
        const outputName = brokenExecutableName(language);
        const sourcePath = guestPath(profile, sourceName);
        const outputPath = guestPath(profile, outputName);
        fixture.filesystem.writeFile(
          storagePath(profile, sourceName.toLowerCase()),
          ["int main() {", "return 1 +;", "}", ""].join(fixture.newline),
        );

        const result = fixture.shell.submit(
          compileCommand(profile, command, sourcePath, outputPath),
        );
        expect(result).toMatchObject({ exitCode: 1, stdout: "" });
        expect(result.stderr).toMatch(/error [A-Z]+\d{3}: .+/u);
        expect(result.stderr.endsWith(fixture.newline)).toBe(true);
        if (profile === "dos") expect(result.stderr).not.toMatch(/(?<!\r)\n/u);
        else expect(result.stderr).not.toContain("\r\n");
        expect(
          fixture.filesystem.exists(
            storagePath(profile, outputName.toLowerCase()),
          ),
        ).toBe(false);
        diagnostics.set(profile, diagnosticSignature(result.stderr));
      }

      expect(diagnostics.get("dos")).toBe(diagnostics.get("linux"));
    });
  },
);

function createFixture(profile: ProfileId): ProfileFixture {
  const filesystem = new InMemoryFilesystem();
  const shell = new ShellSession(filesystem, { osProfile: profile });
  filesystem.makeDirectory(profile === "dos" ? "/drives/c/work" : "/work");
  return {
    filesystem,
    newline: profile === "dos" ? "\r\n" : "\n",
    shell,
  };
}

function compileCommand(
  profile: ProfileId,
  command: string,
  sourcePath: string,
  outputPath: string,
): string {
  return profile === "dos"
    ? `${command.toUpperCase()} ${sourcePath} /OUT:${outputPath}`
    : `${command} ${sourcePath} -o ${outputPath}`;
}

function guestPath(profile: ProfileId, name: string): string {
  return profile === "dos"
    ? `C:\\WORK\\${name.toUpperCase()}`
    : `/work/${name.toLowerCase()}`;
}

function storagePath(profile: ProfileId, name: string): string {
  return profile === "dos"
    ? `/drives/c/work/${name.toLowerCase()}`
    : `/work/${name.toLowerCase()}`;
}

function sourceExtension(language: CFamilyLanguage): "c" | "cpp" {
  return language === "cpp" ? "cpp" : "c";
}

function executableName(language: CFamilyLanguage): string {
  return language === "cpp" ? "ANSCPP" : "ANSC";
}

function brokenExecutableName(language: CFamilyLanguage): string {
  return language === "cpp" ? "BADCPP" : "BADC";
}

function nestedExecutableName(language: CFamilyLanguage): string {
  return language === "cpp" ? "NESTCPP" : "NESTC";
}

function divisionExecutableName(language: CFamilyLanguage): string {
  return language === "cpp" ? "DIVCPP" : "DIVC";
}

function decodeExecutable(encoded: string): Cs486Executable {
  expect(encoded.startsWith("CS486\n")).toBe(true);
  const executable: unknown = JSON.parse(encoded.slice("CS486\n".length));
  validateCs486Executable(executable);
  return executable;
}

function decodeObject(encoded: string): Cs486Object {
  expect(encoded.startsWith("CS486OBJ\n")).toBe(true);
  const object: unknown = JSON.parse(encoded.slice("CS486OBJ\n".length));
  validateCs486Object(object);
  return object;
}

function diagnosticSignature(stderr: string): string {
  const diagnostic = /error ([A-Z]+\d{3}): ([^\r\n]+)/u.exec(stderr);
  expect(diagnostic).not.toBeNull();
  return `${diagnostic![1]}: ${diagnostic![2]}`;
}

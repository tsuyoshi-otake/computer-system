export interface QBasicCommandLine {
  readonly display: {
    readonly blackAndWhite: boolean;
    readonly cgaSnow: boolean;
    readonly highIntensity: boolean;
    readonly highResolution: boolean;
    readonly monochrome: boolean;
  };
  readonly editorMode: boolean;
  readonly fileName?: string;
  readonly mbf: boolean;
  readonly run: boolean;
}

export class QBasicCommandLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QBasicCommandLineError";
  }
}

const switches = new Set([
  "/B",
  "/EDITOR",
  "/G",
  "/H",
  "/MBF",
  "/NOHI",
  "/RUN",
]);

/** Parses the command line shipped by MS-DOS 6.22 QBasic, without inventing /HELP. */
export function parseQBasicCommandLine(
  arguments_: readonly string[],
): QBasicCommandLine {
  if (arguments_.length > 16)
    throw new QBasicCommandLineError("Too many parameters");
  const seen = new Set<string>();
  let fileName: string | undefined;
  for (const argument of arguments_) {
    const upper = argument.toUpperCase();
    if (upper.startsWith("/")) {
      if (!switches.has(upper))
        throw new QBasicCommandLineError(`Invalid switch - ${argument}`);
      if (seen.has(upper))
        throw new QBasicCommandLineError(`Duplicate switch - ${argument}`);
      seen.add(upper);
      continue;
    }
    if (fileName !== undefined)
      throw new QBasicCommandLineError(
        "Only one program file may be specified",
      );
    if (argument.length === 0)
      throw new QBasicCommandLineError("Program file name is empty");
    fileName = argument;
  }

  const editorMode = seen.has("/EDITOR");
  const run = seen.has("/RUN");
  if (editorMode && run)
    throw new QBasicCommandLineError("/EDITOR and /RUN cannot be combined");
  if (run && fileName === undefined)
    throw new QBasicCommandLineError("/RUN requires a program file");

  return {
    display: {
      blackAndWhite: seen.has("/B"),
      cgaSnow: seen.has("/G"),
      highIntensity: !seen.has("/NOHI"),
      highResolution: seen.has("/H"),
      monochrome: seen.has("/B"),
    },
    editorMode,
    ...(fileName === undefined ? {} : { fileName }),
    mbf: seen.has("/MBF"),
    run,
  };
}

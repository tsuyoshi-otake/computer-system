export type Cs486ObjectFormatVersion = 1 | 2 | 3 | 4;
export type Cs486ExecutableFormatVersion = 1 | 2 | 3 | 4 | 5;

export type Cs486FormatLimitRequest =
  | {
      readonly format: "executable";
      readonly version: Cs486ExecutableFormatVersion;
    }
  | { readonly format: "object"; readonly version: Cs486ObjectFormatVersion };

export interface Cs486FormatLimits {
  readonly assemblyCharacters: number;
  readonly dataBytes: number;
  readonly initializedDataBytes: number;
  readonly initialDataSegments: number;
  readonly instructions: number;
  readonly relocations: number;
  readonly symbols: number;
}

export const currentCs486ObjectFormatVersion = 4 as const;
export const currentCs486ExecutableFormatVersion = 5 as const;

const mib = 1_048_576;

const legacyLimits: Cs486FormatLimits = Object.freeze({
  assemblyCharacters: 256_000,
  dataBytes: 16 * mib,
  initializedDataBytes: 256_000,
  initialDataSegments: 256,
  instructions: 4_096,
  relocations: 4_096,
  symbols: 2_048,
});

const largeLimits: Cs486FormatLimits = Object.freeze({
  assemblyCharacters: 256_000,
  dataBytes: 16 * mib,
  initializedDataBytes: 2 * mib,
  initialDataSegments: 256,
  instructions: 65_536,
  relocations: 65_536,
  symbols: 16_384,
});

/**
 * Returns the immutable structural ceiling for one serialized format version.
 * Object v3 and executable v4 are the first large-capacity formats. Object v4
 * and executable v5 retain those ceilings while adding an explicit data-model
 * identity. Older readers deliberately retain their original rejection
 * boundary.
 */
export function cs486FormatLimits(
  request: Cs486FormatLimitRequest,
): Cs486FormatLimits {
  return request.format === "object"
    ? request.version === 3 || request.version === 4
      ? largeLimits
      : legacyLimits
    : request.version === 4 || request.version === 5
      ? largeLimits
      : legacyLimits;
}

export interface LexerLimits {
  readonly maxSourceCodeUnits: number;
  readonly maxTokens: number;
  readonly maxIdentifierCodeUnits: number;
  readonly maxLiteralCodeUnits: number;
  readonly maxDelimiterNesting: number;
  readonly maxIndentationDepth: number;
}

export interface ParserLimits {
  readonly maxStatements: number;
  readonly maxBlockNesting: number;
  readonly maxExpressionNesting: number;
  readonly maxParameters: number;
  readonly maxArguments: number;
  readonly maxItemsPerConstruct: number;
  readonly maxFormattedStringExpressions: number;
}

export interface LanguageFrontendLimits {
  readonly lexer: LexerLimits;
  readonly parser: ParserLimits;
}

export interface LanguageFrontendLimitOverrides {
  readonly lexer?: Partial<LexerLimits>;
  readonly parser?: Partial<ParserLimits>;
}

export const defaultLexerLimits: LexerLimits = Object.freeze({
  maxSourceCodeUnits: 512_000,
  maxTokens: 131_072,
  maxIdentifierCodeUnits: 512,
  maxLiteralCodeUnits: 65_536,
  maxDelimiterNesting: 64,
  maxIndentationDepth: 64,
});

export const defaultParserLimits: ParserLimits = Object.freeze({
  maxStatements: 16_384,
  maxBlockNesting: 64,
  maxExpressionNesting: 64,
  maxParameters: 256,
  maxArguments: 256,
  maxItemsPerConstruct: 4_096,
  maxFormattedStringExpressions: 256,
});

export const defaultLanguageFrontendLimits: LanguageFrontendLimits =
  Object.freeze({
    lexer: defaultLexerLimits,
    parser: defaultParserLimits,
  });

export function resolveLexerLimits(
  overrides: Partial<LexerLimits> = {},
): LexerLimits {
  const limits = Object.freeze({ ...defaultLexerLimits, ...overrides });
  validateLimits(limits);
  return limits;
}

export function resolveLanguageFrontendLimits(
  overrides: LanguageFrontendLimitOverrides = {},
): LanguageFrontendLimits {
  const limits = Object.freeze({
    lexer: resolveLexerLimits(overrides.lexer),
    parser: Object.freeze({ ...defaultParserLimits, ...overrides.parser }),
  });
  validateLimits(limits.parser);
  return limits;
}

function validateLimits(limits: object): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
}

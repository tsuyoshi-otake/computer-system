export const maximumTuiVerificationLiterals = 32;
export const maximumTuiVerificationSameRowGroups = 16;
export const maximumTuiVerificationVerticalRuns = 16;

const maximumLiteralLength = 500;
const maximumSameRowGroupSize = 8;
const maximumVerticalCharacters = 16;
const maximumTuiWidth = 200;
const maximumTuiHeight = 100;

const criteriaKeys = new Set([
  "containsAll",
  "excludesAll",
  "height",
  "minimumVersion",
  "orderedContains",
  "requireColors",
  "sameRowGroups",
  "verticalRuns",
  "width",
]);

export function verifyTuiScreen(screen, criteria = {}) {
  requireObject(criteria, "criteria");
  const unexpected = Object.keys(criteria).filter(
    (key) => !criteriaKeys.has(key),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected TUI verification criteria: ${unexpected.join(", ")}`,
    );
  }

  const containsAll = literalList(criteria.containsAll, "containsAll");
  const excludesAll = literalList(criteria.excludesAll, "excludesAll");
  const orderedContains = literalList(
    criteria.orderedContains,
    "orderedContains",
  );
  const sameRowGroups = sameRowGroupList(criteria.sameRowGroups);
  const verticalRuns = verticalRunList(criteria.verticalRuns);
  const expectedWidth = optionalBoundedInteger(
    criteria.width,
    "width",
    1,
    maximumTuiWidth,
  );
  const expectedHeight = optionalBoundedInteger(
    criteria.height,
    "height",
    1,
    maximumTuiHeight,
  );
  const minimumVersion = optionalBoundedInteger(
    criteria.minimumVersion,
    "minimumVersion",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const requireColors = optionalBoolean(criteria.requireColors, true);
  const normalized = requireScreen(screen, requireColors);
  const rows = normalized.surface.rows;
  const text = rows.join("\n");
  const failures = [];

  if (
    expectedWidth !== undefined &&
    normalized.surface.width !== expectedWidth
  ) {
    failures.push(
      `width expected ${String(expectedWidth)} but received ${String(normalized.surface.width)}`,
    );
  }
  if (
    expectedHeight !== undefined &&
    normalized.surface.height !== expectedHeight
  ) {
    failures.push(
      `height expected ${String(expectedHeight)} but received ${String(normalized.surface.height)}`,
    );
  }
  if (
    minimumVersion !== undefined &&
    normalized.snapshotVersion < minimumVersion
  ) {
    failures.push(
      `snapshotVersion expected at least ${String(minimumVersion)} but received ${String(normalized.snapshotVersion)}`,
    );
  }

  for (const [index, literal] of containsAll.entries()) {
    if (!text.includes(literal)) {
      failures.push(`containsAll[${String(index)}] was not found`);
    }
  }
  for (const [index, literal] of excludesAll.entries()) {
    if (text.includes(literal)) {
      failures.push(`excludesAll[${String(index)}] was found`);
    }
  }

  let orderedOffset = 0;
  for (const [index, literal] of orderedContains.entries()) {
    const found = text.indexOf(literal, orderedOffset);
    if (found < 0) {
      failures.push(`orderedContains[${String(index)}] was not found in order`);
      break;
    }
    orderedOffset = found + literal.length;
  }

  for (const [index, group] of sameRowGroups.entries()) {
    if (!rows.some((row) => group.every((literal) => row.includes(literal)))) {
      failures.push(`sameRowGroups[${String(index)}] was not found on one row`);
    }
  }

  const cellRows = rows.map((row) => [...row]);
  const verticalEvidence = verticalRuns.map((criterion, index) => {
    const measured = measureVerticalRuns(cellRows, criterion);
    if (measured.count < criterion.minimumCount) {
      failures.push(
        `verticalRuns[${String(index)}] expected ${String(criterion.minimumCount)} run(s) of length ${String(criterion.minimumLength)} but found ${String(measured.count)}`,
      );
    }
    return {
      count: measured.count,
      longest: measured.longest,
      minimumCount: criterion.minimumCount,
      minimumLength: criterion.minimumLength,
    };
  });

  return {
    schema: 1,
    verified: failures.length === 0,
    computerId: normalized.computerId,
    sessionId: normalized.sessionId,
    snapshotVersion: normalized.snapshotVersion,
    exactDebugWriter: true,
    surface: {
      kind: "text",
      schema: 1,
      width: normalized.surface.width,
      height: normalized.surface.height,
      rowCount: rows.length,
      cursorValid: true,
      colorGridsValid: requireColors ? true : null,
    },
    checks: {
      containsAll: containsAll.length,
      excludesAll: excludesAll.length,
      orderedContains: orderedContains.length,
      sameRowGroups: sameRowGroups.length,
      verticalRuns: verticalEvidence,
    },
    failures,
  };
}

function requireScreen(screen, requireColors) {
  requireObject(screen, "screen");
  requireObject(screen.surface, "screen.surface");
  const surface = screen.surface;
  if (
    screen.schema !== 1 ||
    typeof screen.computerId !== "string" ||
    typeof screen.sessionId !== "string" ||
    screen.principalKind !== "debug" ||
    screen.mode !== "writer" ||
    !Number.isSafeInteger(screen.snapshotVersion) ||
    screen.snapshotVersion < 1 ||
    surface.kind !== "text" ||
    surface.schema !== 1 ||
    !Number.isSafeInteger(surface.width) ||
    surface.width < 1 ||
    surface.width > maximumTuiWidth ||
    !Number.isSafeInteger(surface.height) ||
    surface.height < 1 ||
    surface.height > maximumTuiHeight ||
    !Array.isArray(surface.rows) ||
    surface.rows.length !== surface.height
  ) {
    throw new Error(
      "The captured MCP writer did not provide a valid text surface.",
    );
  }
  for (const row of surface.rows) {
    if (typeof row !== "string" || [...row].length !== surface.width) {
      throw new Error("The captured MCP writer provided an invalid text row.");
    }
  }
  requireObject(surface.cursor, "screen.surface.cursor");
  if (
    !Number.isSafeInteger(surface.cursor.x) ||
    surface.cursor.x < 1 ||
    surface.cursor.x > surface.width + 1 ||
    !Number.isSafeInteger(surface.cursor.y) ||
    surface.cursor.y < 1 ||
    surface.cursor.y > surface.height ||
    typeof surface.cursor.blink !== "boolean"
  ) {
    throw new Error("The captured MCP writer provided an invalid text cursor.");
  }
  if (requireColors) {
    requireColorGrid(
      surface.foreground,
      surface.width,
      surface.height,
      "foreground",
    );
    requireColorGrid(
      surface.background,
      surface.width,
      surface.height,
      "background",
    );
  }
  return screen;
}

function requireColorGrid(grid, width, height, name) {
  if (!Array.isArray(grid) || grid.length !== height) {
    throw new Error(`The captured MCP writer omitted the ${name} color grid.`);
  }
  for (const row of grid) {
    if (
      !Array.isArray(row) ||
      row.length !== width ||
      row.some(
        (color) => !Number.isSafeInteger(color) || color < 0 || color > 15,
      )
    ) {
      throw new Error(
        `The captured MCP writer provided an invalid ${name} row.`,
      );
    }
  }
}

function literalList(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumTuiVerificationLiterals) {
    throw new RangeError(
      `${name} must contain at most ${String(maximumTuiVerificationLiterals)} literals.`,
    );
  }
  return value.map((literal, index) => {
    if (
      typeof literal !== "string" ||
      literal.length < 1 ||
      [...literal].length > maximumLiteralLength
    ) {
      throw new RangeError(
        `${name}[${String(index)}] must contain 1 to ${String(maximumLiteralLength)} characters.`,
      );
    }
    return literal;
  });
}

function sameRowGroupList(value) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > maximumTuiVerificationSameRowGroups
  ) {
    throw new RangeError(
      `sameRowGroups must contain at most ${String(maximumTuiVerificationSameRowGroups)} groups.`,
    );
  }
  return value.map((group, index) => {
    if (
      !Array.isArray(group) ||
      group.length < 2 ||
      group.length > maximumSameRowGroupSize
    ) {
      throw new RangeError(
        `sameRowGroups[${String(index)}] must contain 2 to ${String(maximumSameRowGroupSize)} literals.`,
      );
    }
    return literalList(group, `sameRowGroups[${String(index)}]`);
  });
}

function verticalRunList(value) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > maximumTuiVerificationVerticalRuns
  ) {
    throw new RangeError(
      `verticalRuns must contain at most ${String(maximumTuiVerificationVerticalRuns)} criteria.`,
    );
  }
  return value.map((criterion, index) => {
    requireObject(criterion, `verticalRuns[${String(index)}]`);
    const unexpected = Object.keys(criterion).filter(
      (key) =>
        key !== "characters" &&
        key !== "minimumCount" &&
        key !== "minimumLength",
    );
    if (unexpected.length > 0) {
      throw new Error(
        `Unexpected verticalRuns[${String(index)}] fields: ${unexpected.join(", ")}`,
      );
    }
    if (
      typeof criterion.characters !== "string" ||
      [...criterion.characters].length < 1 ||
      [...criterion.characters].length > maximumVerticalCharacters
    ) {
      throw new RangeError(
        `verticalRuns[${String(index)}].characters must contain 1 to ${String(maximumVerticalCharacters)} characters.`,
      );
    }
    return {
      characters: new Set([...criterion.characters]),
      minimumLength: requiredBoundedInteger(
        criterion.minimumLength,
        `verticalRuns[${String(index)}].minimumLength`,
        1,
        maximumTuiHeight,
      ),
      minimumCount:
        optionalBoundedInteger(
          criterion.minimumCount,
          `verticalRuns[${String(index)}].minimumCount`,
          1,
          maximumTuiWidth,
        ) ?? 1,
    };
  });
}

function measureVerticalRuns(cellRows, criterion) {
  const height = cellRows.length;
  const width = cellRows[0]?.length ?? 0;
  let count = 0;
  let longest = 0;
  for (let column = 0; column < width; column += 1) {
    let run = 0;
    for (let row = 0; row <= height; row += 1) {
      if (
        row < height &&
        criterion.characters.has(cellRows[row]?.[column] ?? "")
      ) {
        run += 1;
        continue;
      }
      longest = Math.max(longest, run);
      if (run >= criterion.minimumLength) count += 1;
      run = 0;
    }
  }
  return { count, longest };
}

function optionalBoolean(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw new TypeError("requireColors must be a boolean.");
  }
  return value;
}

function optionalBoundedInteger(value, name, minimum, maximum) {
  if (value === undefined) return undefined;
  return requiredBoundedInteger(value, name, minimum, maximum);
}

function requiredBoundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be an integer from ${String(minimum)} through ${String(maximum)}.`,
    );
  }
  return value;
}

function requireObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
}

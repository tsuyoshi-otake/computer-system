export function calculateFixedGridFontSize({
  availableHeight,
  availableWidth,
  columns,
  lineHeightRatio,
  maximumPixels,
  monospaceRatio,
  rows,
}) {
  for (const [label, value] of [
    ["columns", columns],
    ["rows", rows],
    ["monospaceRatio", monospaceRatio],
    ["lineHeightRatio", lineHeightRatio],
    ["maximumPixels", maximumPixels],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${label} must be a positive finite number`);
    }
  }
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(availableHeight) ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) {
    return { kind: "unmeasurable" };
  }
  const fitted = Math.min(
    maximumPixels,
    availableWidth / (columns * monospaceRatio),
    availableHeight / (rows * lineHeightRatio),
  );
  return { kind: "fitted", pixels: Math.floor(fitted * 100) / 100 };
}

export function calculateRasterPresentation({
  displayAspectRatio = 4 / 3,
  logicalHeight,
  logicalWidth,
}) {
  for (const [label, value] of [
    ["displayAspectRatio", displayAspectRatio],
    ["logicalHeight", logicalHeight],
    ["logicalWidth", logicalWidth],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${label} must be a positive finite number`);
    }
  }
  const logicalAspectRatio = logicalWidth / logicalHeight;
  return {
    displayAspectRatio,
    horizontalScale: displayAspectRatio / logicalAspectRatio,
    logicalAspectRatio,
  };
}

export function calculateTextRasterPresentation({
  columns,
  displayAspectRatio = 4 / 3,
  glyphHeight = 16,
  glyphWidth = 9,
  rasterMarginRows = 1,
  rows,
}) {
  for (const [label, value] of [
    ["columns", columns],
    ["rows", rows],
    ["glyphHeight", glyphHeight],
    ["glyphWidth", glyphWidth],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${label} must be a positive finite number`);
    }
  }
  if (!Number.isInteger(rasterMarginRows) || rasterMarginRows < 0) {
    throw new RangeError("rasterMarginRows must be a non-negative integer");
  }
  const fittedRows = rows + rasterMarginRows * 2;
  const presentation = calculateRasterPresentation({
    displayAspectRatio,
    logicalHeight: fittedRows * glyphHeight,
    logicalWidth: columns * glyphWidth,
  });
  return {
    ...presentation,
    fittedRows,
    physicalCellRatio: (displayAspectRatio * fittedRows) / columns,
    rasterMarginRows,
  };
}

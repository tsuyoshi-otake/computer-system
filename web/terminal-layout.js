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

export function calculateIntegerGridPresentation({
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
  const pixels = Math.max(
    1,
    Math.floor(
      Math.min(
        maximumPixels,
        availableWidth / (columns * monospaceRatio),
        availableHeight / (rows * lineHeightRatio),
      ),
    ),
  );
  const frameWidth = Math.round(columns * monospaceRatio * pixels);
  const frameHeight = Math.round(rows * lineHeightRatio * pixels);
  return {
    frameHeight,
    frameWidth,
    kind: "fitted",
    letterboxX: Math.max(0, Math.floor((availableWidth - frameWidth) / 2)),
    letterboxY: Math.max(0, Math.floor((availableHeight - frameHeight) / 2)),
    pixels,
  };
}

export function calculateLineCursorCell({
  baseX,
  baseY,
  columns,
  rows,
  selectionStart,
  value,
}) {
  if (!Number.isSafeInteger(columns) || columns <= 0) {
    throw new RangeError("columns must be a positive safe integer");
  }
  if (!Number.isSafeInteger(rows) || rows <= 0) {
    throw new RangeError("rows must be a positive safe integer");
  }
  if (!Number.isSafeInteger(baseX) || !Number.isSafeInteger(baseY)) {
    throw new RangeError("base cursor coordinates must be safe integers");
  }
  if (!Number.isSafeInteger(selectionStart) || selectionStart < 0) {
    throw new RangeError("selectionStart must be a non-negative safe integer");
  }
  if (typeof value !== "string") {
    throw new TypeError("value must be a string");
  }
  const x = Math.max(0, Math.min(columns - 1, baseX));
  const y = Math.max(0, Math.min(rows - 1, baseY));
  const selected = value.slice(0, Math.min(value.length, selectionStart));
  const inputCells = [...selected].length;
  const absolute = Math.min(columns * rows - 1, y * columns + x + inputCells);
  return {
    x: absolute % columns,
    y: Math.floor(absolute / columns),
  };
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

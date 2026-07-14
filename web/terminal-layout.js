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

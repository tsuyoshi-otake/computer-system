export const CRT_PROFILES = Object.freeze([
  "off",
  "subtle",
  "arcade",
  "shadow-mask",
]);

export const SCREEN_SHAPES = Object.freeze(["flat", "curved"]);

export const MIN_CURVATURE_PERCENT = 0;
export const MAX_CURVATURE_PERCENT = 30;
export const DEFAULT_CURVATURE_PERCENT = 2;

export const DEFAULT_TERMINAL_PRESENTATION = Object.freeze({
  curvaturePercent: DEFAULT_CURVATURE_PERCENT,
  profile: "subtle",
  shape: "flat",
});

export const CURVATURE_INVERSE_ITERATIONS = 14;

const profileSet = new Set(CRT_PROFILES);
const shapeSet = new Set(SCREEN_SHAPES);

export function normalizeTerminalPresentation(value) {
  const curvaturePercent = normalizeCurvaturePercent(value?.curvaturePercent);
  const profile = profileSet.has(value?.profile)
    ? value.profile
    : DEFAULT_TERMINAL_PRESENTATION.profile;
  const shape = shapeSet.has(value?.shape)
    ? value.shape
    : DEFAULT_TERMINAL_PRESENTATION.shape;
  return Object.freeze({ curvaturePercent, profile, shape });
}

export function normalizeCurvaturePercent(value) {
  const numericValue =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) return DEFAULT_CURVATURE_PERCENT;
  return Math.min(
    MAX_CURVATURE_PERCENT,
    Math.max(MIN_CURVATURE_PERCENT, Math.round(numericValue)),
  );
}

export function curvatureScaleFromPercent(value) {
  return normalizeCurvaturePercent(value) / 100;
}

export function terminalPresentationAttributes(value) {
  const normalized = normalizeTerminalPresentation(value);
  return Object.freeze({
    "data-curvature-percent": String(normalized.curvaturePercent),
    "data-crt-profile": normalized.profile,
    "data-screen-shape": normalized.shape,
  });
}

export function curvatureDisplacementChannels(point) {
  if (!isUnitPoint(point, true)) return undefined;
  const centeredX = point.x * 2 - 1;
  const centeredY = point.y * 2 - 1;
  const radiusSquared = (centeredX * centeredX + centeredY * centeredY) / 2;
  return {
    blue: 0.5,
    green: clamp01(0.5 + (centeredY * radiusSquared) / 2),
    red: clamp01(0.5 + (centeredX * radiusSquared) / 2),
  };
}

export function displayPointToSource(
  point,
  shape,
  curvaturePercent = DEFAULT_CURVATURE_PERCENT,
) {
  if (!isUnitPoint(point, true)) return undefined;
  if (shape !== "curved") return { x: point.x, y: point.y };

  const centeredX = point.x * 2 - 1;
  const centeredY = point.y * 2 - 1;
  const radiusSquared = (centeredX * centeredX + centeredY * centeredY) / 2;
  const gain = 1 + curvatureScaleFromPercent(curvaturePercent) * radiusSquared;
  const source = {
    x: 0.5 + (centeredX * gain) / 2,
    y: 0.5 + (centeredY * gain) / 2,
  };
  return isUnitPoint(source, true) ? source : undefined;
}

export function sourcePointToDisplay(
  point,
  shape,
  curvaturePercent = DEFAULT_CURVATURE_PERCENT,
) {
  if (!isUnitPoint(point, true)) return undefined;
  if (shape !== "curved") return { x: point.x, y: point.y };

  const centeredX = point.x * 2 - 1;
  const centeredY = point.y * 2 - 1;
  const sourceRadiusSquared =
    (centeredX * centeredX + centeredY * centeredY) / 2;
  if (sourceRadiusSquared === 0) return { x: 0.5, y: 0.5 };
  const curvatureScale = curvatureScaleFromPercent(curvaturePercent);

  let lowerScale = 0;
  let upperScale = 1;
  for (
    let iteration = 0;
    iteration < CURVATURE_INVERSE_ITERATIONS;
    iteration += 1
  ) {
    const scale = (lowerScale + upperScale) / 2;
    const projectedScale =
      scale * (1 + curvatureScale * sourceRadiusSquared * scale * scale);
    if (projectedScale < 1) lowerScale = scale;
    else upperScale = scale;
  }
  const scale = (lowerScale + upperScale) / 2;
  return {
    x: 0.5 + (centeredX * scale) / 2,
    y: 0.5 + (centeredY * scale) / 2,
  };
}

export function terminalCellFromDisplayPoint({
  columns,
  curvaturePercent = DEFAULT_CURVATURE_PERCENT,
  point,
  rows,
  shape,
}) {
  assertPositiveInteger("columns", columns);
  assertPositiveInteger("rows", rows);
  if (!isUnitPoint(point, false)) return undefined;
  const source = displayPointToSource(point, shape, curvaturePercent);
  if (!isUnitPoint(source, false)) return undefined;
  return {
    x: Math.floor(source.x * columns) + 1,
    y: Math.floor(source.y * rows) + 1,
  };
}

function assertPositiveInteger(label, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function isUnitPoint(point, inclusiveUpperBound) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
  const maximum = inclusiveUpperBound
    ? (coordinate) => coordinate <= 1
    : (coordinate) => coordinate < 1;
  return point.x >= 0 && maximum(point.x) && point.y >= 0 && maximum(point.y);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

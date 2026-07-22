const configurationVersion = 1;
const maximumGuestRealtimeDivisor = 10_000;

export function parseBehaviorPackConfig(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Behavior Pack configuration must be a JSON object.");
  }
  const keys = Object.keys(value);
  for (const key of keys) {
    if (key !== "version" && key !== "guestRealtimeDivisor") {
      throw new Error(`Unknown Behavior Pack configuration field: ${key}`);
    }
  }
  if (value.version !== configurationVersion) {
    throw new Error(
      `Behavior Pack configuration version must be ${String(configurationVersion)}.`,
    );
  }
  if (
    !Number.isSafeInteger(value.guestRealtimeDivisor) ||
    value.guestRealtimeDivisor < 1 ||
    value.guestRealtimeDivisor > maximumGuestRealtimeDivisor
  ) {
    throw new RangeError(
      `guestRealtimeDivisor must be an integer between 1 and ${String(maximumGuestRealtimeDivisor)}.`,
    );
  }
  return Object.freeze({
    guestRealtimeDivisor: value.guestRealtimeDivisor,
    version: configurationVersion,
  });
}

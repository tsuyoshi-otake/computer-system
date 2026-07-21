/**
 * Resolve whether the Web Terminal should emit light without mutating the
 * authoritative terminal buffer. Explicit Display power-off wins, while the
 * lifecycle fallback keeps mixed companion/Behavior Pack versions safe.
 */
export function terminalDisplayPowerState(displayState, lifecycle) {
  return displayState === "off" || lifecycle === "off" ? "off" : "on";
}

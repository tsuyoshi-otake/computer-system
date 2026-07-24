declare const __CS_COLLECT_MICROARCHITECTURE_STATS_BY_DEFAULT__: boolean;
declare const __CS_GUEST_REALTIME_DIVISOR__: number;

/** Build-validated Behavior Pack configuration, applied on server restart. */
export const behaviorPackConfig = Object.freeze({
  collectMicroarchitectureStatsByDefault:
    __CS_COLLECT_MICROARCHITECTURE_STATS_BY_DEFAULT__,
  guestRealtimeDivisor: __CS_GUEST_REALTIME_DIVISOR__,
});

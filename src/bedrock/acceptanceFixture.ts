declare const __CS_ACCEPTANCE_FIXTURE__: boolean;

/**
 * Compile-time-only gate for the isolated MCP acceptance world. Production
 * builds define this as false and retain the normal CS-Linux login flow.
 */
export const acceptanceFixtureBuild = __CS_ACCEPTANCE_FIXTURE__;

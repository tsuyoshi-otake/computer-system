export const cs486Word32DataModel = "cs-word32-v1" as const;
export const cs486Byte8DataModel = "cs-byte8-v1" as const;
export const legacyCs486WordDataModel = "cs486-flat32-word-v1" as const;

export type Cs486DataModel =
  typeof cs486Byte8DataModel | typeof cs486Word32DataModel;

export const cs486DataModels = Object.freeze([
  cs486Word32DataModel,
  cs486Byte8DataModel,
] as const);

export const CS486_FORMAT_COMPATIBILITY = Object.freeze({
  abi: "cs486-cc2",
  archive: Object.freeze({ format: "CS486AR", versions: [1, 2] as const }),
  dataModels: cs486DataModels,
  defaultDataModel: cs486Word32DataModel,
  legacyDataModel: legacyCs486WordDataModel,
  executable: Object.freeze({
    format: "CS486",
    versions: [1, 2, 3, 4, 5, 6] as const,
  }),
  object: Object.freeze({
    format: "CS486OBJ",
    versions: [1, 2, 3, 4] as const,
  }),
});

export function isCs486DataModel(value: unknown): value is Cs486DataModel {
  return cs486DataModels.some((model) => model === value);
}

export function isSupportedCs486ObjectVersion(
  value: unknown,
): value is 1 | 2 | 3 | 4 {
  return CS486_FORMAT_COMPATIBILITY.object.versions.some(
    (version) => version === value,
  );
}

export function isSupportedCs486ExecutableVersion(
  value: unknown,
): value is 1 | 2 | 3 | 4 | 5 | 6 {
  return CS486_FORMAT_COMPATIBILITY.executable.versions.some(
    (version) => version === value,
  );
}

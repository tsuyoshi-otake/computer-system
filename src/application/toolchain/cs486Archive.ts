import { sha256Hex } from "../../domain/crypto/sha256.js";
import { decodeUtf8Chunk, encodeUtf8 } from "../../domain/text/utf8.js";
import {
  CS486_FORMAT_COMPATIBILITY,
  cs486Word32DataModel,
  isCs486DataModel,
  legacyCs486WordDataModel,
  type Cs486DataModel,
} from "../../domain/cpu/cs486Compatibility.js";
import {
  cs486ObjectDataModel,
  isCs486StructuredObject,
  validateCs486Object,
  type Cs486Object,
  type Cs486ObjectRelocation,
  type Cs486ObjectSection,
  type Cs486ObjectSymbol,
} from "../../domain/cpu/cs486Object.js";

export const CS486_ARCHIVE_MARKER = "CS486AR\n";

export const CS486_ARCHIVE_LIMITS = Object.freeze({
  encodedCharacters: 8 * 1_048_576,
  memberNameCharacters: 64,
  members: 128,
  symbols: 8_192,
});

export interface Cs486ArchiveMember {
  readonly digest: string;
  readonly name: string;
  readonly object: Cs486Object;
}

export interface Cs486ArchiveSymbol {
  readonly member: string;
  readonly name: string;
}

export interface Cs486Archive {
  readonly abi: typeof CS486_FORMAT_COMPATIBILITY.abi;
  readonly checksum: string;
  readonly dataModel: Cs486DataModel | typeof legacyCs486WordDataModel;
  readonly format: "cs486-archive";
  readonly members: readonly Cs486ArchiveMember[];
  readonly objectFormat: typeof CS486_FORMAT_COMPATIBILITY.object.format;
  readonly objectVersions: readonly (1 | 2 | 3 | 4)[];
  readonly symbols: readonly Cs486ArchiveSymbol[];
  readonly version: 1 | 2;
}

export type Cs486LinkInput =
  | { readonly kind: "archive"; readonly archive: Cs486Archive }
  | { readonly kind: "object"; readonly object: Cs486Object };

export interface Cs486ArchiveSelection {
  readonly archiveMembersExamined: number;
  readonly objects: readonly Cs486Object[];
  readonly selectedArchiveMembers: readonly string[];
  readonly symbolIndexLookups: number;
}

export class Cs486ArchiveError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "Cs486ArchiveError";
  }
}

export function createCs486Archive(
  members: readonly { readonly name: string; readonly object: Cs486Object }[],
  options: { readonly dataModel?: Cs486DataModel } = {},
): Cs486Archive {
  if (members.length > CS486_ARCHIVE_LIMITS.members) {
    throw new Cs486ArchiveError("archive member limit exceeded");
  }
  const names = new Set<string>();
  let dataModel = options.dataModel;
  const canonicalMembers = [...members]
    .map(({ name, object }): Cs486ArchiveMember => {
      validateArchiveMemberName(name);
      if (names.has(name))
        throw new Cs486ArchiveError(`duplicate archive member '${name}'`);
      names.add(name);
      validateCs486Object(object);
      const memberDataModel = cs486ObjectDataModel(object);
      if (dataModel !== undefined && dataModel !== memberDataModel) {
        throw new Cs486ArchiveError(
          `mixed CS486 data models: ${dataModel} and ${memberDataModel}`,
        );
      }
      dataModel = memberDataModel;
      return { digest: objectDigest(object), name, object };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const symbols = buildSymbolIndex(canonicalMembers);
  const payload = archivePayloadV2(
    canonicalMembers,
    symbols,
    dataModel ?? cs486Word32DataModel,
  );
  const archive: Cs486Archive = {
    ...payload,
    checksum: sha256Hex(JSON.stringify(payload)),
  };
  validateCs486Archive(archive);
  return archive;
}

export function replaceCs486ArchiveMembers(
  archive: Cs486Archive | undefined,
  replacements: readonly {
    readonly name: string;
    readonly object: Cs486Object;
  }[],
): Cs486Archive {
  if (archive !== undefined) validateCs486Archive(archive);
  const members = new Map(
    (archive?.members ?? []).map((member) => [
      member.name,
      { name: member.name, object: member.object },
    ]),
  );
  for (const replacement of replacements) {
    validateArchiveMemberName(replacement.name);
    validateCs486Object(replacement.object);
    members.set(replacement.name, replacement);
  }
  return createCs486Archive([...members.values()], {
    dataModel:
      archive === undefined ? undefined : cs486ArchiveDataModel(archive),
  });
}

export function deleteCs486ArchiveMembers(
  archive: Cs486Archive,
  names: readonly string[],
): Cs486Archive {
  validateCs486Archive(archive);
  const deleted = new Set(names);
  for (const name of deleted) {
    validateArchiveMemberName(name);
    if (!archive.members.some((member) => member.name === name)) {
      throw new Cs486ArchiveError(`archive member not found: ${name}`);
    }
  }
  return createCs486Archive(
    archive.members
      .filter((member) => !deleted.has(member.name))
      .map((member) => ({ name: member.name, object: member.object })),
    { dataModel: cs486ArchiveDataModel(archive) },
  );
}

export function refreshCs486ArchiveIndex(archive: Cs486Archive): Cs486Archive {
  validateCs486Archive(archive);
  return createCs486Archive(
    archive.members.map((member) => ({
      name: member.name,
      object: member.object,
    })),
    { dataModel: cs486ArchiveDataModel(archive) },
  );
}

export function serializeCs486Archive(archive: Cs486Archive): string {
  validateCs486Archive(archive);
  const json = JSON.stringify(archive);
  const compressed = encodeArchiveLzw(json);
  const payload =
    compressed.length + 3 < json.length ? `L1\n${compressed}` : `J1\n${json}`;
  const encoded = `${CS486_ARCHIVE_MARKER}${payload}`;
  if (encoded.length > CS486_ARCHIVE_LIMITS.encodedCharacters) {
    throw new Cs486ArchiveError("archive encoding limit exceeded");
  }
  return encoded;
}

export function parseCs486Archive(encoded: string): Cs486Archive {
  return parseCs486ArchiveInternal(encoded, true);
}

/**
 * Parses an archive whose exact encoded bytes were already matched against a
 * checked-in generated payload. Never use this for mutable guest input.
 */
export function parseCs486ArchiveWithTrustedIntegrity(
  encoded: string,
): Cs486Archive {
  return parseCs486ArchiveInternal(encoded, false);
}

function parseCs486ArchiveInternal(
  encoded: string,
  verifyIntegrity: boolean,
): Cs486Archive {
  if (
    encoded.length > CS486_ARCHIVE_LIMITS.encodedCharacters ||
    !encoded.startsWith(CS486_ARCHIVE_MARKER)
  ) {
    throw new Cs486ArchiveError("not a CS486AR archive");
  }
  let value: unknown;
  try {
    const payload = encoded.slice(CS486_ARCHIVE_MARKER.length);
    const json = payload.startsWith("L1\n")
      ? decodeArchiveLzw(payload.slice(3))
      : payload.startsWith("J1\n")
        ? payload.slice(3)
        : payload;
    value = JSON.parse(json);
  } catch {
    throw new Cs486ArchiveError("invalid CS486AR encoding");
  }
  validateCs486ArchiveValue(value, verifyIntegrity);
  return value;
}

const archiveBase64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const archiveLzwReset = 256;
const archiveLzwFirstDynamic = 257;
const archiveLzwMaximumCode = 65_535;
const archiveMaximumDecodedBytes = 16 * 1_048_576;

function encodeArchiveLzw(value: string): string {
  const input = encodeUtf8(value);
  if (input.length === 0) return "";
  const dictionary = new Map<number, number>();
  const codes: number[] = [];
  let nextCode = archiveLzwFirstDynamic;
  let prefix = input[0]!;
  for (let index = 1; index < input.length; index += 1) {
    const byte = input[index]!;
    const key = prefix * 256 + byte;
    const existing = dictionary.get(key);
    if (existing !== undefined) {
      prefix = existing;
      continue;
    }
    codes.push(prefix);
    if (nextCode <= archiveLzwMaximumCode) {
      dictionary.set(key, nextCode++);
    } else {
      codes.push(archiveLzwReset);
      dictionary.clear();
      nextCode = archiveLzwFirstDynamic;
    }
    prefix = byte;
  }
  codes.push(prefix);
  const bytes = new Uint8Array(codes.length * 2);
  for (const [index, code] of codes.entries()) {
    bytes[index * 2] = code >>> 8;
    bytes[index * 2 + 1] = code & 0xff;
  }
  return encodeArchiveBase64(bytes);
}

function decodeArchiveLzw(value: string): string {
  const encoded = decodeArchiveBase64(value);
  if (encoded.length % 2 !== 0)
    throw new Cs486ArchiveError("invalid CS486AR compressed payload");
  const codes = new Uint16Array(encoded.length / 2);
  for (let index = 0; index < codes.length; index += 1) {
    codes[index] = encoded[index * 2]! * 256 + encoded[index * 2 + 1]!;
  }
  if (codes.length === 0) return "";
  const prefixes = new Uint16Array(archiveLzwMaximumCode + 1);
  const suffixes = new Uint8Array(archiveLzwMaximumCode + 1);
  const stack = new Uint8Array(archiveLzwMaximumCode + 1);
  const output: number[] = [];
  let nextCode = archiveLzwFirstDynamic;
  let previous = -1;
  const expand = (code: number): number => {
    let cursor = code;
    let depth = 0;
    while (cursor >= archiveLzwFirstDynamic) {
      if (cursor >= nextCode || depth >= stack.length) {
        throw new Cs486ArchiveError("invalid CS486AR LZW code");
      }
      stack[depth++] = suffixes[cursor]!;
      cursor = prefixes[cursor]!;
    }
    if (cursor > 255) throw new Cs486ArchiveError("invalid CS486AR LZW prefix");
    const first = cursor;
    output.push(first);
    for (let index = depth - 1; index >= 0; index -= 1) {
      output.push(stack[index]!);
    }
    if (output.length > archiveMaximumDecodedBytes) {
      throw new Cs486ArchiveError("CS486AR decoded payload limit exceeded");
    }
    return first;
  };

  for (const code of codes) {
    if (code === archiveLzwReset) {
      nextCode = archiveLzwFirstDynamic;
      previous = -1;
      continue;
    }
    if (previous < 0) {
      if (code > 255)
        throw new Cs486ArchiveError("invalid CS486AR initial LZW code");
      expand(code);
      previous = code;
      continue;
    }
    let first: number;
    if (code === nextCode) {
      first = expand(previous);
      output.push(first);
    } else {
      first = expand(code);
    }
    if (nextCode <= archiveLzwMaximumCode) {
      prefixes[nextCode] = previous;
      suffixes[nextCode] = first;
      nextCode += 1;
    }
    previous = code;
  }
  const decoded = decodeUtf8Chunk(new Uint8Array(output));
  if (decoded.remainder.length !== 0 || decoded.value.includes("\ufffd")) {
    throw new Cs486ArchiveError("invalid CS486AR UTF-8 payload");
  }
  return decoded.value;
}

function encodeArchiveBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const byte0 = bytes[index]!;
    const byte1 = bytes[index + 1];
    const byte2 = bytes[index + 2];
    output += archiveBase64Alphabet[byte0 >> 2]!;
    output +=
      archiveBase64Alphabet[((byte0 & 0b11) << 4) | ((byte1 ?? 0) >> 4)]!;
    output +=
      byte1 === undefined
        ? "="
        : archiveBase64Alphabet[((byte1 & 0b1111) << 2) | ((byte2 ?? 0) >> 6)]!;
    output +=
      byte2 === undefined ? "=" : archiveBase64Alphabet[byte2 & 0b111111]!;
  }
  return output;
}

function decodeArchiveBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new Cs486ArchiveError("invalid CS486AR base64 payload");
  }
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const block = value.slice(index, index + 4);
    const values = [...block.replace(/=+$/u, "")].map((character) =>
      archiveBase64Alphabet.indexOf(character),
    );
    if (values.length < 2 || values.some((candidate) => candidate < 0)) {
      throw new Cs486ArchiveError("invalid CS486AR base64 block");
    }
    bytes.push((values[0]! << 2) | (values[1]! >> 4));
    if (values.length > 2)
      bytes.push(((values[1]! & 0xf) << 4) | (values[2]! >> 2));
    if (values.length > 3) bytes.push(((values[2]! & 0x3) << 6) | values[3]!);
  }
  return new Uint8Array(bytes);
}

export function validateCs486Archive(
  value: unknown,
): asserts value is Cs486Archive {
  validateCs486ArchiveValue(value, true);
}

function validateCs486ArchiveValue(
  value: unknown,
  verifyIntegrity: boolean,
): asserts value is Cs486Archive {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Cs486ArchiveError("invalid CS486AR archive");
  }
  const archive = value as Partial<Cs486Archive>;
  if (
    archive.format !== "cs486-archive" ||
    (archive.version !== 1 && archive.version !== 2) ||
    archive.abi !== CS486_FORMAT_COMPATIBILITY.abi ||
    (archive.version === 1
      ? archive.dataModel !== legacyCs486WordDataModel
      : !isCs486DataModel(archive.dataModel)) ||
    archive.objectFormat !== CS486_FORMAT_COMPATIBILITY.object.format ||
    !Array.isArray(archive.objectVersions) ||
    (archive.version === 1 && archive.objectVersions.join(",") !== "1,2,3") ||
    !Array.isArray(archive.members) ||
    archive.members.length > CS486_ARCHIVE_LIMITS.members ||
    !Array.isArray(archive.symbols) ||
    archive.symbols.length > CS486_ARCHIVE_LIMITS.symbols ||
    typeof archive.checksum !== "string" ||
    !/^[0-9a-f]{64}$/u.test(archive.checksum)
  ) {
    throw new Cs486ArchiveError("unsupported CS486AR format or data model");
  }

  const memberNames = new Set<string>();
  let previousMemberName: string | undefined;
  for (const candidate of archive.members as readonly unknown[]) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      throw new Cs486ArchiveError("invalid CS486AR member");
    }
    const member = candidate as Partial<Cs486ArchiveMember>;
    validateArchiveMemberName(member.name);
    if (
      memberNames.has(member.name) ||
      (previousMemberName !== undefined &&
        previousMemberName.localeCompare(member.name) >= 0) ||
      typeof member.digest !== "string" ||
      !/^[0-9a-f]{64}$/u.test(member.digest)
    ) {
      throw new Cs486ArchiveError("invalid CS486AR member order or digest");
    }
    validateCs486Object(member.object);
    if (
      (archive.version === 1 && member.object.version === 4) ||
      cs486ObjectDataModel(member.object) !==
        cs486ArchiveDataModel(archive as Cs486Archive)
    ) {
      throw new Cs486ArchiveError("mixed CS486 archive data models");
    }
    if (verifyIntegrity && objectDigest(member.object) !== member.digest) {
      throw new Cs486ArchiveError(`corrupt CS486AR member '${member.name}'`);
    }
    memberNames.add(member.name);
    previousMemberName = member.name;
  }

  const expectedSymbols = buildSymbolIndex(
    archive.members as readonly Cs486ArchiveMember[],
  );
  if (JSON.stringify(archive.symbols) !== JSON.stringify(expectedSymbols)) {
    throw new Cs486ArchiveError("invalid CS486AR symbol index");
  }
  const actualObjectVersions = uniqueObjectVersions(
    archive.members as readonly Cs486ArchiveMember[],
  );
  if (
    archive.version === 2 &&
    JSON.stringify(archive.objectVersions) !==
      JSON.stringify(actualObjectVersions)
  ) {
    throw new Cs486ArchiveError("invalid CS486AR object version table");
  }
  const payload =
    archive.version === 1
      ? archivePayloadV1(
          archive.members as readonly Cs486ArchiveMember[],
          expectedSymbols,
        )
      : archivePayloadV2(
          archive.members as readonly Cs486ArchiveMember[],
          expectedSymbols,
          archive.dataModel as Cs486DataModel,
        );
  if (
    verifyIntegrity &&
    sha256Hex(JSON.stringify(payload)) !== archive.checksum
  ) {
    throw new Cs486ArchiveError("invalid CS486AR checksum");
  }
}

export function selectCs486LinkInputs(
  inputs: readonly Cs486LinkInput[],
): Cs486ArchiveSelection {
  return selectCs486LinkInputsInternal(inputs, true);
}

/** Selects from inputs already admitted by one of the bounded archive parsers. */
export function selectParsedCs486LinkInputs(
  inputs: readonly Cs486LinkInput[],
): Cs486ArchiveSelection {
  return selectCs486LinkInputsInternal(inputs, false);
}

function selectCs486LinkInputsInternal(
  inputs: readonly Cs486LinkInput[],
  verifyIntegrity: boolean,
): Cs486ArchiveSelection {
  validateLinkInputDataModels(inputs, verifyIntegrity);
  const objects: Cs486Object[] = [];
  const defined = new Set<string>();
  const unresolved = new Set<string>();
  const selectedArchiveMembers: string[] = [];
  let archiveMembersExamined = 0;
  let symbolIndexLookups = 0;

  const admitObject = (object: Cs486Object): readonly string[] => {
    validateCs486Object(object);
    const newlyUnresolved: string[] = [];
    for (const symbol of object.symbols) {
      if (symbol.binding === "global") {
        defined.add(symbol.name);
        unresolved.delete(symbol.name);
      } else if (symbol.binding === "undefined" && !defined.has(symbol.name)) {
        if (!unresolved.has(symbol.name)) newlyUnresolved.push(symbol.name);
        unresolved.add(symbol.name);
      }
    }
    objects.push(object);
    return newlyUnresolved;
  };

  for (const input of inputs) {
    if (input.kind === "object") {
      admitObject(input.object);
      continue;
    }
    const memberByName = new Map(
      input.archive.members.map((member) => [member.name, member]),
    );
    const symbolIndex = new Map(
      input.archive.symbols.map((symbol) => [symbol.name, symbol.member]),
    );
    const selected = new Set<string>();
    const queue = [...unresolved];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      if (
        archiveMembersExamined >
        CS486_ARCHIVE_LIMITS.members * inputs.length
      ) {
        throw new Cs486ArchiveError("archive extraction pass limit exceeded");
      }
      const symbol = queue[cursor]!;
      if (!unresolved.has(symbol)) continue;
      symbolIndexLookups += 1;
      const memberName = symbolIndex.get(symbol);
      if (memberName === undefined || selected.has(memberName)) continue;
      const member = memberByName.get(memberName);
      if (member === undefined)
        throw new Cs486ArchiveError(
          "archive index references a missing member",
        );
      selected.add(memberName);
      archiveMembersExamined += 1;
      selectedArchiveMembers.push(memberName);
      const demandedSymbols = [...unresolved].filter(
        (name) => symbolIndex.get(name) === memberName,
      );
      const selectedObject = selectArchiveObjectFunctions(
        member.object,
        demandedSymbols,
      );
      for (const dependency of admitObject(selectedObject))
        queue.push(dependency);
    }
  }

  return {
    archiveMembersExamined,
    objects,
    selectedArchiveMembers,
    symbolIndexLookups,
  };
}

function selectArchiveObjectFunctions(
  object: Cs486Object,
  roots: readonly string[],
): Cs486Object {
  if (!isCs486StructuredObject(object)) return object;
  // Full assembly transcripts are canonical linker evidence. Pruning those
  // objects would make the transcript disagree with their selected sections;
  // large installed libraries already carry an explicitly truncated transcript.
  if (object.assemblyTruncated !== true) return object;
  const text = object.sections.find((section) => section.name === "text");
  if (text?.name !== "text") return object;
  const functions = object.symbols
    .filter(
      (symbol): symbol is Cs486ObjectSymbol & { readonly offset: number } =>
        symbol.binding !== "undefined" &&
        symbol.section === "text" &&
        symbol.type === "function" &&
        symbol.offset !== undefined,
    )
    .sort((left, right) => left.offset - right.offset);
  if (functions.length === 0) return object;
  const functionByName = new Map(
    functions.map((symbol) => [symbol.name, symbol]),
  );
  const ranges = functions.map((symbol, index) => ({
    end: functions[index + 1]?.offset ?? text.instructions.length,
    start: symbol.offset,
    symbol,
  }));
  const rangeByFunction = new Map(
    ranges.map((range) => [range.symbol.name, range]),
  );
  const selected = new Set<string>();
  const queue: string[] = [];
  const enqueue = (name: string): void => {
    if (!functionByName.has(name) || selected.has(name)) return;
    selected.add(name);
    queue.push(name);
  };
  for (const root of roots) enqueue(root);
  for (const relocation of object.relocations) {
    if (
      (relocation.section ?? "text") !== "text" &&
      relocation.type === "function-address"
    ) {
      enqueue(relocation.symbol);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const range = rangeByFunction.get(queue[cursor]!);
    if (range === undefined) continue;
    for (const relocation of object.relocations) {
      const offset = relocation.offset ?? relocation.instructionOffset;
      if (
        (relocation.section ?? "text") === "text" &&
        offset !== undefined &&
        offset >= range.start &&
        offset < range.end
      ) {
        enqueue(relocation.symbol);
      }
    }
  }
  if (selected.size === 0 || selected.size === functions.length) return object;

  const selectedRanges = ranges
    .filter((range) => selected.has(range.symbol.name))
    .sort((left, right) => left.start - right.start);
  const instructionOffsets = new Map<number, number>();
  const instructions = selectedRanges.flatMap((range) =>
    text.instructions
      .slice(range.start, range.end)
      .map((instruction, index) => {
        instructionOffsets.set(range.start + index, instructionOffsets.size);
        return instruction;
      }),
  );
  const textSymbols = object.symbols.flatMap((symbol): Cs486ObjectSymbol[] => {
    if (symbol.section !== "text" || symbol.binding === "undefined") return [];
    const offset =
      symbol.offset === undefined
        ? undefined
        : instructionOffsets.get(symbol.offset);
    return offset === undefined ? [] : [{ ...symbol, offset }];
  });
  const relocations = object.relocations.flatMap(
    (relocation): Cs486ObjectRelocation[] => {
      if ((relocation.section ?? "text") !== "text") return [{ ...relocation }];
      const oldOffset = relocation.offset ?? relocation.instructionOffset;
      const offset =
        oldOffset === undefined ? undefined : instructionOffsets.get(oldOffset);
      if (offset === undefined) return [];
      return [
        {
          ...relocation,
          ...(relocation.offset === undefined ? {} : { offset }),
          ...(relocation.instructionOffset === undefined
            ? {}
            : { instructionOffset: offset }),
        },
      ];
    },
  );
  const referenced = new Set(
    relocations.map((relocation) => relocation.symbol),
  );
  const symbols = [
    ...object.symbols.filter(
      (symbol) => symbol.binding !== "undefined" && symbol.section !== "text",
    ),
    ...textSymbols,
    ...object.symbols.filter(
      (symbol) => symbol.binding === "undefined" && referenced.has(symbol.name),
    ),
  ];
  const sections = object.sections.map((section): Cs486ObjectSection =>
    section.name === "text" ? { ...section, instructions } : section,
  );
  const selectedObject: Cs486Object = {
    ...object,
    relocations,
    sections,
    symbols,
  };
  validateCs486Object(selectedObject);
  return selectedObject;
}

function archivePayloadV1(
  members: readonly Cs486ArchiveMember[],
  symbols: readonly Cs486ArchiveSymbol[],
): Omit<Cs486Archive, "checksum"> {
  return {
    abi: CS486_FORMAT_COMPATIBILITY.abi,
    dataModel: legacyCs486WordDataModel,
    format: "cs486-archive",
    members,
    objectFormat: CS486_FORMAT_COMPATIBILITY.object.format,
    objectVersions: [1, 2, 3],
    symbols,
    version: 1,
  };
}

function archivePayloadV2(
  members: readonly Cs486ArchiveMember[],
  symbols: readonly Cs486ArchiveSymbol[],
  dataModel: Cs486DataModel,
): Omit<Cs486Archive, "checksum"> {
  return {
    abi: CS486_FORMAT_COMPATIBILITY.abi,
    dataModel,
    format: "cs486-archive",
    members,
    objectFormat: CS486_FORMAT_COMPATIBILITY.object.format,
    objectVersions: uniqueObjectVersions(members),
    symbols,
    version: 2,
  };
}

export function cs486ArchiveDataModel(archive: Cs486Archive): Cs486DataModel {
  return archive.version === 1
    ? cs486Word32DataModel
    : (archive.dataModel as Cs486DataModel);
}

function uniqueObjectVersions(
  members: readonly Cs486ArchiveMember[],
): readonly (1 | 2 | 3 | 4)[] {
  return [...new Set(members.map((member) => member.object.version))].sort(
    (left, right) => left - right,
  );
}

function validateLinkInputDataModels(
  inputs: readonly Cs486LinkInput[],
  verifyIntegrity: boolean,
): void {
  let selected: Cs486DataModel | undefined;
  for (const input of inputs) {
    if (input.kind === "archive") {
      validateCs486ArchiveValue(input.archive, verifyIntegrity);
    } else validateCs486Object(input.object);
    const dataModel =
      input.kind === "archive"
        ? cs486ArchiveDataModel(input.archive)
        : cs486ObjectDataModel(input.object);
    if (selected !== undefined && selected !== dataModel) {
      throw new Cs486ArchiveError(
        `mixed CS486 data models: ${selected} and ${dataModel}`,
      );
    }
    selected = dataModel;
  }
}

function buildSymbolIndex(
  members: readonly Cs486ArchiveMember[],
): readonly Cs486ArchiveSymbol[] {
  const symbols: Cs486ArchiveSymbol[] = [];
  const definitions = new Map<string, string>();
  for (const member of members) {
    for (const symbol of member.object.symbols) {
      if (symbol.binding !== "global") continue;
      const previous = definitions.get(symbol.name);
      if (previous !== undefined) {
        throw new Cs486ArchiveError(
          `duplicate archive symbol '${symbol.name}' in '${previous}' and '${member.name}'`,
        );
      }
      definitions.set(symbol.name, member.name);
      symbols.push({ member: member.name, name: symbol.name });
      if (symbols.length > CS486_ARCHIVE_LIMITS.symbols) {
        throw new Cs486ArchiveError("archive symbol limit exceeded");
      }
    }
  }
  return symbols.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.member.localeCompare(right.member),
  );
}

function objectDigest(object: Cs486Object): string {
  return sha256Hex(JSON.stringify(object));
}

function validateArchiveMemberName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > CS486_ARCHIVE_LIMITS.memberNameCharacters ||
    !/^[A-Za-z0-9_.+-]+$/u.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new Cs486ArchiveError("invalid CS486AR member name");
  }
}

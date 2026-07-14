import {
  displayModeSpecification,
  displayProfileSpecification,
  supportsDisplayMode,
  type DisplayModeId,
  type DisplayModeSpecification,
  type DisplayProfileId,
  type DisplayProfileSpecification,
} from "./displayProfile.js";

export type DisplayState =
  | { readonly kind: "off" }
  | { readonly kind: "post"; readonly modeId: "text-80x25" }
  | { readonly kind: "text"; readonly modeId: "text-80x25" }
  | {
      readonly kind: "graphics";
      readonly modeId: Exclude<DisplayModeId, "text-80x25">;
    }
  | { readonly kind: "faulted"; readonly message: string };

export type DisplayTransitionEvent =
  | { readonly kind: "enter_post" }
  | { readonly kind: "select_mode"; readonly modeId: DisplayModeId }
  | { readonly kind: "power_off" }
  | { readonly kind: "fault"; readonly message: string }
  | { readonly kind: "reset" };

export type DisplayTransitionResult =
  | {
      readonly outcome: "changed";
      readonly previous: DisplayState;
      readonly current: DisplayState;
    }
  | {
      readonly outcome: "ignored";
      readonly state: DisplayState;
      readonly reason: "already_off" | "already_selected";
    }
  | {
      readonly outcome: "rejected";
      readonly state: DisplayState;
      readonly reason:
        "faulted" | "invalid_transition" | "powered_off" | "unsupported_mode";
    };

export interface DisplayWriteResult {
  readonly changed: boolean;
  readonly cpuCycles: number;
  readonly revision: number;
}

export interface DisplayTileDelta {
  readonly data: Uint8Array;
  readonly format: "palette-index" | "text-cell";
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface DisplayDirtyBatch {
  readonly modeId: DisplayModeId | undefined;
  readonly outcome: "complete" | "pending";
  readonly payloadBytes: number;
  readonly remaining: number;
  readonly revision: number;
  readonly sequence: number;
  readonly tiles: readonly DisplayTileDelta[];
}

export interface DisplayDeviceOptions {
  readonly maximumPayloadBytesPerBatch?: number;
  readonly maximumTilesPerBatch?: number;
}

const defaultMaximumTilesPerBatch = 64;
const defaultMaximumPayloadBytesPerBatch = 64 * 16 * 16;

/**
 * Transient VGA-compatible display state. Only the small profile identifier is
 * persisted by ComputerRecord; volatile VRAM is rebuilt after every power-on.
 * Dirty marking is O(1), and draining is O(D) for the number of emitted tiles.
 */
export class DisplayDevice {
  readonly profile: DisplayProfileSpecification;
  private readonly maximumTilesPerBatch: number;
  private readonly maximumPayloadBytesPerBatch: number;
  private vramValue: Uint8Array | undefined;
  private stateValue: DisplayState = { kind: "off" };
  private activeModeValue: DisplayModeSpecification | undefined;
  private dirtyFlags = new Uint8Array(0);
  private dirtyQueue = new Int32Array(0);
  private dirtyHead = 0;
  private dirtyTail = 0;
  private dirtyCount = 0;
  private revisionValue = 0;
  private sequenceValue = 0;

  constructor(
    readonly profileId: DisplayProfileId,
    options: DisplayDeviceOptions = {},
  ) {
    this.profile = displayProfileSpecification(profileId);
    this.maximumTilesPerBatch =
      options.maximumTilesPerBatch ?? defaultMaximumTilesPerBatch;
    this.maximumPayloadBytesPerBatch =
      options.maximumPayloadBytesPerBatch ?? defaultMaximumPayloadBytesPerBatch;
    requirePositiveInteger(
      this.maximumTilesPerBatch,
      "Maximum display tiles per batch",
    );
    requirePositiveInteger(
      this.maximumPayloadBytesPerBatch,
      "Maximum display payload bytes per batch",
    );
    if (this.maximumPayloadBytesPerBatch < 16 * 16) {
      throw new RangeError(
        "Maximum display payload bytes per batch must fit one graphics tile",
      );
    }
  }

  get activeMode(): DisplayModeSpecification | undefined {
    return this.activeModeValue;
  }

  get dirtyTileCount(): number {
    return this.dirtyCount;
  }

  get maximumBatchTiles(): number {
    return this.maximumTilesPerBatch;
  }

  get revision(): number {
    return this.revisionValue;
  }

  get state(): DisplayState {
    return this.stateValue;
  }

  get videoMemoryBytes(): number {
    return this.profile.videoMemoryBytes;
  }

  transition(event: DisplayTransitionEvent): DisplayTransitionResult {
    const previous = this.stateValue;
    if (event.kind === "fault") {
      if (event.message.length === 0 || event.message.length > 256) {
        throw new DisplayError(
          "Display fault message must contain 1..256 characters",
        );
      }
      this.clearDirtyQueue();
      this.activeModeValue = undefined;
      this.vramValue = undefined;
      this.stateValue = { kind: "faulted", message: event.message };
      this.revisionValue += 1;
      return { outcome: "changed", previous, current: this.stateValue };
    }
    if (event.kind === "reset") {
      if (previous.kind !== "faulted") {
        return {
          outcome: "rejected",
          state: previous,
          reason: "invalid_transition",
        };
      }
      this.deactivate();
      return { outcome: "changed", previous, current: this.stateValue };
    }
    if (event.kind === "power_off") {
      if (previous.kind === "off") {
        return { outcome: "ignored", state: previous, reason: "already_off" };
      }
      this.deactivate();
      return { outcome: "changed", previous, current: this.stateValue };
    }
    if (previous.kind === "faulted") {
      return { outcome: "rejected", state: previous, reason: "faulted" };
    }
    if (event.kind === "enter_post") {
      if (previous.kind !== "off") {
        return {
          outcome: "rejected",
          state: previous,
          reason: "invalid_transition",
        };
      }
      this.activateMode("text-80x25");
      this.stateValue = { kind: "post", modeId: "text-80x25" };
      this.revisionValue += 1;
      return { outcome: "changed", previous, current: this.stateValue };
    }

    if (previous.kind === "off") {
      return { outcome: "rejected", state: previous, reason: "powered_off" };
    }
    if (!supportsDisplayMode(this.profileId, event.modeId)) {
      return {
        outcome: "rejected",
        state: previous,
        reason: "unsupported_mode",
      };
    }
    if (previous.kind !== "post" && previous.modeId === event.modeId) {
      return {
        outcome: "ignored",
        state: previous,
        reason: "already_selected",
      };
    }
    this.activateMode(event.modeId);
    this.stateValue =
      event.modeId === "text-80x25"
        ? { kind: "text", modeId: event.modeId }
        : { kind: "graphics", modeId: event.modeId };
    this.revisionValue += 1;
    return { outcome: "changed", previous, current: this.stateValue };
  }

  readVramByte(offset: number): number {
    this.requireActive();
    const vram = this.requireVram();
    requireOffset(offset, vram.length);
    return vram[offset]!;
  }

  writeVramByte(offset: number, value: number): DisplayWriteResult {
    this.requireActive();
    const vram = this.requireVram();
    requireOffset(offset, vram.length);
    requireByte(value);
    const changed = this.writeByte(offset, value);
    if (changed) this.revisionValue += 1;
    return this.writeResult(changed, this.profile.byteWriteCycles);
  }

  readTextCell(
    column: number,
    row: number,
  ): {
    readonly attribute: number;
    readonly characterCode: number;
  } {
    const mode = this.requireTextMode();
    requireCoordinate(column, mode.text!.columns, "Text column");
    requireCoordinate(row, mode.text!.rows, "Text row");
    const offset = ((row - 1) * mode.text!.columns + column - 1) * 2;
    const vram = this.requireVram();
    return {
      characterCode: vram[offset]!,
      attribute: vram[offset + 1]!,
    };
  }

  writeTextCell(
    column: number,
    row: number,
    characterCode: number,
    attribute: number,
  ): DisplayWriteResult {
    const mode = this.requireTextMode();
    requireCoordinate(column, mode.text!.columns, "Text column");
    requireCoordinate(row, mode.text!.rows, "Text row");
    requireByte(characterCode);
    requireByte(attribute);
    const offset = ((row - 1) * mode.text!.columns + column - 1) * 2;
    const characterChanged = this.writeByte(offset, characterCode);
    const attributeChanged = this.writeByte(offset + 1, attribute);
    const changed = characterChanged || attributeChanged;
    if (changed) this.revisionValue += 1;
    return this.writeResult(changed, this.profile.byteWriteCycles * 2);
  }

  readPixel(x: number, y: number): number {
    const mode = this.requireGraphicsMode();
    requirePixel(x, y, mode);
    if (mode.pixelFormat === "indexed8") {
      return this.requireVram()[y * mode.width + x]!;
    }
    return this.readPlanarPixel(mode, x, y);
  }

  writePixel(x: number, y: number, color: number): DisplayWriteResult {
    const mode = this.requireGraphicsMode();
    requirePixel(x, y, mode);
    if (!Number.isInteger(color) || color < 0 || color >= mode.colorCount) {
      throw new DisplayError(
        `Pixel color must be between 0 and ${String(mode.colorCount - 1)}`,
      );
    }
    if (mode.pixelFormat === "indexed8") {
      const changed = this.writeByte(y * mode.width + x, color);
      if (changed) this.revisionValue += 1;
      return this.writeResult(changed, this.profile.byteWriteCycles);
    }

    const planeBytes = mode.frameBytes / 4;
    const bytesPerRow = mode.width / 8;
    const byteInPlane = y * bytesPerRow + Math.floor(x / 8);
    const mask = 0x80 >> (x % 8);
    const vram = this.requireVram();
    let changed = false;
    for (let plane = 0; plane < 4; plane += 1) {
      const offset = plane * planeBytes + byteInPlane;
      const previous = vram[offset]!;
      const next =
        (color & (1 << plane)) === 0 ? previous & ~mask : previous | mask;
      changed = this.writeByte(offset, next) || changed;
    }
    if (changed) this.revisionValue += 1;
    return this.writeResult(changed, this.profile.byteWriteCycles * 4);
  }

  requestKeyframe(): number {
    const mode = this.requireActive();
    const count = this.tileCount(mode);
    for (let index = 0; index < count; index += 1) this.markDirty(index);
    return this.dirtyTileCount;
  }

  takeDirtyTiles(limit = this.maximumTilesPerBatch): DisplayDirtyBatch {
    requirePositiveInteger(limit, "Display tile batch limit");
    if (limit > this.maximumTilesPerBatch) {
      throw new DisplayError(
        `Display tile batch limit exceeds ${String(this.maximumTilesPerBatch)}`,
      );
    }
    const mode = this.activeModeValue;
    const tiles: DisplayTileDelta[] = [];
    let payloadBytes = 0;
    while (tiles.length < limit && this.dirtyCount > 0) {
      const index = this.dirtyQueue[this.dirtyHead]!;
      const tile = mode === undefined ? undefined : this.tileDelta(mode, index);
      if (
        tile !== undefined &&
        tiles.length > 0 &&
        payloadBytes + tile.data.byteLength > this.maximumPayloadBytesPerBatch
      ) {
        break;
      }
      this.dirtyHead = (this.dirtyHead + 1) % this.dirtyQueue.length;
      this.dirtyCount -= 1;
      this.dirtyFlags[index] = 0;
      if (tile !== undefined) {
        tiles.push(tile);
        payloadBytes += tile.data.byteLength;
      }
    }
    const remaining = this.dirtyTileCount;
    if (remaining === 0) this.clearDirtyQueue();
    if (tiles.length > 0) this.sequenceValue += 1;
    return {
      modeId: mode?.id,
      outcome: remaining === 0 ? "complete" : "pending",
      payloadBytes,
      remaining,
      revision: this.revisionValue,
      sequence: this.sequenceValue,
      tiles,
    };
  }

  private activateMode(modeId: DisplayModeId): void {
    const mode = displayModeSpecification(modeId);
    if (mode.frameBytes > this.profile.videoMemoryBytes) {
      throw new DisplayError(
        `${modeId} requires ${String(mode.frameBytes)} bytes but ${this.profileId} has ${String(this.profile.videoMemoryBytes)}`,
      );
    }
    this.vramValue ??= new Uint8Array(this.profile.videoMemoryBytes);
    this.vramValue.fill(0, 0, mode.frameBytes);
    this.activeModeValue = mode;
    this.clearDirtyQueue();
    this.dirtyFlags = new Uint8Array(this.tileCount(mode));
    this.dirtyQueue = new Int32Array(this.dirtyFlags.length);
    this.requestKeyframe();
  }

  private clearDirtyQueue(): void {
    this.dirtyFlags.fill(0);
    this.dirtyHead = 0;
    this.dirtyTail = 0;
    this.dirtyCount = 0;
  }

  private deactivate(): void {
    this.vramValue = undefined;
    this.activeModeValue = undefined;
    this.clearDirtyQueue();
    this.stateValue = { kind: "off" };
    this.revisionValue += 1;
  }

  private markByteDirty(offset: number): void {
    const mode = this.activeModeValue;
    if (mode === undefined || offset >= mode.frameBytes) return;
    if (mode.pixelFormat === "text") {
      this.markDirty(Math.floor(offset / 2));
      return;
    }
    if (mode.pixelFormat === "indexed8") {
      const x = offset % mode.width;
      const y = Math.floor(offset / mode.width);
      this.markPixelDirty(mode, x, y);
      return;
    }
    const planeBytes = mode.frameBytes / 4;
    const byteInPlane = offset % planeBytes;
    const bytesPerRow = mode.width / 8;
    const x = (byteInPlane % bytesPerRow) * 8;
    const y = Math.floor(byteInPlane / bytesPerRow);
    this.markPixelDirty(mode, x, y);
  }

  private markDirty(index: number): void {
    if (this.dirtyFlags[index] === 1) return;
    if (this.dirtyCount >= this.dirtyQueue.length) {
      throw new DisplayError("Display dirty queue capacity exceeded");
    }
    this.dirtyFlags[index] = 1;
    this.dirtyQueue[this.dirtyTail] = index;
    this.dirtyTail = (this.dirtyTail + 1) % this.dirtyQueue.length;
    this.dirtyCount += 1;
  }

  private markPixelDirty(
    mode: DisplayModeSpecification,
    x: number,
    y: number,
  ): void {
    const columns = Math.ceil(mode.width / mode.tileWidth);
    const index =
      Math.floor(y / mode.tileHeight) * columns +
      Math.floor(x / mode.tileWidth);
    this.markDirty(index);
  }

  private readPlanarPixel(
    mode: DisplayModeSpecification,
    x: number,
    y: number,
  ): number {
    const planeBytes = mode.frameBytes / 4;
    const bytesPerRow = mode.width / 8;
    const byteInPlane = y * bytesPerRow + Math.floor(x / 8);
    const mask = 0x80 >> (x % 8);
    const vram = this.requireVram();
    let color = 0;
    for (let plane = 0; plane < 4; plane += 1) {
      if ((vram[plane * planeBytes + byteInPlane]! & mask) !== 0) {
        color |= 1 << plane;
      }
    }
    return color;
  }

  private requireActive(): DisplayModeSpecification {
    if (this.activeModeValue === undefined) {
      throw new DisplayError(
        this.stateValue.kind === "faulted"
          ? `Display is faulted: ${this.stateValue.message}`
          : "Display is powered off",
      );
    }
    return this.activeModeValue;
  }

  private requireGraphicsMode(): DisplayModeSpecification {
    const mode = this.requireActive();
    if (mode.pixelFormat === "text") {
      throw new DisplayError("Display is not in a graphics mode");
    }
    return mode;
  }

  private requireVram(): Uint8Array {
    if (this.vramValue === undefined) {
      throw new DisplayError("Display VRAM is not allocated");
    }
    return this.vramValue;
  }

  private requireTextMode(): DisplayModeSpecification {
    const mode = this.requireActive();
    if (mode.pixelFormat !== "text") {
      throw new DisplayError("Display is not in text mode");
    }
    return mode;
  }

  private tileCount(mode: DisplayModeSpecification): number {
    return (
      Math.ceil(mode.width / mode.tileWidth) *
      Math.ceil(mode.height / mode.tileHeight)
    );
  }

  private tileDelta(
    mode: DisplayModeSpecification,
    index: number,
  ): DisplayTileDelta {
    const columns = Math.ceil(mode.width / mode.tileWidth);
    const tileX = index % columns;
    const tileY = Math.floor(index / columns);
    const x = tileX * mode.tileWidth;
    const y = tileY * mode.tileHeight;
    const width = Math.min(mode.tileWidth, mode.width - x);
    const height = Math.min(mode.tileHeight, mode.height - y);
    if (mode.pixelFormat === "text") {
      const cellOffset = index * 2;
      return {
        data: this.requireVram().slice(cellOffset, cellOffset + 2),
        format: "text-cell",
        height,
        width,
        x,
        y,
      };
    }
    const data = new Uint8Array(width * height);
    for (let localY = 0; localY < height; localY += 1) {
      for (let localX = 0; localX < width; localX += 1) {
        data[localY * width + localX] =
          mode.pixelFormat === "indexed8"
            ? this.requireVram()[(y + localY) * mode.width + x + localX]!
            : this.readPlanarPixel(mode, x + localX, y + localY);
      }
    }
    return {
      data,
      format: "palette-index",
      height,
      width,
      x,
      y,
    };
  }

  private writeByte(offset: number, value: number): boolean {
    const vram = this.requireVram();
    if (vram[offset] === value) return false;
    vram[offset] = value;
    this.markByteDirty(offset);
    return true;
  }

  private writeResult(changed: boolean, cpuCycles: number): DisplayWriteResult {
    return { changed, cpuCycles, revision: this.revisionValue };
  }
}

export class DisplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayError";
  }
}

function requireByte(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new DisplayError("Display byte must be between 0 and 255");
  }
}

function requireCoordinate(
  value: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new DisplayError(`${label} must be between 1 and ${String(maximum)}`);
  }
}

function requireOffset(offset: number, length: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset >= length) {
    throw new DisplayError(
      `VRAM offset must be between 0 and ${String(length - 1)}`,
    );
  }
}

function requirePixel(
  x: number,
  y: number,
  mode: DisplayModeSpecification,
): void {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= mode.width ||
    y >= mode.height
  ) {
    throw new DisplayError(
      `Pixel must be within 0..${String(mode.width - 1)}, 0..${String(mode.height - 1)}`,
    );
  }
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

import {
  FloppyMedia,
  floppyMaximumMedia,
  requireMediaId,
  type FloppyMediaSnapshot,
} from "../../domain/storage/floppyMedia.js";

export interface FloppyMediaCatalogSnapshot {
  readonly mediaIds: readonly string[];
  readonly schema: 1;
}

export interface FloppyMediaRepository {
  load(mediaId: string): FloppyMediaSnapshot | undefined;
  loadCatalog(): FloppyMediaCatalogSnapshot | undefined;
  save(snapshot: FloppyMediaSnapshot): number;
  saveCatalog(snapshot: FloppyMediaCatalogSnapshot): number;
}

export interface FloppyMediaItemIdentity {
  readonly instanceGeneration: number;
  readonly mediaId: string;
}

export type FloppyMediaServiceResult =
  | {
      readonly outcome: "created";
      readonly identity: FloppyMediaItemIdentity;
      readonly media: FloppyMedia;
    }
  | {
      readonly outcome: "ejected";
      readonly identity: FloppyMediaItemIdentity;
      readonly media: FloppyMedia;
    }
  | { readonly outcome: "inserted"; readonly media: FloppyMedia }
  | { readonly outcome: "loaded"; readonly media: FloppyMedia }
  | { readonly outcome: "missing"; readonly mediaId: string }
  | { readonly outcome: "failed"; readonly error: Error };

/** Application owner for bounded, identity-safe removable media persistence. */
export class FloppyMediaService {
  private readonly media = new Map<string, FloppyMedia>();
  private readonly catalog = new Set<string>();

  constructor(
    private readonly repository: FloppyMediaRepository,
    private readonly allocateId: () => string,
  ) {
    const catalog = repository.loadCatalog();
    if (catalog !== undefined) {
      validateCatalog(catalog);
      for (const mediaId of catalog.mediaIds) this.catalog.add(mediaId);
    }
  }

  create(): FloppyMediaServiceResult {
    if (this.catalog.size >= floppyMaximumMedia)
      return failed(
        new Error(
          `Floppy media capacity ${String(floppyMaximumMedia)} exceeded`,
        ),
      );
    for (let attempt = 0; attempt < 16; attempt += 1) {
      let mediaId: string;
      try {
        mediaId = requireMediaId(this.allocateId());
      } catch (error: unknown) {
        return failed(error);
      }
      if (this.catalog.has(mediaId)) continue;
      const media = new FloppyMedia(mediaId);
      try {
        this.repository.save(media.snapshot());
        const nextIds = [...this.catalog, mediaId].sort();
        this.repository.saveCatalog({
          mediaIds: Object.freeze(nextIds),
          schema: 1,
        });
        this.catalog.add(mediaId);
        this.media.set(mediaId, media);
        return { outcome: "created", identity: identityOf(media), media };
      } catch (error: unknown) {
        return failed(error);
      }
    }
    return failed(
      new Error("Unable to allocate a unique Floppy media identity"),
    );
  }

  load(mediaId: string): FloppyMediaServiceResult {
    try {
      requireMediaId(mediaId);
      if (!this.catalog.has(mediaId)) return { outcome: "missing", mediaId };
      const existing = this.media.get(mediaId);
      if (existing !== undefined) return { outcome: "loaded", media: existing };
      const snapshot = this.repository.load(mediaId);
      if (snapshot === undefined)
        return failed(
          new Error(`Floppy catalog references missing media ${mediaId}`),
        );
      const media = FloppyMedia.restore(snapshot);
      this.media.set(mediaId, media);
      return { outcome: "loaded", media };
    } catch (error: unknown) {
      return failed(error);
    }
  }

  insert(
    computerId: string,
    identity: FloppyMediaItemIdentity,
  ): FloppyMediaServiceResult {
    const loaded = this.load(identity.mediaId);
    if (loaded.outcome !== "loaded") return loaded;
    const media = loaded.media;
    try {
      media.transaction(() => {
        media.insert(computerId, identity.instanceGeneration);
        this.repository.save(media.snapshot());
      });
      return { outcome: "inserted", media };
    } catch (error: unknown) {
      return failed(error);
    }
  }

  eject(computerId: string, mediaId: string): FloppyMediaServiceResult {
    const loaded = this.load(mediaId);
    if (loaded.outcome !== "loaded") return loaded;
    const media = loaded.media;
    try {
      media.transaction(() => {
        media.eject(computerId);
        this.repository.save(media.snapshot());
      });
      return { outcome: "ejected", identity: identityOf(media), media };
    } catch (error: unknown) {
      return failed(error);
    }
  }

  save(media: FloppyMedia): FloppyMediaServiceResult {
    if (!this.catalog.has(media.mediaId))
      return { outcome: "missing", mediaId: media.mediaId };
    try {
      this.repository.save(media.snapshot());
      this.media.set(media.mediaId, media);
      return { outcome: "loaded", media };
    } catch (error: unknown) {
      return failed(error);
    }
  }

  mediaCount(): number {
    return this.catalog.size;
  }
}

export function isFloppyMediaCatalogSnapshot(
  value: unknown,
): value is FloppyMediaCatalogSnapshot {
  try {
    validateCatalog(value);
    return true;
  } catch {
    return false;
  }
}

function validateCatalog(
  value: unknown,
): asserts value is FloppyMediaCatalogSnapshot {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { schema?: unknown }).schema !== 1 ||
    !Array.isArray((value as { mediaIds?: unknown }).mediaIds)
  )
    throw new TypeError("Invalid Floppy media catalog");
  const candidate = value as { mediaIds: unknown[]; schema: 1 };
  if (candidate.mediaIds.length > floppyMaximumMedia)
    throw new RangeError("Floppy media catalog capacity exceeded");
  const ids = candidate.mediaIds.map((id) => {
    if (typeof id !== "string")
      throw new TypeError("Invalid Floppy media catalog identity");
    return requireMediaId(id);
  });
  if (new Set(ids).size !== ids.length)
    throw new TypeError("Duplicate Floppy media catalog identity");
  if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id))
    throw new TypeError("Floppy media catalog is not canonical");
  if (Object.keys(candidate).sort().join(",") !== "mediaIds,schema")
    throw new TypeError("Invalid Floppy media catalog fields");
}

function identityOf(media: FloppyMedia): FloppyMediaItemIdentity {
  return Object.freeze({
    instanceGeneration: media.instanceGeneration,
    mediaId: media.mediaId,
  });
}

function failed(
  error: unknown,
): Extract<FloppyMediaServiceResult, { outcome: "failed" }> {
  return {
    outcome: "failed",
    error: error instanceof Error ? error : new Error(String(error)),
  };
}

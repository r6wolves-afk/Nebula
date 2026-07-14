import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type { AuthUser, GalleryMedia, GalleryMediaKind, GalleryTimelineYear, GalleryVisibility } from "@nebula/shared";

const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const galleryDir = path.join(dataDir, "gallery");
const mediaDir = path.join(galleryDir, "media");
const galleryIndexPath = path.join(galleryDir, "gallery.json");

async function quarantineCorruptGalleryIndex(error: unknown) {
  const quarantinePath = path.join(galleryDir, `gallery.corrupt-${Date.now()}.json`);

  try {
    await rename(galleryIndexPath, quarantinePath);
    console.warn(`Gallery index was malformed and has been moved to ${quarantinePath}`, error);
  } catch (renameError) {
    if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Gallery index was malformed and could not be quarantined", renameError);
    }
  }
}

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const supportedVideoTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);

type StoredGalleryMedia = Omit<GalleryMedia, "contentUrl" | "thumbnailUrl"> & {
  storedName: string;
};

type GalleryListOptions = {
  scope?: "private" | "shared" | "all";
  year?: number;
  month?: number;
};

function normalizeFilename(filename: string | undefined, fallback: string) {
  const cleanName = path.basename(filename?.trim() || fallback).replace(/[\r\n]/g, " ").trim();
  return cleanName || fallback;
}

function mediaKindForMime(mimeType: string): GalleryMediaKind | undefined {
  if (supportedImageTypes.has(mimeType)) {
    return "image";
  }

  if (supportedVideoTypes.has(mimeType)) {
    return "video";
  }

  return undefined;
}

function publicMedia(record: StoredGalleryMedia): GalleryMedia {
  const { storedName: _storedName, ...media } = record;
  return {
    ...media,
    contentUrl: `/api/gallery/media/${record.id}/content`
  };
}

async function readGalleryIndex(): Promise<StoredGalleryMedia[]> {
  try {
    const parsed = JSON.parse((await readFile(galleryIndexPath, "utf8")).replace(/^\uFEFF/, "")) as unknown;
    if (!Array.isArray(parsed)) {
      await quarantineCorruptGalleryIndex(new Error("Gallery index must be an array"));
      return [];
    }

    return parsed as StoredGalleryMedia[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    if (error instanceof SyntaxError) {
      await quarantineCorruptGalleryIndex(error);
      return [];
    }

    throw error;
  }
}

async function writeGalleryIndex(media: StoredGalleryMedia[]) {
  await mkdir(galleryDir, { recursive: true });
  const tempPath = path.join(galleryDir, `gallery.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, JSON.stringify(media, null, 2), "utf8");
  await rename(tempPath, galleryIndexPath);
}

function canViewGalleryMedia(user: AuthUser, media: StoredGalleryMedia) {
  return media.visibility === "shared" || media.ownerUserId === user.id;
}

function canManageGalleryMedia(user: AuthUser, media: StoredGalleryMedia) {
  return media.ownerUserId === user.id || (user.role === "admin" && media.visibility === "shared");
}

function dateParts(date: Date) {
  return {
    capturedAt: date.toISOString(),
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1
  };
}

function parseExifDate(value: string) {
  const match = value.trim().match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readTiffUInt16(buffer: Buffer, offset: number, littleEndian: boolean) {
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readTiffUInt32(buffer: Buffer, offset: number, littleEndian: boolean) {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function readExifAscii(buffer: Buffer, tiffStart: number, valueOffset: number, count: number) {
  const start = tiffStart + valueOffset;
  if (start < 0 || start + count > buffer.length) {
    return undefined;
  }

  return buffer.subarray(start, start + count).toString("ascii").replace(/\0+$/, "");
}

function readExifDateFromIfd(buffer: Buffer, tiffStart: number, ifdOffset: number, littleEndian: boolean): Date | undefined {
  const ifdStart = tiffStart + ifdOffset;
  if (ifdStart < 0 || ifdStart + 2 > buffer.length) {
    return undefined;
  }

  const entryCount = readTiffUInt16(buffer, ifdStart, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdStart + 2 + index * 12;
    if (entryOffset + 12 > buffer.length) {
      return undefined;
    }

    const tag = readTiffUInt16(buffer, entryOffset, littleEndian);
    const type = readTiffUInt16(buffer, entryOffset + 2, littleEndian);
    const count = readTiffUInt32(buffer, entryOffset + 4, littleEndian);
    const valueOffset = readTiffUInt32(buffer, entryOffset + 8, littleEndian);

    if ((tag === 0x9003 || tag === 0x9004 || tag === 0x0132) && type === 2) {
      const value = count <= 4
        ? buffer.subarray(entryOffset + 8, entryOffset + 8 + count).toString("ascii").replace(/\0+$/, "")
        : readExifAscii(buffer, tiffStart, valueOffset, count);
      const date = value ? parseExifDate(value) : undefined;
      if (date) {
        return date;
      }
    }

    if (tag === 0x8769) {
      const date: Date | undefined = readExifDateFromIfd(buffer, tiffStart, valueOffset, littleEndian);
      if (date) {
        return date;
      }
    }
  }

  return undefined;
}

function readJpegExifDate(buffer: Buffer): Date | undefined {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return undefined;
    }

    const marker = buffer[offset + 1];
    const segmentLength = buffer.readUInt16BE(offset + 2);
    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + segmentLength;

    if (marker === 0xe1 && buffer.subarray(segmentStart, segmentStart + 6).toString("ascii") === "Exif\0\0") {
      const tiffStart = segmentStart + 6;
      const byteOrder = buffer.subarray(tiffStart, tiffStart + 2).toString("ascii");
      const littleEndian = byteOrder === "II";
      if (!littleEndian && byteOrder !== "MM") {
        return undefined;
      }

      const firstIfdOffset = readTiffUInt32(buffer, tiffStart + 4, littleEndian);
      return readExifDateFromIfd(buffer, tiffStart, firstIfdOffset, littleEndian);
    }

    offset = segmentEnd;
  }

  return undefined;
}

function readImageDimensions(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/png" && buffer.length >= 24 && buffer.subarray(1, 4).toString("ascii") === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (mimeType === "image/gif" && buffer.length >= 10 && buffer.subarray(0, 3).toString("ascii") === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  if (mimeType === "image/webp" && buffer.length >= 30 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunkType = buffer.subarray(12, 16).toString("ascii");
    if (chunkType === "VP8X" && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      };
    }
  }

  if (mimeType === "image/jpeg" && buffer.length >= 4 && buffer.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        break;
      }

      const marker = buffer[offset + 1];
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5)
        };
      }

      offset += 2 + segmentLength;
    }
  }

  return {};
}

async function mediaMetadata(filePath: string, mimeType: string) {
  const fileStat = await stat(filePath);
  const buffer = await readFile(filePath);
  const exifDate = mimeType === "image/jpeg" ? readJpegExifDate(buffer) : undefined;
  const capturedDate = exifDate ?? fileStat.birthtime ?? fileStat.mtime ?? new Date();
  return {
    ...readImageDimensions(buffer, mimeType),
    ...dateParts(capturedDate)
  };
}

function applyGalleryFilters(user: AuthUser, records: StoredGalleryMedia[], options: GalleryListOptions = {}) {
  const scope = options.scope ?? "all";
  return records
    .filter((media) => canViewGalleryMedia(user, media))
    .filter((media) => scope === "all" || media.visibility === scope)
    .filter((media) => options.year === undefined || media.year === options.year)
    .filter((media) => options.month === undefined || media.month === options.month)
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
}

export function isSupportedGalleryMimeType(mimeType: string) {
  return Boolean(mediaKindForMime(mimeType));
}

export async function listGalleryMedia(user: AuthUser, options: GalleryListOptions = {}) {
  return applyGalleryFilters(user, await readGalleryIndex(), options).map(publicMedia);
}

export async function getGalleryTimeline(user: AuthUser, scope: GalleryListOptions["scope"] = "all"): Promise<GalleryTimelineYear[]> {
  const records = applyGalleryFilters(user, await readGalleryIndex(), { scope });
  const years = new Map<number, Map<number, number>>();

  for (const media of records) {
    const months = years.get(media.year) ?? new Map<number, number>();
    months.set(media.month, (months.get(media.month) ?? 0) + 1);
    years.set(media.year, months);
  }

  return [...years.entries()]
    .sort(([leftYear], [rightYear]) => rightYear - leftYear)
    .map(([year, months]) => ({
      year,
      months: [...months.entries()]
        .sort(([leftMonth], [rightMonth]) => rightMonth - leftMonth)
        .map(([month, count]) => ({ month, count }))
    }));
}

export async function saveGalleryUpload({
  filename,
  mimeType,
  owner,
  stream,
  visibility
}: {
  filename?: string;
  mimeType?: string;
  owner: AuthUser;
  stream: NodeJS.ReadableStream;
  visibility: GalleryVisibility;
}) {
  const resolvedMimeType = mimeType || "application/octet-stream";
  const kind = mediaKindForMime(resolvedMimeType);
  if (!kind) {
    return { status: "unsupported-type" as const };
  }

  const id = randomUUID();
  const normalizedFilename = normalizeFilename(filename, kind === "image" ? "image" : "video");
  const storedName = `${id}-${normalizedFilename}`;
  const filePath = path.join(mediaDir, owner.id, storedName);

  await mkdir(path.dirname(filePath), { recursive: true });
  await pipeline(stream, createWriteStream(filePath));

  const fileStat = await stat(filePath);
  const now = new Date().toISOString();
  const metadata = await mediaMetadata(filePath, resolvedMimeType);
  const records = await readGalleryIndex();
  const record: StoredGalleryMedia = {
    id,
    ownerUserId: owner.id,
    ownerDisplayName: owner.displayName,
    kind,
    visibility,
    filename: normalizedFilename,
    mimeType: resolvedMimeType,
    size: fileStat.size,
    ...metadata,
    storedName,
    createdAt: now,
    updatedAt: now
  };

  await writeGalleryIndex([record, ...records]);
  return { status: "ok" as const, media: publicMedia(record) };
}

export async function getVisibleGalleryMedia(user: AuthUser, mediaId: string) {
  const records = await readGalleryIndex();
  const media = records.find((record) => record.id === mediaId);

  if (!media || !canViewGalleryMedia(user, media)) {
    return undefined;
  }

  return {
    media: publicMedia(media),
    filePath: path.join(mediaDir, media.ownerUserId, media.storedName)
  };
}

export async function setGalleryMediaVisibility(user: AuthUser, mediaId: string, visibility: GalleryVisibility) {
  const records = await readGalleryIndex();
  const media = records.find((record) => record.id === mediaId);

  if (!media) {
    return { status: "not-found" as const };
  }

  if (!canManageGalleryMedia(user, media)) {
    return { status: "forbidden" as const };
  }

  const updatedMedia: StoredGalleryMedia = {
    ...media,
    visibility,
    updatedAt: new Date().toISOString()
  };
  await writeGalleryIndex(records.map((record) => record.id === mediaId ? updatedMedia : record));
  return { status: "ok" as const, media: publicMedia(updatedMedia) };
}

export async function setGalleryMediaVisibilityBulk(user: AuthUser, mediaIds: string[], visibility: GalleryVisibility) {
  const requestedIds = [...new Set(mediaIds)];
  const requestedIdSet = new Set(requestedIds);
  const records = await readGalleryIndex();
  const foundIds = new Set<string>();
  const forbiddenIds: string[] = [];
  const updatedMedia: GalleryMedia[] = [];
  const now = new Date().toISOString();

  const nextRecords = records.map((record) => {
    if (!requestedIdSet.has(record.id)) {
      return record;
    }

    foundIds.add(record.id);
    if (!canManageGalleryMedia(user, record)) {
      forbiddenIds.push(record.id);
      return record;
    }

    const updatedRecord: StoredGalleryMedia = {
      ...record,
      visibility,
      updatedAt: now
    };
    updatedMedia.push(publicMedia(updatedRecord));
    return updatedRecord;
  });

  if (updatedMedia.length > 0) {
    await writeGalleryIndex(nextRecords);
  }

  return {
    media: updatedMedia,
    forbiddenIds,
    notFoundIds: requestedIds.filter((id) => !foundIds.has(id))
  };
}

export async function deleteGalleryMedia(user: AuthUser, mediaId: string) {
  const records = await readGalleryIndex();
  const media = records.find((record) => record.id === mediaId);

  if (!media) {
    return "not-found" as const;
  }

  if (!canManageGalleryMedia(user, media)) {
    return "forbidden" as const;
  }

  await writeGalleryIndex(records.filter((record) => record.id !== mediaId));
  await rm(path.join(mediaDir, media.ownerUserId, media.storedName), { force: true });
  return "deleted" as const;
}

export async function deleteGalleryMediaBulk(user: AuthUser, mediaIds: string[]) {
  const requestedIds = [...new Set(mediaIds)];
  const requestedIdSet = new Set(requestedIds);
  const records = await readGalleryIndex();
  const foundIds = new Set<string>();
  const forbiddenIds: string[] = [];
  const deletedIds: string[] = [];
  const deletedFilePaths: string[] = [];

  const nextRecords = records.filter((record) => {
    if (!requestedIdSet.has(record.id)) {
      return true;
    }

    foundIds.add(record.id);
    if (!canManageGalleryMedia(user, record)) {
      forbiddenIds.push(record.id);
      return true;
    }

    deletedIds.push(record.id);
    deletedFilePaths.push(path.join(mediaDir, record.ownerUserId, record.storedName));
    return false;
  });

  if (deletedIds.length > 0) {
    await writeGalleryIndex(nextRecords);
    await Promise.all(deletedFilePaths.map((filePath) => rm(filePath, { force: true })));
  }

  return {
    deletedIds,
    forbiddenIds,
    notFoundIds: requestedIds.filter((id) => !foundIds.has(id))
  };
}
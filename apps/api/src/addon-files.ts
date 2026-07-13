import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type { AddonFileEntry, AddonFileRecord, AddonFileShare, AddonFolderRecord } from "@nebula/shared";

const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const filesDir = path.join(dataDir, "addon-files");
const sharesPath = path.join(dataDir, "addon-file-shares.json");

type StoredAddonFileRecord = AddonFileRecord & {
  storedName: string;
};

type StoredAddonFileEntry = StoredAddonFileRecord | AddonFolderRecord;
type EntryMutationResult =
  | { status: "ok"; entry: AddonFileEntry }
  | { status: "not-found" | "invalid-parent" | "cycle" | "duplicate-name" };
type ShareMutationResult =
  | { status: "ok"; share: AddonFileShare }
  | { status: "not-found" | "invalid-target" | "duplicate-share" };

function resolveAddonFilesDir(userId: string, addonId: string) {
  return path.join(filesDir, "users", userId, addonId);
}

function resolveIndexPath(userId: string, addonId: string) {
  return path.join(resolveAddonFilesDir(userId, addonId), "files.json");
}

function resolveFilePath(userId: string, addonId: string, storedName: string) {
  return path.join(resolveAddonFilesDir(userId, addonId), "objects", storedName);
}

function publicEntry(record: StoredAddonFileEntry): AddonFileEntry {
  if (record.type === "folder") {
    return record;
  }

  return {
    id: record.id,
    type: "file",
    name: record.name,
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.size,
    parentId: record.parentId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function normalizeName(name: string | undefined, fallback: string) {
  const baseName = path.basename(name?.trim() || fallback).replace(/[\r\n]/g, " ").trim();
  return baseName || fallback;
}

function legacyFile(record: Partial<StoredAddonFileRecord> & { id: string; filename: string; mimeType: string; size: number; createdAt: string; storedName?: string }): StoredAddonFileRecord {
  return {
    id: record.id,
    type: "file",
    name: record.name || record.filename,
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.size,
    parentId: record.parentId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || record.createdAt,
    storedName: record.storedName || record.id
  };
}

function normalizeEntry(record: StoredAddonFileEntry | (Partial<StoredAddonFileRecord> & { id: string; filename: string; mimeType: string; size: number; createdAt: string })): StoredAddonFileEntry {
  if (record.type === "folder") {
    return {
      id: record.id,
      type: "folder",
      name: record.name,
      parentId: record.parentId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt || record.createdAt
    };
  }

  return legacyFile(record);
}

async function readIndex(userId: string, addonId: string): Promise<StoredAddonFileEntry[]> {
  try {
    const rawEntries = JSON.parse((await readFile(resolveIndexPath(userId, addonId), "utf8")).replace(/^\uFEFF/, "")) as Array<StoredAddonFileEntry | (Partial<StoredAddonFileRecord> & { id: string; filename: string; mimeType: string; size: number; createdAt: string })>;
    return rawEntries.map(normalizeEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readShares(): Promise<AddonFileShare[]> {
  try {
    return JSON.parse((await readFile(sharesPath, "utf8")).replace(/^\uFEFF/, "")) as AddonFileShare[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeShares(shares: AddonFileShare[]) {
  await mkdir(path.dirname(sharesPath), { recursive: true });
  await writeFile(sharesPath, JSON.stringify(shares, null, 2), "utf8");
}

async function writeIndex(userId: string, addonId: string, entries: StoredAddonFileEntry[]) {
  const indexPath = resolveIndexPath(userId, addonId);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify(entries, null, 2), "utf8");
}

function parentExists(entries: StoredAddonFileEntry[], parentId: string | null) {
  return parentId === null || entries.some((entry) => entry.type === "folder" && entry.id === parentId);
}

function nameExists(entries: StoredAddonFileEntry[], parentId: string | null, name: string, exceptId?: string) {
  return entries.some((entry) => entry.parentId === parentId && entry.id !== exceptId && entry.name.toLowerCase() === name.toLowerCase());
}

function collectDescendantIds(entries: StoredAddonFileEntry[], folderId: string) {
  const descendants = new Set<string>();
  const visit = (parentId: string) => {
    for (const entry of entries.filter((candidate) => candidate.parentId === parentId)) {
      descendants.add(entry.id);
      if (entry.type === "folder") {
        visit(entry.id);
      }
    }
  };

  visit(folderId);
  return descendants;
}

function isEntryInsideFolder(entries: StoredAddonFileEntry[], entryId: string, folderId: string) {
  let current = entries.find((entry) => entry.id === entryId);

  while (current?.parentId) {
    if (current.parentId === folderId) {
      return true;
    }

    current = entries.find((entry) => entry.id === current?.parentId);
  }

  return false;
}

function visibleShareMatchesEntry(share: AddonFileShare, entries: StoredAddonFileEntry[], entryId: string) {
  if (share.entryId === entryId) {
    return true;
  }

  const sharedRoot = entries.find((entry) => entry.id === share.entryId);
  return sharedRoot?.type === "folder" && isEntryInsideFolder(entries, entryId, sharedRoot.id);
}

function breadcrumbs(entries: StoredAddonFileEntry[], folderId: string | null) {
  const trail: AddonFolderRecord[] = [];
  let currentId = folderId;

  while (currentId) {
    const folder = entries.find((entry): entry is AddonFolderRecord => entry.type === "folder" && entry.id === currentId);
    if (!folder) {
      break;
    }

    trail.unshift(publicEntry(folder) as AddonFolderRecord);
    currentId = folder.parentId;
  }

  return trail;
}

export async function listAddonFileEntries(userId: string, addonId: string, parentId: string | null = null) {
  const entries = await readIndex(userId, addonId);
  const folder = parentId ? entries.find((entry): entry is AddonFolderRecord => entry.type === "folder" && entry.id === parentId) : null;

  if (parentId && !folder) {
    return undefined;
  }

  return {
    entries: entries.filter((entry) => entry.parentId === parentId).map(publicEntry),
    currentFolder: folder ? publicEntry(folder) as AddonFolderRecord : null,
    breadcrumbs: breadcrumbs(entries, parentId),
    allEntries: entries.map(publicEntry)
  };
}

export async function createAddonFolder(userId: string, addonId: string, name: string, parentId: string | null = null): Promise<EntryMutationResult> {
  const entries = await readIndex(userId, addonId);
  const folderName = normalizeName(name, "New Folder");

  if (!parentExists(entries, parentId)) {
    return { status: "invalid-parent" };
  }

  if (nameExists(entries, parentId, folderName)) {
    return { status: "duplicate-name" };
  }

  const now = new Date().toISOString();
  const folder: AddonFolderRecord = {
    id: randomUUID(),
    type: "folder",
    name: folderName,
    parentId,
    createdAt: now,
    updatedAt: now
  };

  await writeIndex(userId, addonId, [folder, ...entries]);
  return { status: "ok", entry: folder };
}

export async function saveAddonFile({
  addonId,
  filename,
  mimeType,
  parentId,
  stream,
  userId
}: {
  addonId: string;
  filename?: string;
  mimeType?: string;
  parentId?: string | null;
  stream: NodeJS.ReadableStream;
  userId: string;
}): Promise<EntryMutationResult> {
  const entries = await readIndex(userId, addonId);
  const targetParentId = parentId ?? null;
  const fileName = normalizeName(filename, "upload.bin");

  if (!parentExists(entries, targetParentId)) {
    return { status: "invalid-parent" };
  }

  if (nameExists(entries, targetParentId, fileName)) {
    return { status: "duplicate-name" };
  }

  const fileId = randomUUID();
  const storedName = fileId;
  const targetPath = resolveFilePath(userId, addonId, storedName);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await pipeline(stream, createWriteStream(targetPath));
  const fileStat = await stat(targetPath);
  const now = new Date().toISOString();

  const record: StoredAddonFileRecord = {
    id: fileId,
    type: "file",
    name: fileName,
    filename: fileName,
    mimeType: mimeType || "application/octet-stream",
    size: fileStat.size,
    parentId: targetParentId,
    createdAt: now,
    updatedAt: now,
    storedName
  };

  await writeIndex(userId, addonId, [record, ...entries]);
  return { status: "ok", entry: publicEntry(record) };
}

export async function updateAddonFileEntry(userId: string, addonId: string, entryId: string, updates: { name?: string; parentId?: string | null }): Promise<EntryMutationResult> {
  const entries = await readIndex(userId, addonId);
  const entry = entries.find((candidate) => candidate.id === entryId);

  if (!entry) {
    return { status: "not-found" };
  }

  const nextParentId = updates.parentId === undefined ? entry.parentId : updates.parentId;
  const nextName = updates.name === undefined ? entry.name : normalizeName(updates.name, entry.name);

  if (!parentExists(entries, nextParentId)) {
    return { status: "invalid-parent" };
  }

  if (entry.type === "folder") {
    const descendants = collectDescendantIds(entries, entry.id);
    if (nextParentId === entry.id || (nextParentId && descendants.has(nextParentId))) {
      return { status: "cycle" };
    }
  }

  if (nameExists(entries, nextParentId, nextName, entry.id)) {
    return { status: "duplicate-name" };
  }

  const updatedEntry: StoredAddonFileEntry = {
    ...entry,
    name: nextName,
    parentId: nextParentId,
    updatedAt: new Date().toISOString(),
    ...(entry.type === "file" ? { filename: nextName } : {})
  };
  await writeIndex(userId, addonId, entries.map((candidate) => candidate.id === entryId ? updatedEntry : candidate));

  return { status: "ok", entry: publicEntry(updatedEntry) };
}

export async function getAddonFile(userId: string, addonId: string, fileId: string) {
  const entries = await readIndex(userId, addonId);
  const record = entries.find((entry): entry is StoredAddonFileRecord => entry.type === "file" && entry.id === fileId);

  if (!record) {
    return undefined;
  }

  return {
    file: publicEntry(record) as AddonFileRecord,
    filePath: resolveFilePath(userId, addonId, record.storedName)
  };
}

export async function getSharedAddonFile(userId: string, addonId: string, fileId: string) {
  const shares = await readShares();
  const matchingShares = shares.filter((share) =>
    share.addonId === addonId &&
    share.ownerUserId !== userId &&
    (share.scope === "server" || share.targetUserId === userId)
  );

  for (const share of matchingShares) {
    const entries = await readIndex(share.ownerUserId, addonId);
    if (!visibleShareMatchesEntry(share, entries, fileId)) {
      continue;
    }

    const record = entries.find((entry): entry is StoredAddonFileRecord => entry.type === "file" && entry.id === fileId);
    if (!record) {
      continue;
    }

    const storedFile = {
      file: publicEntry(record) as AddonFileRecord,
      filePath: resolveFilePath(share.ownerUserId, addonId, record.storedName)
    };
    if (storedFile) {
      return { ...storedFile, share };
    }
  }

  return undefined;
}

export async function listSharedAddonFileEntries(userId: string, addonId: string, shareId: string, parentId?: string | null) {
  const shares = await readShares();
  const share = shares.find((candidate) =>
    candidate.id === shareId &&
    candidate.addonId === addonId &&
    candidate.ownerUserId !== userId &&
    (candidate.scope === "server" || candidate.targetUserId === userId)
  );

  if (!share) {
    return undefined;
  }

  const entries = await readIndex(share.ownerUserId, addonId);
  const sharedRoot = entries.find((entry): entry is AddonFolderRecord => entry.type === "folder" && entry.id === share.entryId);
  if (!sharedRoot) {
    return undefined;
  }

  const targetParentId = parentId ?? sharedRoot.id;
  const targetFolder = entries.find((entry): entry is AddonFolderRecord => entry.type === "folder" && entry.id === targetParentId);
  if (!targetFolder || (targetParentId !== sharedRoot.id && !isEntryInsideFolder(entries, targetParentId, sharedRoot.id))) {
    return undefined;
  }

  const allowedEntries = entries.filter((entry) => entry.id === sharedRoot.id || isEntryInsideFolder(entries, entry.id, sharedRoot.id));
  const fullBreadcrumbs = breadcrumbs(entries, targetParentId);
  const rootIndex = fullBreadcrumbs.findIndex((folder) => folder.id === sharedRoot.id);
  const sharedBreadcrumbs = rootIndex >= 0 ? fullBreadcrumbs.slice(rootIndex) : [publicEntry(sharedRoot) as AddonFolderRecord];

  return {
    share,
    entries: entries.filter((entry) => entry.parentId === targetParentId).map(publicEntry),
    currentFolder: publicEntry(targetFolder) as AddonFolderRecord,
    breadcrumbs: sharedBreadcrumbs,
    allEntries: allowedEntries.map(publicEntry)
  };
}

export async function createAddonFileShare({
  addonId,
  entryId,
  ownerUserId,
  scope,
  targetUserId
}: {
  addonId: string;
  entryId: string;
  ownerUserId: string;
  scope: "user" | "server";
  targetUserId?: string;
}): Promise<ShareMutationResult> {
  const entries = await readIndex(ownerUserId, addonId);
  if (!entries.some((entry) => entry.id === entryId)) {
    return { status: "not-found" };
  }

  if (scope === "user" && (!targetUserId || targetUserId === ownerUserId)) {
    return { status: "invalid-target" };
  }

  const shares = await readShares();
  const duplicateShare = shares.some((share) =>
    share.addonId === addonId &&
    share.entryId === entryId &&
    share.ownerUserId === ownerUserId &&
    share.scope === scope &&
    (scope === "server" || share.targetUserId === targetUserId)
  );

  if (duplicateShare) {
    return { status: "duplicate-share" };
  }

  const share: AddonFileShare = {
    id: randomUUID(),
    addonId,
    entryId,
    ownerUserId,
    scope,
    targetUserId: scope === "user" ? targetUserId : undefined,
    permission: "viewer",
    createdAt: new Date().toISOString()
  };

  await writeShares([share, ...shares]);
  return { status: "ok", share };
}

export async function listAddonFileSharesByMe(userId: string, addonId: string) {
  const shares = await readShares();
  const ownedShares = shares.filter((share) => share.addonId === addonId && share.ownerUserId === userId);
  const entries = await readIndex(userId, addonId);

  return ownedShares
    .map((share) => ({
      share,
      entry: entries.find((entry) => entry.id === share.entryId)
    }))
    .filter((sharedEntry): sharedEntry is { share: AddonFileShare; entry: StoredAddonFileEntry } => Boolean(sharedEntry.entry))
    .map(({ share, entry }) => ({ share, entry: publicEntry(entry) }));
}

export async function listAddonFileSharesWithMe(userId: string, addonId: string) {
  const shares = await readShares();
  const visibleShares = shares.filter((share) =>
    share.addonId === addonId &&
    share.ownerUserId !== userId &&
    (share.scope === "server" || share.targetUserId === userId)
  );
  const sharedEntries: Array<{ share: AddonFileShare; entry: AddonFileEntry }> = [];

  for (const share of visibleShares) {
    const entries = await readIndex(share.ownerUserId, addonId);
    const entry = entries.find((candidate) => candidate.id === share.entryId);
    if (entry) {
      sharedEntries.push({ share, entry: publicEntry(entry) });
    }
  }

  return sharedEntries;
}

export async function deleteAddonFileShare(ownerUserId: string, addonId: string, entryId: string, shareId: string) {
  const shares = await readShares();
  const nextShares = shares.filter((share) => !(
    share.id === shareId &&
    share.addonId === addonId &&
    share.entryId === entryId &&
    share.ownerUserId === ownerUserId
  ));

  if (nextShares.length === shares.length) {
    return false;
  }

  await writeShares(nextShares);
  return true;
}

export async function deleteAddonFileEntry(userId: string, addonId: string, entryId: string) {
  const entries = await readIndex(userId, addonId);
  const record = entries.find((entry) => entry.id === entryId);

  if (!record) {
    return false;
  }

  const deletedIds = new Set([entryId]);
  if (record.type === "folder") {
    for (const descendantId of collectDescendantIds(entries, record.id)) {
      deletedIds.add(descendantId);
    }
  }

  const deletedFiles = entries.filter((entry): entry is StoredAddonFileRecord => deletedIds.has(entry.id) && entry.type === "file");
  await Promise.all([
    writeIndex(userId, addonId, entries.filter((entry) => !deletedIds.has(entry.id))),
    ...deletedFiles.map((file) => rm(resolveFilePath(userId, addonId, file.storedName), { force: true })),
    readShares().then((shares) => writeShares(shares.filter((share) => !(share.addonId === addonId && share.ownerUserId === userId && deletedIds.has(share.entryId)))))
  ]);
  return true;
}

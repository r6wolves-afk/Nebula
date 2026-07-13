import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const storageDir = path.join(dataDir, "addon-storage");

function resolveStoragePath(userId: string, addonId: string, key: string) {
  return path.join(storageDir, "users", userId, addonId, `${key}.json`);
}

export async function readAddonStorage(userId: string, addonId: string, key: string) {
  try {
    const raw = await readFile(resolveStoragePath(userId, addonId, key), "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeAddonStorage(userId: string, addonId: string, key: string, value: unknown) {
  const filePath = resolveStoragePath(userId, addonId, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

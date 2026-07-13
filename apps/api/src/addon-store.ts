import AdmZip from "adm-zip";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AddonManifest, InstalledAddon } from "@nebula/shared";
import { getGitHubToken } from "./github-auth.js";

const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const installedPath = path.join(dataDir, "installed-addons.json");
const addonsDir = path.join(dataDir, "addons");

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

function encodeEntryUrl(addonId: string, entry: string) {
  return `/api/addons/${encodeURIComponent(addonId)}/files/${entry.split("/").map(encodeURIComponent).join("/")}`;
}

function resolveInside(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Invalid add-on package path: ${relativePath}`);
  }

  return resolved;
}

async function writeInstalled(addons: InstalledAddon[]) {
  await ensureDataDir();
  await writeFile(installedPath, JSON.stringify(addons, null, 2), "utf8");
}

export async function listInstalledAddons(): Promise<InstalledAddon[]> {
  try {
    const raw = await readFile(installedPath, "utf8");
    return JSON.parse(raw) as InstalledAddon[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function downloadAddonPackage(packageUrl: string) {
  const headers: Record<string, string> = {
    Accept: "application/zip, application/octet-stream"
  };
  const githubToken = getGitHubToken();

  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const response = await fetch(packageUrl, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download add-on package: ${response.status} ${packageUrl}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function findPackageManifestEntry(zip: AdmZip, addonId: string) {
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.endsWith("manifest.json")) {
      continue;
    }

    try {
      const manifest = JSON.parse(entry.getData().toString("utf8")) as Partial<AddonManifest>;
      if (manifest.id === addonId) {
        return { entry, manifest };
      }
    } catch {
      // Ignore unrelated manifest files that are not Nebula manifests.
    }
  }

  throw new Error(`Add-on package does not contain manifest.json for ${addonId}`);
}

async function installAddonPackage(manifest: AddonManifest) {
  if (!manifest.packageUrl) {
    return undefined;
  }

  const packageBuffer = await downloadAddonPackage(manifest.packageUrl);
  const zip = new AdmZip(packageBuffer);
  const { entry: packageManifestEntry, manifest: packageManifest } = findPackageManifestEntry(zip, manifest.id);
  const packageEntry = packageManifest.entry ?? manifest.entry;
  const rootPrefix = packageManifestEntry.entryName.slice(0, packageManifestEntry.entryName.length - "manifest.json".length);
  const addonDir = path.join(addonsDir, manifest.id);
  const tempDir = path.join(addonsDir, `${manifest.id}.tmp-${Date.now()}`);

  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  try {
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith(rootPrefix)) {
        continue;
      }

      const relativePath = entry.entryName.slice(rootPrefix.length);
      if (!relativePath) {
        continue;
      }

      const targetPath = resolveInside(tempDir, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, entry.getData());
    }

    await stat(resolveInside(tempDir, packageEntry));
    await rm(addonDir, { recursive: true, force: true });
    await rename(tempDir, addonDir);
    return encodeEntryUrl(manifest.id, packageEntry);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function installAddon(manifest: AddonManifest): Promise<InstalledAddon> {
  const installed = await listInstalledAddons();
  const entryUrl = await installAddonPackage(manifest);
  const nextAddon: InstalledAddon = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    route: manifest.route,
    icon: manifest.icon,
    color: manifest.color,
    entry: manifest.entry,
    entryUrl,
    status: "enabled",
    installedAt: new Date().toISOString()
  };

  const nextInstalled = [nextAddon, ...installed.filter((addon) => addon.id !== manifest.id)];
  await writeInstalled(nextInstalled);
  return nextAddon;
}

export async function uninstallAddon(addonId: string): Promise<void> {
  const installed = await listInstalledAddons();
  await writeInstalled(installed.filter((addon) => addon.id !== addonId));
  await rm(path.join(addonsDir, addonId), { recursive: true, force: true });
}

export function getInstalledAddonFilePath(addonId: string, filePath: string) {
  return resolveInside(path.join(addonsDir, addonId), filePath);
}

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddonManifest, CatalogResponse, CatalogSource } from "@nebula/shared";
import { z } from "zod";
import { getGitHubCatalogUrl, getGitHubToken, setRuntimeGitHubCatalogUrl } from "./github-auth.js";

const addonPermissionSchema = z.enum([
  "storage.read",
  "storage.write",
  "files.read",
  "files.write",
  "settings.read",
  "settings.write",
  "notifications.send"
]);

const addonManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  version: z.string().min(1),
  type: z.enum(["ui", "trusted-backend"]),
  summary: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  route: z.string().regex(/^\/apps\/[a-z0-9-]+$/),
  entry: z.string().min(1),
  permissions: z.array(addonPermissionSchema),
  repositoryUrl: z.string().url().optional(),
  packageUrl: z.string().url().optional()
});

const localCatalogSchema = z.object({
  addons: z.array(addonManifestSchema)
});

const apiSourceDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCatalogPath = path.resolve(apiSourceDir, "../../../catalog/local-catalog.json");
const catalogPath = process.env.NEBULA_CATALOG_PATH ?? defaultCatalogPath;
const envCatalogUrl = process.env.NEBULA_CATALOG_URL;
const githubOwner = process.env.NEBULA_GITHUB_OWNER ?? "r6wolves-afk";
const githubAddonRepoPrefix = process.env.NEBULA_ADDON_REPO_PREFIX ?? "Nebula-";
const githubDiscoveryEnabled = process.env.NEBULA_GITHUB_DISCOVERY !== "false";
const localCatalogEnabled = process.env.NEBULA_LOCAL_CATALOG === "true" || process.env.NEBULA_GITHUB_DISCOVERY === "false";

let cachedCatalog: CatalogResponse | undefined;

type GitHubRepository = {
  default_branch: string;
  description: string | null;
  full_name: string;
  html_url: string;
  name: string;
};

type GitHubContent = {
  content?: string;
  download_url?: string;
  encoding?: string;
};

function getCatalogUrl() {
  return envCatalogUrl || getGitHubCatalogUrl();
}

function shouldDiscoverGitHubRepos() {
  return githubDiscoveryEnabled && !getCatalogUrl() && Boolean(githubOwner);
}

export function setRuntimeCatalogUrl(url: string) {
  setRuntimeGitHubCatalogUrl(url);
}

export function getCatalogSource(): CatalogSource {
  const catalogUrl = getCatalogUrl();
  if (catalogUrl) {
    return {
      type: "remote",
      label: "GitHub catalog",
      location: catalogUrl
    };
  }

  if (shouldDiscoverGitHubRepos()) {
    return {
      type: "remote",
      label: "GitHub discovery",
      location: `https://github.com/${githubOwner}`
    };
  }

  return localCatalogEnabled
    ? {
      type: "local",
      label: "Local catalog",
      location: catalogPath
    }
    : {
      type: "remote",
      label: "GitHub discovery",
      location: `https://github.com/${githubOwner}`
    };
}

export function isCatalogWaitingForGitHubToken() {
  return Boolean(getCatalogUrl() && !getGitHubToken());
}

async function readRemoteCatalog(url: string): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw+json, application/json"
  };
  const githubToken = getGitHubToken();

  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch catalog: ${response.status} ${url}`);
  }

  return response.text();
}

async function fetchGitHubJson<T>(url: string, useToken = true): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json"
  };
  const githubToken = getGitHubToken();

  if (githubToken && useToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${url}`);
  }

  return response.json() as Promise<T>;
}

async function listGitHubRepositories(): Promise<GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];
  const useAuthenticatedListing = Boolean(getGitHubToken());

  for (let page = 1; page <= 10; page += 1) {
    const url = useAuthenticatedListing
      ? `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`
      : `https://api.github.com/users/${githubOwner}/repos?per_page=100&page=${page}`;
    let pageRepositories: GitHubRepository[];

    try {
      pageRepositories = await fetchGitHubJson<GitHubRepository[]>(url, useAuthenticatedListing);
    } catch (error) {
      if (!useAuthenticatedListing || page !== 1) {
        throw error;
      }

      return listPublicGitHubRepositories();
    }

    repositories.push(...pageRepositories);

    if (pageRepositories.length < 100) {
      break;
    }
  }

  return repositories.filter((repository) => repository.full_name.toLowerCase().startsWith(`${githubOwner.toLowerCase()}/`));
}

async function listPublicGitHubRepositories(): Promise<GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const pageRepositories = await fetchGitHubJson<GitHubRepository[]>(
      `https://api.github.com/users/${githubOwner}/repos?per_page=100&page=${page}`,
      false
    );
    repositories.push(...pageRepositories);

    if (pageRepositories.length < 100) {
      break;
    }
  }

  return repositories;
}

async function readGitHubManifest(repository: GitHubRepository): Promise<AddonManifest | undefined> {
  try {
    const manifestUrl = `https://api.github.com/repos/${repository.full_name}/contents/manifest.json?ref=${encodeURIComponent(repository.default_branch)}`;
    let content: GitHubContent;

    try {
      content = await fetchGitHubJson<GitHubContent>(manifestUrl);
    } catch {
      content = await fetchGitHubJson<GitHubContent>(manifestUrl, false);
    }

    const rawManifest = content.content && content.encoding === "base64"
      ? Buffer.from(content.content.replace(/\s/g, ""), "base64").toString("utf8")
      : content.download_url
        ? await readRemoteCatalog(content.download_url)
        : undefined;

    if (!rawManifest) {
      return undefined;
    }

    const manifest = addonManifestSchema.parse(JSON.parse(rawManifest));
    const repositoryDescription = repository.description?.trim();
    return {
      ...manifest,
      summary: repositoryDescription || manifest.summary,
      description: repositoryDescription || manifest.description,
      repositoryUrl: manifest.repositoryUrl ?? repository.html_url,
      packageUrl: manifest.packageUrl ?? `https://api.github.com/repos/${repository.full_name}/zipball/${repository.default_branch}`
    };
  } catch {
    return undefined;
  }
}

async function discoverGitHubCatalog(): Promise<CatalogResponse> {
  const repositories = await listGitHubRepositories();
  const addonRepositories = repositories.filter((repository) =>
    repository.name.toLowerCase().startsWith(githubAddonRepoPrefix.toLowerCase())
  );
  const addons = (await Promise.all(addonRepositories.map(readGitHubManifest))).filter(
    (addon): addon is AddonManifest => Boolean(addon)
  );

  return {
    addons,
    source: getCatalogSource()
  };
}

async function readCatalogSource(): Promise<string> {
  const catalogUrl = getCatalogUrl();
  if (catalogUrl) {
    return readRemoteCatalog(catalogUrl);
  }

  return readFile(catalogPath, "utf8");
}

export function clearCatalogCache() {
  cachedCatalog = undefined;
}

export async function getCatalogResponse(): Promise<CatalogResponse> {
  if (isCatalogWaitingForGitHubToken()) {
    return {
      addons: [],
      source: getCatalogSource()
    };
  }

  if (cachedCatalog) {
    return cachedCatalog;
  }

  if (shouldDiscoverGitHubRepos()) {
    cachedCatalog = await discoverGitHubCatalog();
    return cachedCatalog;
  }

  if (!localCatalogEnabled) {
    cachedCatalog = await discoverGitHubCatalog();
    return cachedCatalog;
  }

  const rawCatalog = await readCatalogSource();
  const parsedCatalog = localCatalogSchema.parse(JSON.parse(rawCatalog));
  cachedCatalog = {
    addons: parsedCatalog.addons,
    source: getCatalogSource()
  };
  return cachedCatalog;
}

export async function getCatalog(): Promise<AddonManifest[]> {
  return (await getCatalogResponse()).addons;
}

export async function findCatalogAddon(addonId: string): Promise<AddonManifest | undefined> {
  const catalog = await getCatalog();
  return catalog.find((addon) => addon.id === addonId);
}

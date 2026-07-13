import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type SavedGitHubConnection = {
  token?: string;
  catalogUrl?: string;
};

export type GitHubAuthStatus = {
  configured: boolean;
  source: "environment" | "saved" | "runtime" | null;
};

const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const connectionPath = path.join(dataDir, "github-connection.json");

function loadSavedGitHubConnection(): SavedGitHubConnection {
  try {
    return JSON.parse(readFileSync(connectionPath, "utf8")) as SavedGitHubConnection;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

let savedGitHubConnection = loadSavedGitHubConnection();
let runtimeGitHubToken = savedGitHubConnection.token;
let runtimeGitHubCatalogUrl = savedGitHubConnection.catalogUrl;

export function getGitHubToken() {
  return process.env.NEBULA_GITHUB_TOKEN || runtimeGitHubToken;
}

export function getGitHubCatalogUrl() {
  return runtimeGitHubCatalogUrl;
}

export function setRuntimeGitHubToken(token: string) {
  runtimeGitHubToken = token;
}

export function setRuntimeGitHubCatalogUrl(catalogUrl: string) {
  runtimeGitHubCatalogUrl = catalogUrl;
}

export function clearRuntimeGitHubConnection() {
  runtimeGitHubToken = savedGitHubConnection.token;
  runtimeGitHubCatalogUrl = savedGitHubConnection.catalogUrl;
}

export function saveGitHubConnection({ token, catalogUrl }: { token: string; catalogUrl?: string }) {
  savedGitHubConnection = {
    ...savedGitHubConnection,
    token,
    catalogUrl: catalogUrl ?? savedGitHubConnection.catalogUrl
  };
  runtimeGitHubToken = savedGitHubConnection.token;
  runtimeGitHubCatalogUrl = savedGitHubConnection.catalogUrl;

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(connectionPath, JSON.stringify(savedGitHubConnection, null, 2), "utf8");
}

export function getGitHubAuthStatus(): GitHubAuthStatus {
  if (process.env.NEBULA_GITHUB_TOKEN) {
    return { configured: true, source: "environment" };
  }

  if (runtimeGitHubToken) {
    return {
      configured: true,
      source: runtimeGitHubToken === savedGitHubConnection.token ? "saved" : "runtime"
    };
  }

  return { configured: false, source: null };
}

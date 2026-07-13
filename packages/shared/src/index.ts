export type AddonPermission =
  | "storage.read"
  | "storage.write"
  | "settings.read"
  | "settings.write"
  | "notifications.send";

export type AddonType = "ui" | "trusted-backend";

export type AddonManifest = {
  id: string;
  name: string;
  version: string;
  type: AddonType;
  summary: string;
  description: string;
  icon: string;
  color: string;
  route: string;
  entry: string;
  permissions: AddonPermission[];
  repositoryUrl?: string;
  packageUrl?: string;
};

export type CatalogSource = {
  type: "local" | "remote";
  label: string;
  location: string;
};

export type CatalogResponse = {
  addons: AddonManifest[];
  source: CatalogSource;
};

export type InstalledAddon = {
  id: string;
  name: string;
  version: string;
  route: string;
  icon: string;
  color: string;
  entry: string;
  entryUrl?: string;
  status: "enabled" | "disabled";
  installedAt: string;
};

export type PlatformSummary = {
  installedCount: number;
  availableCount: number;
  enabledCount: number;
};

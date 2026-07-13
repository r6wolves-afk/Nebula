export type AddonPermission =
  | "storage.read"
  | "storage.write"
  | "files.read"
  | "files.write"
  | "settings.read"
  | "settings.write"
  | "notifications.send";

export type AddonType = "ui" | "trusted-backend";

export type UserRole = "admin" | "user";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
};

export type PendingUserRequest = {
  id: string;
  username: string;
  displayName: string;
  requestedAt: string;
};

export type AuthStatus = {
  setupRequired: boolean;
  user: AuthUser | null;
};

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

export type AddonFileRecord = {
  id: string;
  type: "file";
  name: string;
  filename: string;
  mimeType: string;
  size: number;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AddonFolderRecord = {
  id: string;
  type: "folder";
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AddonFileEntry = AddonFileRecord | AddonFolderRecord;

export type PlatformSummary = {
  installedCount: number;
  availableCount: number;
  enabledCount: number;
};

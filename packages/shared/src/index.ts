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

export type AddonFileShareScope = "user" | "server";

export type AddonFileSharePermission = "viewer";

export type AddonFileShare = {
  id: string;
  addonId: string;
  entryId: string;
  ownerUserId: string;
  scope: AddonFileShareScope;
  targetUserId?: string;
  permission: AddonFileSharePermission;
  createdAt: string;
};

export type GalleryVisibility = "private" | "shared";

export type GalleryMediaKind = "image" | "video";

export type GalleryMedia = {
  id: string;
  ownerUserId: string;
  ownerDisplayName: string;
  kind: GalleryMediaKind;
  visibility: GalleryVisibility;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  capturedAt: string;
  year: number;
  month: number;
  contentUrl: string;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type GalleryTimelineMonth = {
  month: number;
  count: number;
};

export type GalleryTimelineYear = {
  year: number;
  months: GalleryTimelineMonth[];
};

export type NebulaChatScope = "general" | "direct";

export type NebulaChatMessage = {
  id: string;
  scope: NebulaChatScope;
  senderUserId: string;
  senderDisplayName: string;
  recipientUserId?: string;
  body: string;
  createdAt: string;
};

export type NebulaNotificationType = "chat" | "system";

export type NebulaNotification = {
  id: string;
  userId: string;
  type: NebulaNotificationType;
  title: string;
  body: string;
  link?: string;
  readAt?: string;
  createdAt: string;
};

export type PlatformSummary = {
  version: string;
  installedCount: number;
  availableCount: number;
  enabledCount: number;
};

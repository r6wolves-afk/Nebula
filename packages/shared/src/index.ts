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

export type NebulaChatAttachmentKind = "image" | "file";

export type NebulaChatAttachment = {
  id: string;
  kind: NebulaChatAttachmentKind;
  filename: string;
  mimeType: string;
  size: number;
  contentUrl: string;
  createdAt: string;
};

export type NebulaChatMessage = {
  id: string;
  scope: NebulaChatScope;
  senderUserId: string;
  senderDisplayName: string;
  recipientUserId?: string;
  body: string;
  attachments?: NebulaChatAttachment[];
  createdAt: string;
};

export type NovaProviderKind = "ollama" | "openai-compatible" | "custom";

export type NovaProviderRole = "chat" | "reasoning" | "coding" | "summarization" | "memory" | "vision" | "embedding";

export type NovaProvider = {
  id: string;
  name: string;
  kind: NovaProviderKind;
  baseUrl: string;
  model: string;
  enabled: boolean;
  priority: number;
  roles: NovaProviderRole[];
  createdAt: string;
  updatedAt: string;
};

export type NovaStatus = {
  enabled: boolean;
  provider: Pick<NovaProvider, "id" | "name" | "kind" | "baseUrl" | "model" | "enabled" | "roles">;
  reachable: boolean;
  version?: string;
  error?: string;
};

export type NovaMessageRole = "system" | "user" | "assistant";

export type NovaMessage = {
  id: string;
  conversationId: string;
  role: NovaMessageRole;
  body: string;
  providerId?: string;
  model?: string;
  createdAt: string;
};

export type NovaConversation = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: NovaMessage[];
};

export type NovaMemoryKind = "preference" | "fact" | "project" | "instruction" | "note";

export type NovaMemory = {
  id: string;
  userId: string;
  kind: NovaMemoryKind;
  text: string;
  pinned: boolean;
  source: "user" | "assistant" | "system";
  createdAt: string;
  updatedAt: string;
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

import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AuthUser } from "@nebula/shared";
import {
  createDirectChatMessage,
  createGeneralChatMessage,
  listDirectChatMessages,
  listGeneralChatMessages
} from "./chat-store.js";
import {
  clearCatalogCache,
  findCatalogAddon,
  getCatalog,
  getCatalogResponse,
  getCatalogSource,
  isCatalogWaitingForGitHubToken,
  setRuntimeCatalogUrl
} from "./catalog.js";
import { readAddonStorage, writeAddonStorage } from "./addon-storage.js";
import {
  createAddonFileShare,
  createAddonFolder,
  deleteAddonFileEntry,
  deleteAddonFileShare,
  getAddonFile,
  getSharedAddonFile,
  listAddonFileEntries,
  listAddonFileSharesByMe,
  listAddonFileSharesWithMe,
  listSharedAddonFileEntries,
  saveAddonFile,
  updateAddonFileEntry
} from "./addon-files.js";
import { getInstalledAddonFilePath, installAddon, listInstalledAddons, uninstallAddon } from "./addon-store.js";
import {
  approvePendingUserRequest,
  createSession,
  createPendingUserRequest,
  createUser,
  deleteSession,
  deleteUser,
  getSessionUser,
  hasUsers,
  listPendingUserRequests,
  listUsers,
  rejectPendingUserRequest,
  verifyUserCredentials
} from "./auth-store.js";
import {
  clearRuntimeGitHubConnection,
  getGitHubAuthStatus,
  saveGitHubConnection,
  setRuntimeGitHubToken
} from "./github-auth.js";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "./notification-store.js";

const server = Fastify({ logger: true });
const host = process.env.NEBULA_HOST ?? "127.0.0.1";
const port = Number(process.env.NEBULA_PORT ?? 8787);
const webDist = process.env.NEBULA_WEB_DIST ?? path.resolve(process.cwd(), "apps/web/dist");
const sessionCookie = "nebula_session";
let cachedPlatformVersion: string | undefined;

await server.register(cors, { origin: true });
await server.register(multipart, {
  limits: {
    fileSize: Number(process.env.NEBULA_MAX_UPLOAD_BYTES ?? 1024 * 1024 * 1024)
  }
});

function parseCookies(cookieHeader: string | undefined) {
  return Object.fromEntries(
    (cookieHeader ?? "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...valueParts] = cookie.split("=");
        return [decodeURIComponent(name), decodeURIComponent(valueParts.join("="))];
      })
  );
}

function sessionCookieHeader(token: string, expiresAt: string) {
  const secure = process.env.NEBULA_COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

function clearSessionCookieHeader() {
  return `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

async function getPlatformVersion() {
  const environmentVersion = process.env.NEBULA_VERSION?.trim();
  if (environmentVersion) {
    return environmentVersion;
  }

  if (cachedPlatformVersion) {
    return cachedPlatformVersion;
  }

  try {
    const packageJson = JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8")) as { version?: unknown };
    cachedPlatformVersion = typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    cachedPlatformVersion = "unknown";
  }

  return cachedPlatformVersion;
}

async function getRequestUser(request: { headers: { cookie?: string } }) {
  const cookies = parseCookies(request.headers.cookie);
  return getSessionUser(cookies[sessionCookie]);
}

async function requireUser(request: { headers: { cookie?: string } }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) {
  const user = await getRequestUser(request);
  if (!user) {
    reply.code(401).send({ error: "Authentication required" });
    return undefined;
  }

  return user;
}

async function requireAdmin(request: { headers: { cookie?: string } }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) {
  const user = await requireUser(request, reply);
  if (!user) {
    return undefined;
  }

  if (user.role !== "admin") {
    reply.code(403).send({ error: "Admin role required" });
    return undefined;
  }

  return user;
}

async function createLoginReply(reply: { header: (name: string, value: string) => unknown }, user: AuthUser) {
  const session = await createSession(user.id);
  reply.header("Set-Cookie", sessionCookieHeader(session.token, session.expiresAt));
  return { user };
}

async function requireInstalledAddon(addonId: string, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) {
  const installed = await listInstalledAddons();
  if (!installed.some((addon) => addon.id === addonId)) {
    reply.code(404).send({ error: "Add-on is not installed" });
    return false;
  }

  return true;
}

function headerFilename(filename: string) {
  return filename.replace(/["\\\r\n]/g, "_");
}

function multipartFieldValue(field: unknown) {
  const candidate = Array.isArray(field) ? field[0] : field;
  const value = (candidate as { value?: unknown } | undefined)?.value;
  return typeof value === "string" ? value : undefined;
}

function entryMutationReply(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, result: { status: string; entry?: unknown }) {
  if (result.status === "ok") {
    return { entry: result.entry };
  }

  if (result.status === "not-found") {
    return reply.code(404).send({ error: "File entry was not found" });
  }

  if (result.status === "invalid-parent") {
    return reply.code(400).send({ error: "Parent folder was not found" });
  }

  if (result.status === "cycle") {
    return reply.code(400).send({ error: "A folder cannot be moved into itself or one of its folders" });
  }

  if (result.status === "duplicate-name") {
    return reply.code(409).send({ error: "A file or folder with that name already exists here" });
  }

  return reply.code(400).send({ error: "File operation failed" });
}

function shareMutationReply(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, result: { status: string; share?: unknown }) {
  if (result.status === "ok") {
    return reply.code(201).send({ share: result.share });
  }

  if (result.status === "not-found") {
    return reply.code(404).send({ error: "File entry was not found" });
  }

  if (result.status === "invalid-target") {
    return reply.code(400).send({ error: "Share target is invalid" });
  }

  if (result.status === "duplicate-share") {
    return reply.code(409).send({ error: "That share already exists" });
  }

  return reply.code(400).send({ error: "Share operation failed" });
}

server.get("/api/health", async () => ({ status: "ok", name: "nebula" }));

server.get("/api/auth/status", async (request) => ({
  setupRequired: !(await hasUsers()),
  user: await getRequestUser(request) ?? null
}));

server.post("/api/auth/setup", async (request, reply) => {
  if (await hasUsers()) {
    return reply.code(409).send({ error: "Nebula has already been set up" });
  }

  const body = z.object({
    username: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,32}$/),
    displayName: z.string().trim().min(1).max(80).optional(),
    password: z.string().min(8)
  }).parse(request.body);
  const user = await createUser({ ...body, role: "admin" });
  return createLoginReply(reply, user);
});

server.post("/api/auth/login", async (request, reply) => {
  const body = z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1)
  }).parse(request.body);
  const user = await verifyUserCredentials(body.username, body.password);

  if (!user) {
    return reply.code(401).send({ error: "Invalid username or password" });
  }

  return createLoginReply(reply, user);
});

server.post("/api/auth/register", async (request, reply) => {
  if (!(await hasUsers())) {
    return reply.code(409).send({ error: "Create the first admin account before requesting access" });
  }

  const body = z.object({
    username: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,32}$/),
    displayName: z.string().trim().min(1).max(80).optional(),
    password: z.string().min(8)
  }).parse(request.body);
  const pendingRequest = await createPendingUserRequest(body);
  return reply.code(202).send({ request: pendingRequest });
});

server.post("/api/auth/logout", async (request, reply) => {
  const cookies = parseCookies(request.headers.cookie);
  if (cookies[sessionCookie]) {
    await deleteSession(cookies[sessionCookie]);
  }

  reply.header("Set-Cookie", clearSessionCookieHeader());
  return reply.code(204).send();
});

server.get("/api/users", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;
  return { users: await listUsers(), pendingRequests: await listPendingUserRequests() };
});

server.get("/api/users/directory", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const users = await listUsers();
  return {
    users: users
      .filter((directoryUser) => directoryUser.id !== user.id)
      .map((directoryUser) => ({
        id: directoryUser.id,
        username: directoryUser.username,
        displayName: directoryUser.displayName
      }))
  };
});

server.post("/api/users", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;
  const body = z.object({
    username: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,32}$/),
    displayName: z.string().trim().min(1).max(80).optional(),
    password: z.string().min(8),
    role: z.enum(["admin", "user"])
  }).parse(request.body);
  const user = await createUser(body);
  return reply.code(201).send({ user });
});

server.delete("/api/users/:id", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const result = await deleteUser(params.id);

  if (result === "not-found") {
    return reply.code(404).send({ error: "User was not found" });
  }

  if (result === "last-admin") {
    return reply.code(409).send({ error: "Nebula must keep at least one admin account" });
  }

  return reply.code(204).send();
});

server.post("/api/users/requests/:id/approve", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z.object({ role: z.enum(["admin", "user"]).default("user") }).parse(request.body ?? {});
  const user = await approvePendingUserRequest(params.id, body.role);

  if (!user) {
    return reply.code(404).send({ error: "Signup request was not found" });
  }

  return { user };
});

server.delete("/api/users/requests/:id", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const rejected = await rejectPendingUserRequest(params.id);

  if (!rejected) {
    return reply.code(404).send({ error: "Signup request was not found" });
  }

  return reply.code(204).send();
});

server.get("/api/chat/general", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { messages: await listGeneralChatMessages() };
});

server.post("/api/chat/general", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ body: z.string().trim().min(1).max(2000) }).parse(request.body);
  const message = await createGeneralChatMessage(user, body.body, await listUsers());
  return reply.code(201).send({ message });
});

server.get("/api/chat/direct/:userId", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ userId: z.string().min(1) }).parse(request.params);
  const targetUser = (await listUsers()).find((directoryUser) => directoryUser.id === params.userId);

  if (!targetUser || targetUser.id === user.id) {
    return reply.code(404).send({ error: "Chat user was not found" });
  }

  return { messages: await listDirectChatMessages(user.id, targetUser.id), user: targetUser };
});

server.post("/api/chat/direct/:userId", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ userId: z.string().min(1) }).parse(request.params);
  const body = z.object({ body: z.string().trim().min(1).max(2000) }).parse(request.body);
  const targetUser = (await listUsers()).find((directoryUser) => directoryUser.id === params.userId);

  if (!targetUser || targetUser.id === user.id) {
    return reply.code(404).send({ error: "Chat user was not found" });
  }

  const message = await createDirectChatMessage(user, targetUser, body.body);
  return reply.code(201).send({ message });
});

server.get("/api/notifications", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { notifications: await listNotifications(user.id) };
});

server.post("/api/notifications/read-all", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { notifications: await markAllNotificationsRead(user.id) };
});

server.patch("/api/notifications/:id", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ read: z.literal(true) }).parse(request.body);
  const notification = body.read ? await markNotificationRead(user.id, params.id) : undefined;

  if (!notification) {
    return reply.code(404).send({ error: "Notification was not found" });
  }

  return { notification };
});

server.get("/api/catalog", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return getCatalogResponse();
});

server.post("/api/catalog/refresh", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;
  clearCatalogCache();
  return getCatalogResponse();
});

server.get("/api/github/status", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return {
  ...getGitHubAuthStatus(),
  catalogSource: getCatalogSource(),
  catalogLocked: isCatalogWaitingForGitHubToken()
  };
});

server.post("/api/github/token", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;
  const parsedBody = z.object({
    token: z.string().trim().min(1),
    catalogUrl: z.string().trim().url().optional()
  }).safeParse(request.body);
  if (!parsedBody.success) {
    return reply.code(400).send({ error: "GitHub token and a valid catalog URL are required" });
  }

  const body = parsedBody.data;
  if (body.catalogUrl) {
    setRuntimeCatalogUrl(body.catalogUrl);
  }
  setRuntimeGitHubToken(body.token);
  clearCatalogCache();

  try {
    await getCatalogResponse();
  } catch (error) {
    clearRuntimeGitHubConnection();
    clearCatalogCache();
    request.log.warn({ err: error }, "Unable to read catalog with runtime GitHub token");
    return reply.code(400).send({ error: "Unable to read GitHub catalog with that token" });
  }

  saveGitHubConnection({ token: body.token, catalogUrl: body.catalogUrl });

  return reply.code(204).send();
});

server.get("/api/addons/installed", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { addons: await listInstalledAddons() };
});

server.get("/api/addons/:id/storage/:key", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    key: z.string().regex(/^[a-z0-9-]+$/)
  }).parse(request.params);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  return { value: await readAddonStorage(user.id, params.id, params.key) };
});

server.put("/api/addons/:id/storage/:key", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    key: z.string().regex(/^[a-z0-9-]+$/)
  }).parse(request.params);
  const body = z.object({ value: z.unknown() }).parse(request.body);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  await writeAddonStorage(user.id, params.id, params.key, body.value);
  return reply.code(204).send();
});

server.get("/api/addons/:id/user-files", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params);
  const query = z.object({ parentId: z.string().uuid().nullable().optional() }).parse(request.query);
  if (!(await requireInstalledAddon(params.id, reply))) return;
  const parentId = query.parentId === undefined ? null : query.parentId;
  const listing = await listAddonFileEntries(user.id, params.id, parentId);

  if (!listing) {
    return reply.code(404).send({ error: "Parent folder was not found" });
  }

  return {
    ...listing,
    files: listing.entries.filter((entry) => entry.type === "file")
  };
});

server.post("/api/addons/:id/user-folders", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params);
  const body = z.object({
    name: z.string().trim().min(1).max(160),
    parentId: z.string().uuid().nullable().optional()
  }).parse(request.body);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  const result = await createAddonFolder(user.id, params.id, body.name, body.parentId ?? null);
  if (result.status === "ok") {
    return reply.code(201).send({ folder: result.entry, entry: result.entry });
  }

  return entryMutationReply(reply, result);
});

server.post("/api/addons/:id/user-files", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  const upload = await request.file();
  if (!upload) {
    return reply.code(400).send({ error: "A multipart file field is required" });
  }

  const parentIdValue = multipartFieldValue(upload.fields.parentId);
  const parentId = typeof parentIdValue === "string" && parentIdValue.trim() ? parentIdValue.trim() : null;

  const result = await saveAddonFile({
    addonId: params.id,
    filename: upload.filename,
    mimeType: upload.mimetype,
    parentId,
    stream: upload.file,
    userId: user.id
  });

  if (result.status === "ok") {
    return reply.code(201).send({ file: result.entry, entry: result.entry });
  }

  return entryMutationReply(reply, result);
});

server.patch("/api/addons/:id/user-files/:entryId", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    entryId: z.string().uuid()
  }).parse(request.params);
  const body = z.object({
    name: z.string().trim().min(1).max(160).optional(),
    parentId: z.string().uuid().nullable().optional()
  }).parse(request.body);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  const result = await updateAddonFileEntry(user.id, params.id, params.entryId, body);
  return entryMutationReply(reply, result);
});

server.post("/api/addons/:id/user-files/:entryId/shares", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    entryId: z.string().uuid()
  }).parse(request.params);
  const body = z.object({
    scope: z.enum(["user", "server"]),
    targetUserId: z.string().min(1).optional(),
    permission: z.enum(["viewer"]).default("viewer")
  }).parse(request.body);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  if (body.scope === "user") {
    const targetUser = (await listUsers()).find((directoryUser) => directoryUser.id === body.targetUserId);
    if (!targetUser || targetUser.id === user.id) {
      return reply.code(400).send({ error: "Share target is invalid" });
    }
  }

  const result = await createAddonFileShare({
    addonId: params.id,
    entryId: params.entryId,
    ownerUserId: user.id,
    scope: body.scope,
    targetUserId: body.scope === "user" ? body.targetUserId : undefined
  });

  return shareMutationReply(reply, result);
});

server.get("/api/addons/:id/shared-with-me", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params);
  if (!(await requireInstalledAddon(params.id, reply))) return;
  return { items: await listAddonFileSharesWithMe(user.id, params.id) };
});

server.get("/api/addons/:id/shared-by-me", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params);
  if (!(await requireInstalledAddon(params.id, reply))) return;
  return { items: await listAddonFileSharesByMe(user.id, params.id) };
});

server.get("/api/addons/:id/shared-with-me/:shareId/files", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    shareId: z.string().uuid()
  }).parse(request.params);
  const query = z.object({ parentId: z.string().uuid().nullable().optional() }).parse(request.query);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  const listing = await listSharedAddonFileEntries(user.id, params.id, params.shareId, query.parentId);
  if (!listing) {
    return reply.code(404).send({ error: "Shared folder was not found" });
  }

  return {
    ...listing,
    files: listing.entries.filter((entry) => entry.type === "file")
  };
});

server.delete("/api/addons/:id/user-files/:entryId/shares/:shareId", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    entryId: z.string().uuid(),
    shareId: z.string().uuid()
  }).parse(request.params);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  const deleted = await deleteAddonFileShare(user.id, params.id, params.entryId, params.shareId);
  if (!deleted) {
    return reply.code(404).send({ error: "Share was not found" });
  }

  return reply.code(204).send();
});

server.get("/api/addons/:id/user-files/:entryId", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    entryId: z.string().uuid()
  }).parse(request.params);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  const storedFile = await getAddonFile(user.id, params.id, params.entryId) ?? await getSharedAddonFile(user.id, params.id, params.entryId);
  if (!storedFile) {
    return reply.code(404).send({ error: "File was not found" });
  }

  reply.type(storedFile.file.mimeType);
  reply.header("Content-Length", storedFile.file.size);
  reply.header("Content-Disposition", `inline; filename="${headerFilename(storedFile.file.filename)}"`);
  return reply.send(createReadStream(storedFile.filePath));
});

server.delete("/api/addons/:id/user-files/:entryId", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    entryId: z.string().uuid()
  }).parse(request.params);
  if (!(await requireInstalledAddon(params.id, reply))) return;

  const deleted = await deleteAddonFileEntry(user.id, params.id, params.entryId);
  if (!deleted) {
    return reply.code(404).send({ error: "File entry was not found" });
  }

  return reply.code(204).send();
});

server.get("/api/addons/:id/files/*", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().min(1), "*": z.string().min(1) }).parse(request.params);
  const filePath = getInstalledAddonFilePath(params.id, params["*"]);
  let fileStat;

  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return reply.code(404).send({ error: "Add-on file not found" });
    }

    throw error;
  }

  if (!fileStat.isFile()) {
    return reply.code(404).send({ error: "Add-on file not found" });
  }

  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };

  reply.type(contentTypes[path.extname(filePath)] ?? "application/octet-stream");
  return reply.send(createReadStream(filePath));
});

server.get("/api/summary", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const catalog = await getCatalog();
  const installed = await listInstalledAddons();
  return {
    version: await getPlatformVersion(),
    installedCount: installed.length,
    availableCount: catalog.length,
    enabledCount: installed.filter((addon) => addon.status === "enabled").length
  };
});

server.post("/api/addons/:id/install", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const manifest = await findCatalogAddon(params.id);

  if (!manifest) {
    return reply.code(404).send({ error: "Addon not found" });
  }

  const installed = await installAddon(manifest);
  return reply.code(201).send({ addon: installed });
});

server.delete("/api/addons/:id", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  await uninstallAddon(params.id);
  return reply.code(204).send();
});

if (existsSync(webDist)) {
  await server.register(fastifyStatic, {
    root: webDist,
    prefix: "/"
  });

  server.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ error: "API route not found" });
    }

    return reply.sendFile("index.html");
  });
}

try {
  await server.listen({ host, port });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}

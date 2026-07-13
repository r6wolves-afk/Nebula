import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import type { AuthUser, PendingUserRequest, UserRole } from "@nebula/shared";

const scrypt = promisify(scryptCallback) as (password: string, salt: string, keyLength: number) => Promise<Buffer>;
const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const usersPath = path.join(dataDir, "users.json");
const pendingUsersPath = path.join(dataDir, "pending-users.json");
const sessionsPath = path.join(dataDir, "sessions.json");

type StoredUser = AuthUser & {
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
};

type StoredSession = {
  id: string;
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

type StoredPendingUserRequest = PendingUserRequest & {
  passwordHash: string;
  passwordSalt: string;
};

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureDataDir();
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function publicUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role
  };
}

function publicPendingRequest(request: StoredPendingUserRequest): PendingUserRequest {
  return {
    id: request.id,
    username: request.username,
    displayName: request.displayName,
    requestedAt: request.requestedAt
  };
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString("hex") };
}

async function verifyPassword(password: string, user: StoredUser) {
  const candidate = await scrypt(password, user.passwordSalt, 64);
  const expected = Buffer.from(user.passwordHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function listUsers(): Promise<AuthUser[]> {
  const users = await readJsonFile<StoredUser[]>(usersPath, []);
  return users.map(publicUser);
}

export async function deleteUser(userId: string) {
  const [users, sessions] = await Promise.all([
    readJsonFile<StoredUser[]>(usersPath, []),
    readJsonFile<StoredSession[]>(sessionsPath, [])
  ]);
  const user = users.find((storedUser) => storedUser.id === userId);

  if (!user) {
    return "not-found" as const;
  }

  if (user.role === "admin" && users.filter((storedUser) => storedUser.role === "admin").length <= 1) {
    return "last-admin" as const;
  }

  await Promise.all([
    writeJsonFile(usersPath, users.filter((storedUser) => storedUser.id !== userId)),
    writeJsonFile(sessionsPath, sessions.filter((session) => session.userId !== userId))
  ]);
  return "deleted" as const;
}

export async function hasUsers() {
  return (await listUsers()).length > 0;
}

export async function createUser({
  username,
  password,
  displayName,
  role
}: {
  username: string;
  password: string;
  displayName?: string;
  role: UserRole;
}) {
  const users = await readJsonFile<StoredUser[]>(usersPath, []);
  const pendingRequests = await readJsonFile<StoredPendingUserRequest[]>(pendingUsersPath, []);
  const normalizedUsername = username.trim().toLowerCase();

  if (users.some((user) => user.username === normalizedUsername) || pendingRequests.some((request) => request.username === normalizedUsername)) {
    throw new Error("Username already exists");
  }

  const passwordResult = await hashPassword(password);
  const user: StoredUser = {
    id: randomBytes(12).toString("hex"),
    username: normalizedUsername,
    displayName: displayName?.trim() || normalizedUsername,
    role,
    passwordHash: passwordResult.hash,
    passwordSalt: passwordResult.salt,
    createdAt: new Date().toISOString()
  };

  await writeJsonFile(usersPath, [...users, user]);
  return publicUser(user);
}

export async function createPendingUserRequest({
  username,
  password,
  displayName
}: {
  username: string;
  password: string;
  displayName?: string;
}) {
  const [users, pendingRequests] = await Promise.all([
    readJsonFile<StoredUser[]>(usersPath, []),
    readJsonFile<StoredPendingUserRequest[]>(pendingUsersPath, [])
  ]);
  const normalizedUsername = username.trim().toLowerCase();

  if (users.some((user) => user.username === normalizedUsername) || pendingRequests.some((request) => request.username === normalizedUsername)) {
    throw new Error("Username already exists");
  }

  const passwordResult = await hashPassword(password);
  const request: StoredPendingUserRequest = {
    id: randomBytes(12).toString("hex"),
    username: normalizedUsername,
    displayName: displayName?.trim() || normalizedUsername,
    passwordHash: passwordResult.hash,
    passwordSalt: passwordResult.salt,
    requestedAt: new Date().toISOString()
  };

  await writeJsonFile(pendingUsersPath, [...pendingRequests, request]);
  return publicPendingRequest(request);
}

export async function listPendingUserRequests(): Promise<PendingUserRequest[]> {
  const pendingRequests = await readJsonFile<StoredPendingUserRequest[]>(pendingUsersPath, []);
  return pendingRequests.map(publicPendingRequest);
}

export async function approvePendingUserRequest(requestId: string, role: UserRole) {
  const [users, pendingRequests] = await Promise.all([
    readJsonFile<StoredUser[]>(usersPath, []),
    readJsonFile<StoredPendingUserRequest[]>(pendingUsersPath, [])
  ]);
  const pendingRequest = pendingRequests.find((request) => request.id === requestId);

  if (!pendingRequest) {
    return undefined;
  }

  if (users.some((user) => user.username === pendingRequest.username)) {
    throw new Error("Username already exists");
  }

  const user: StoredUser = {
    id: randomBytes(12).toString("hex"),
    username: pendingRequest.username,
    displayName: pendingRequest.displayName,
    role,
    passwordHash: pendingRequest.passwordHash,
    passwordSalt: pendingRequest.passwordSalt,
    createdAt: new Date().toISOString()
  };

  await Promise.all([
    writeJsonFile(usersPath, [...users, user]),
    writeJsonFile(pendingUsersPath, pendingRequests.filter((request) => request.id !== requestId))
  ]);
  return publicUser(user);
}

export async function rejectPendingUserRequest(requestId: string) {
  const pendingRequests = await readJsonFile<StoredPendingUserRequest[]>(pendingUsersPath, []);
  const nextPendingRequests = pendingRequests.filter((request) => request.id !== requestId);

  if (nextPendingRequests.length === pendingRequests.length) {
    return false;
  }

  await writeJsonFile(pendingUsersPath, nextPendingRequests);
  return true;
}

export async function verifyUserCredentials(username: string, password: string) {
  const users = await readJsonFile<StoredUser[]>(usersPath, []);
  const normalizedUsername = username.trim().toLowerCase();
  const user = users.find((storedUser) => storedUser.username === normalizedUsername);

  if (!user || !(await verifyPassword(password, user))) {
    return undefined;
  }

  return publicUser(user);
}

export async function createSession(userId: string) {
  const sessions = await readJsonFile<StoredSession[]>(sessionsPath, []);
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const nextSessions = sessions.filter((session) => new Date(session.expiresAt).getTime() > now.getTime());

  nextSessions.push({
    id: randomBytes(12).toString("hex"),
    tokenHash: hashSessionToken(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt
  });

  await writeJsonFile(sessionsPath, nextSessions);
  return { token, expiresAt };
}

export async function deleteSession(token: string) {
  const tokenHash = hashSessionToken(token);
  const sessions = await readJsonFile<StoredSession[]>(sessionsPath, []);
  await writeJsonFile(sessionsPath, sessions.filter((session) => session.tokenHash !== tokenHash));
}

export async function getSessionUser(token: string | undefined) {
  if (!token) {
    return undefined;
  }

  const tokenHash = hashSessionToken(token);
  const [sessions, users] = await Promise.all([
    readJsonFile<StoredSession[]>(sessionsPath, []),
    readJsonFile<StoredUser[]>(usersPath, [])
  ]);
  const now = Date.now();
  const session = sessions.find((storedSession) =>
    storedSession.tokenHash === tokenHash && new Date(storedSession.expiresAt).getTime() > now
  );
  const user = session ? users.find((storedUser) => storedUser.id === session.userId) : undefined;

  return user ? publicUser(user) : undefined;
}

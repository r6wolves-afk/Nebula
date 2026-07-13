import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NebulaNotification, NebulaNotificationType } from "@nebula/shared";

const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const notificationsPath = path.join(dataDir, "notifications.json");

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function readNotifications(): Promise<NebulaNotification[]> {
  try {
    return JSON.parse((await readFile(notificationsPath, "utf8")).replace(/^\uFEFF/, "")) as NebulaNotification[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeNotifications(notifications: NebulaNotification[]) {
  await ensureDataDir();
  await writeFile(notificationsPath, JSON.stringify(notifications, null, 2), "utf8");
}

export async function createNotification({
  body,
  link,
  title,
  type,
  userId
}: {
  body: string;
  link?: string;
  title: string;
  type: NebulaNotificationType;
  userId: string;
}) {
  const notifications = await readNotifications();
  const notification: NebulaNotification = {
    id: randomUUID(),
    userId,
    type,
    title,
    body,
    link,
    createdAt: new Date().toISOString()
  };

  await writeNotifications([notification, ...notifications].slice(0, 500));
  return notification;
}

export async function listNotifications(userId: string) {
  return (await readNotifications())
    .filter((notification) => notification.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const notifications = await readNotifications();
  const notification = notifications.find((candidate) => candidate.id === notificationId && candidate.userId === userId);

  if (!notification) {
    return undefined;
  }

  notification.readAt ??= new Date().toISOString();
  await writeNotifications(notifications);
  return notification;
}

export async function markAllNotificationsRead(userId: string) {
  const notifications = await readNotifications();
  const now = new Date().toISOString();
  const nextNotifications = notifications.map((notification) => notification.userId === userId && !notification.readAt
    ? { ...notification, readAt: now }
    : notification);

  await writeNotifications(nextNotifications);
  return nextNotifications.filter((notification) => notification.userId === userId);
}
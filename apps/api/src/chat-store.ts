import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuthUser, NebulaChatMessage } from "@nebula/shared";
import { createNotification } from "./notification-store.js";

const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const chatMessagesPath = path.join(dataDir, "chat-messages.json");
const maxMessages = 1000;

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function readMessages(): Promise<NebulaChatMessage[]> {
  try {
    return JSON.parse((await readFile(chatMessagesPath, "utf8")).replace(/^\uFEFF/, "")) as NebulaChatMessage[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeMessages(messages: NebulaChatMessage[]) {
  await ensureDataDir();
  await writeFile(chatMessagesPath, JSON.stringify(messages, null, 2), "utf8");
}

function directParticipantsMatch(message: NebulaChatMessage, leftUserId: string, rightUserId: string) {
  return message.scope === "direct"
    && ((message.senderUserId === leftUserId && message.recipientUserId === rightUserId)
      || (message.senderUserId === rightUserId && message.recipientUserId === leftUserId));
}

export async function listGeneralChatMessages() {
  return (await readMessages())
    .filter((message) => message.scope === "general")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function createGeneralChatMessage(sender: AuthUser, body: string, users: AuthUser[]) {
  const messages = await readMessages();
  const message: NebulaChatMessage = {
    id: randomUUID(),
    scope: "general",
    senderUserId: sender.id,
    senderDisplayName: sender.displayName,
    body,
    createdAt: new Date().toISOString()
  };

  await writeMessages([...messages, message].slice(-maxMessages));
  await Promise.all(users
    .filter((user) => user.id !== sender.id)
    .map((user) => createNotification({
      userId: user.id,
      type: "chat",
      title: "New message in General",
      body: `${sender.displayName}: ${body}`,
      link: "/chat"
    })));
  return message;
}

export async function listDirectChatMessages(userId: string, otherUserId: string) {
  return (await readMessages())
    .filter((message) => directParticipantsMatch(message, userId, otherUserId))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function createDirectChatMessage(sender: AuthUser, recipient: AuthUser, body: string) {
  const messages = await readMessages();
  const message: NebulaChatMessage = {
    id: randomUUID(),
    scope: "direct",
    senderUserId: sender.id,
    senderDisplayName: sender.displayName,
    recipientUserId: recipient.id,
    body,
    createdAt: new Date().toISOString()
  };

  await writeMessages([...messages, message].slice(-maxMessages));
  await createNotification({
    userId: recipient.id,
    type: "chat",
    title: `New DM from ${sender.displayName}`,
    body,
    link: `/chat?user=${encodeURIComponent(sender.id)}`
  });
  return message;
}
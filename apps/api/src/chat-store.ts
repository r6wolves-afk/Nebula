import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { AuthUser, NebulaChatAttachment, NebulaChatMessage } from "@nebula/shared";
import { createNotification } from "./notification-store.js";

const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const chatMessagesPath = path.join(dataDir, "chat-messages.json");
const chatAttachmentDir = path.join(dataDir, "chat-attachments");
const maxMessages = 1000;
const maxAttachmentsPerMessage = 6;

export type PendingChatAttachment = {
  filename?: string;
  mimeType?: string;
  stream: NodeJS.ReadableStream;
};

export type StoredChatAttachment = NebulaChatAttachment & {
  storedName: string;
};

export const novaChatUser: AuthUser = {
  id: "nova-assistant",
  username: "nova",
  displayName: "NOVA",
  role: "user"
};

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

function normalizeFilename(filename: string | undefined, fallback: string) {
  const baseName = (filename || fallback).replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();
  return baseName || fallback;
}

function attachmentKind(mimeType: string) {
  return mimeType.startsWith("image/") ? "image" : "file";
}

function publicAttachment(attachment: StoredChatAttachment): NebulaChatAttachment {
  const { storedName: _storedName, filePath: _filePath, ...publicRecord } = attachment as StoredChatAttachment & { filePath?: string };
  return publicRecord;
}

function publicMessage(message: NebulaChatMessage): NebulaChatMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => publicAttachment(attachment as StoredChatAttachment))
  };
}

async function saveChatAttachments(messageId: string, attachments: PendingChatAttachment[] | undefined) {
  if (!attachments?.length) {
    return [];
  }

  const now = new Date().toISOString();
  const savedAttachments: StoredChatAttachment[] = [];
  for (const attachment of attachments.slice(0, maxAttachmentsPerMessage)) {
    const id = randomUUID();
    const mimeType = attachment.mimeType || "application/octet-stream";
    const filename = normalizeFilename(attachment.filename, attachmentKind(mimeType) === "image" ? "image" : "attachment.bin");
    const storedName = `${id}-${filename}`;
    const filePath = path.join(chatAttachmentDir, messageId, storedName);

    await mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(attachment.stream, createWriteStream(filePath));
    const fileStat = await stat(filePath);
    savedAttachments.push({
      id,
      kind: attachmentKind(mimeType),
      filename,
      mimeType,
      size: fileStat.size,
      contentUrl: `/api/chat/attachments/${messageId}/${id}`,
      createdAt: now,
      storedName
    });
  }

  return savedAttachments;
}

function directParticipantsMatch(message: NebulaChatMessage, leftUserId: string, rightUserId: string) {
  return message.scope === "direct"
    && ((message.senderUserId === leftUserId && message.recipientUserId === rightUserId)
      || (message.senderUserId === rightUserId && message.recipientUserId === leftUserId));
}

function normalizeMention(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "");
}

function mentionTokens(body: string) {
  return new Set([...body.matchAll(/@([a-z0-9_.-]+)/gi)].map((match) => normalizeMention(match[1] ?? "")).filter(Boolean));
}

function userMentionAliases(user: AuthUser) {
  return new Set([
    normalizeMention(user.username),
    normalizeMention(user.displayName),
    normalizeMention(user.displayName.replace(/\s+/g, ""))
  ].filter(Boolean));
}

export function messageMentionsNova(body: string) {
  return mentionTokens(body).has(novaChatUser.username);
}

function mentionedUsers(sender: AuthUser, body: string, users: AuthUser[]) {
  const tokens = mentionTokens(body);
  if (tokens.size === 0) {
    return [];
  }

  return users.filter((user) => user.id !== sender.id && [...userMentionAliases(user)].some((alias) => tokens.has(alias)));
}

export async function listGeneralChatMessages() {
  return (await readMessages())
    .filter((message) => message.scope === "general")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(publicMessage);
}

export async function createGeneralChatMessage(sender: AuthUser, body: string, users: AuthUser[], attachments?: PendingChatAttachment[]) {
  const messages = await readMessages();
  const messageId = randomUUID();
  const message: NebulaChatMessage = {
    id: messageId,
    scope: "general",
    senderUserId: sender.id,
    senderDisplayName: sender.displayName,
    body,
    attachments: await saveChatAttachments(messageId, attachments),
    createdAt: new Date().toISOString()
  };

  await writeMessages([...messages, message].slice(-maxMessages));
  await Promise.all(mentionedUsers(sender, body, users)
    .map((user) => createNotification({
      userId: user.id,
      type: "chat",
      title: `${sender.displayName} mentioned you in General`,
      body: `${sender.displayName}: ${body}`,
      link: "/chat"
    })));
  return publicMessage(message);
}

export async function createGeneralNovaChatMessage(body: string, users: AuthUser[]) {
  const messages = await readMessages();
  const message: NebulaChatMessage = {
    id: randomUUID(),
    scope: "general",
    senderUserId: novaChatUser.id,
    senderDisplayName: novaChatUser.displayName,
    body,
    createdAt: new Date().toISOString()
  };

  await writeMessages([...messages, message].slice(-maxMessages));
  await Promise.all(mentionedUsers(novaChatUser, body, users)
    .map((user) => createNotification({
      userId: user.id,
      type: "chat",
      title: "NOVA mentioned you in General",
      body: `NOVA: ${body}`,
      link: "/chat"
    })));
  return publicMessage(message);
}

export async function listDirectChatMessages(userId: string, otherUserId: string) {
  return (await readMessages())
    .filter((message) => directParticipantsMatch(message, userId, otherUserId))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(publicMessage);
}

export async function createDirectChatMessage(sender: AuthUser, recipient: AuthUser, body: string, attachments?: PendingChatAttachment[]) {
  const messages = await readMessages();
  const messageId = randomUUID();
  const message: NebulaChatMessage = {
    id: messageId,
    scope: "direct",
    senderUserId: sender.id,
    senderDisplayName: sender.displayName,
    recipientUserId: recipient.id,
    body,
    attachments: await saveChatAttachments(messageId, attachments),
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

  return publicMessage(message);
}

export async function getChatAttachment(user: AuthUser, messageId: string, attachmentId: string) {
  const messages = await readMessages();
  const message = messages.find((candidate) => candidate.id === messageId);
  if (!message || (message.scope === "direct" && message.senderUserId !== user.id && message.recipientUserId !== user.id)) {
    return undefined;
  }

  const attachment = message.attachments?.find((candidate) => candidate.id === attachmentId) as StoredChatAttachment | undefined;
  if (!attachment) {
    return undefined;
  }

  const legacyFilePath = (attachment as StoredChatAttachment & { filePath?: string }).filePath;
  if (!attachment.storedName && !legacyFilePath) {
    return undefined;
  }

  const filePath = legacyFilePath ?? path.join(chatAttachmentDir, messageId, attachment.storedName);

  return {
    attachment: publicAttachment(attachment),
    stream: createReadStream(filePath)
  };
}
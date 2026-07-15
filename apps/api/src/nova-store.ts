import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuthUser, NovaConversation, NovaMemory, NovaMemoryKind, NovaMessage } from "@nebula/shared";

const dataDir = process.env.NEBULA_DATA_DIR ?? path.resolve(process.cwd(), ".nebula-data");
const novaDir = path.join(dataDir, "nova", "users");
const maxConversations = 50;
const maxMessagesPerConversation = 200;

function userDir(userId: string) {
  return path.join(novaDir, userId);
}

function conversationsPath(userId: string) {
  return path.join(userDir(userId), "conversations.json");
}

function memoriesPath(userId: string) {
  return path.join(userDir(userId), "memories.json");
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, "")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function conversationTitle(body: string) {
  return body.length > 60 ? `${body.slice(0, 57)}...` : body;
}

export async function listNovaConversations(userId: string) {
  return (await readJsonFile<NovaConversation[]>(conversationsPath(userId), []))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getNovaConversation(userId: string, conversationId: string) {
  return (await listNovaConversations(userId)).find((conversation) => conversation.id === conversationId);
}

export async function deleteNovaConversation(userId: string, conversationId: string) {
  const conversations = await listNovaConversations(userId);
  const nextConversations = conversations.filter((conversation) => conversation.id !== conversationId);
  if (nextConversations.length === conversations.length) {
    return false;
  }

  await writeJsonFile(conversationsPath(userId), nextConversations);
  return true;
}

export async function appendNovaUserMessage(user: AuthUser, conversationId: string | undefined, body: string) {
  const conversations = await listNovaConversations(user.id);
  const now = new Date().toISOString();
  const targetConversation = conversationId
    ? conversations.find((conversation) => conversation.id === conversationId)
    : undefined;
  const conversation: NovaConversation = targetConversation ?? {
    id: randomUUID(),
    userId: user.id,
    title: conversationTitle(body),
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  const message: NovaMessage = {
    id: randomUUID(),
    conversationId: conversation.id,
    role: "user",
    body,
    createdAt: now
  };
  const updatedConversation: NovaConversation = {
    ...conversation,
    updatedAt: now,
    messages: [...conversation.messages, message].slice(-maxMessagesPerConversation)
  };
  const nextConversations = [
    updatedConversation,
    ...conversations.filter((candidate) => candidate.id !== updatedConversation.id)
  ].slice(0, maxConversations);

  await writeJsonFile(conversationsPath(user.id), nextConversations);
  return { conversation: updatedConversation, message };
}

export async function appendNovaAssistantMessage(userId: string, conversationId: string, body: string, providerId: string, model: string) {
  const conversations = await listNovaConversations(userId);
  const conversation = conversations.find((candidate) => candidate.id === conversationId);
  if (!conversation) {
    return undefined;
  }

  const now = new Date().toISOString();
  const message: NovaMessage = {
    id: randomUUID(),
    conversationId,
    role: "assistant",
    body,
    providerId,
    model,
    createdAt: now
  };
  const updatedConversation: NovaConversation = {
    ...conversation,
    updatedAt: now,
    messages: [...conversation.messages, message].slice(-maxMessagesPerConversation)
  };

  await writeJsonFile(conversationsPath(userId), [
    updatedConversation,
    ...conversations.filter((candidate) => candidate.id !== conversationId)
  ]);
  return { conversation: updatedConversation, message };
}

export async function listNovaMemories(userId: string) {
  return (await readJsonFile<NovaMemory[]>(memoriesPath(userId), []))
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
}

export async function createNovaMemory(userId: string, kind: NovaMemoryKind, text: string, pinned = false) {
  const memories = await listNovaMemories(userId);
  const now = new Date().toISOString();
  const memory: NovaMemory = {
    id: randomUUID(),
    userId,
    kind,
    text,
    pinned,
    source: "user",
    createdAt: now,
    updatedAt: now
  };

  await writeJsonFile(memoriesPath(userId), [memory, ...memories]);
  return memory;
}

export async function deleteNovaMemory(userId: string, memoryId: string) {
  const memories = await listNovaMemories(userId);
  const nextMemories = memories.filter((memory) => memory.id !== memoryId);
  if (nextMemories.length === memories.length) {
    return false;
  }

  await writeJsonFile(memoriesPath(userId), nextMemories);
  return true;
}
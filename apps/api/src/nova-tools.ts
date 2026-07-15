import { randomUUID } from "node:crypto";
import type { AuthUser } from "@nebula/shared";
import { readAddonStorage, writeAddonStorage } from "./addon-storage.js";
import { listInstalledAddons } from "./addon-store.js";

type NotesAddonNote = {
  id: string;
  title: string;
  body: string;
  attachments: unknown[];
  createdAt: string;
  updatedAt: string;
};

type NovaToolResult = {
  handled: true;
  message: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToNoteBodyHtml(value: string) {
  return value
    .split("\n")
    .map((line) => `<div>${escapeHtml(line) || "<br>"}</div>`)
    .join("");
}

function extractNoteRequest(prompt: string) {
  const normalizedPrompt = prompt.trim();
  if (!/\b(create|add|make|write)\b/i.test(normalizedPrompt) || !/\bnote\b/i.test(normalizedPrompt)) {
    return undefined;
  }

  const titleMatch = normalizedPrompt.match(/\b(?:called|named|titled)\s+["“”']?(.+?)["“”']?(?:\s+(?:with|that says|saying|about|to remember)\b|$)/i);
  const bodyMatch = normalizedPrompt.match(/\b(?:with body|with content|that says|saying|about|to remember)\s+(.+)$/i);
  const bodyText = bodyMatch?.[1]?.trim() ?? "";
  const title = titleMatch?.[1]?.trim()
    ?? (bodyText ? bodyText.slice(0, 60) : "NOVA note");

  return {
    bodyText,
    title: title || "NOVA note"
  };
}

async function createNotesAddonNote(user: AuthUser, title: string, bodyText: string) {
  const installed = await listInstalledAddons();
  if (!installed.some((addon) => addon.id === "notes" && addon.status === "enabled")) {
    throw new Error("Nebula Notes is not installed or enabled");
  }

  const storedNotes = await readAddonStorage(user.id, "notes", "notes");
  const notes = Array.isArray(storedNotes) ? storedNotes as NotesAddonNote[] : [];
  const now = new Date().toISOString();
  const note: NotesAddonNote = {
    id: `note-${Date.now()}-${randomUUID().slice(0, 12)}`,
    title,
    body: textToNoteBodyHtml(bodyText),
    attachments: [],
    createdAt: now,
    updatedAt: now
  };

  await writeAddonStorage(user.id, "notes", "notes", [note, ...notes]);
  return note;
}

export async function runNovaToolRequest(user: AuthUser, prompt: string): Promise<NovaToolResult | undefined> {
  const noteRequest = extractNoteRequest(prompt);
  if (!noteRequest) {
    return undefined;
  }

  const note = await createNotesAddonNote(user, noteRequest.title, noteRequest.bodyText);
  return {
    handled: true,
    message: `Created a Nebula Notes note titled "${note.title}".`
  };
}
import {
  Activity,
  Bell,
  Boxes,
  CheckCircle2,
  Cloud,
  MessageCircle,
  Paperclip,
  Github,
  ExternalLink,
  FolderOpen,
  Gauge,
  Grid3X3,
  HardDrive,
  LogOut,
  NotebookTabs,
  PackagePlus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Undo2,
  Trash2,
  X,
  UserCheck,
  UserPlus
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AddonManifest, AuthStatus, AuthUser, CatalogSource, InstalledAddon, NebulaChatMessage, NebulaNotification, NovaConversation, NovaMemory, NovaMemoryKind, NovaMessage, NovaStatus, PendingUserRequest, PlatformSummary, UserRole } from "@nebula/shared";

type Section = "dashboard" | "nova" | "chat" | "notifications" | "store" | "installed" | "settings";
type RouteState =
  | { section: Section; addonId?: undefined }
  | { section: "addon"; addonId: string };
type GitHubAuthStatus = {
  configured: boolean;
  source: "environment" | "saved" | "runtime" | null;
  catalogSource?: CatalogSource;
  catalogLocked?: boolean;
};

const chatPollIntervalMs = 5000;
const notificationPollIntervalMs = 5000;
const novaChatUserId = "nova-assistant";
const novaMentionUser = { id: novaChatUserId, username: "nova", displayName: "NOVA" };
const maxChatAttachments = 6;
const localDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZoneName: "short",
  year: "numeric"
});

function formatLocalDateTime(value: string) {
  return localDateTimeFormatter.format(new Date(value));
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const iconMap = {
  "notebook-tabs": NotebookTabs,
  "folder-open": FolderOpen,
  activity: Activity
};

const navItems: Array<{ id: Section; label: string; icon: typeof Grid3X3 }> = [
  { id: "dashboard", label: "Dashboard", icon: Grid3X3 },
  { id: "nova", label: "NOVA", icon: Sparkles },
  { id: "chat", label: "Nebula Chat", icon: MessageCircle },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "store", label: "App Store", icon: PackagePlus },
  { id: "installed", label: "Installed", icon: Boxes },
  { id: "settings", label: "Settings", icon: Settings }
];

function routeFromPath(pathname: string): RouteState {
  const addonMatch = pathname.match(/^\/apps\/([^/]+)$/);
  if (addonMatch) {
    return { section: "addon", addonId: decodeURIComponent(addonMatch[1]) };
  }

  if (pathname === "/store") {
    return { section: "store" };
  }

  if (pathname === "/installed") {
    return { section: "installed" };
  }

  if (pathname === "/settings") {
    return { section: "settings" };
  }

  if (pathname === "/chat") {
    return { section: "chat" };
  }

  if (pathname === "/nova") {
    return { section: "nova" };
  }

  if (pathname === "/notifications") {
    return { section: "notifications" };
  }

  return { section: "dashboard" };
}

function pathForRoute(route: RouteState): string {
  if (route.section === "addon") {
    return `/apps/${encodeURIComponent(route.addonId)}`;
  }

  if (route.section === "chat") {
    return "/chat";
  }

  if (route.section === "nova") {
    return "/nova";
  }

  if (route.section === "notifications") {
    return "/notifications";
  }

  if (route.section === "store") {
    return "/store";
  }

  if (route.section === "installed") {
    return "/installed";
  }

  if (route.section === "settings") {
    return "/settings";
  }

  return "/";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        message = body.error;
      }
    } catch {
      // Keep the status-based fallback for non-JSON errors.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = Number.isNaN(leftParts[index]) ? 0 : leftParts[index] ?? 0;
    const rightPart = Number.isNaN(rightParts[index]) ? 0 : rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteState>(() => routeFromPath(window.location.pathname));
  const [catalog, setCatalog] = useState<AddonManifest[]>([]);
  const [catalogSource, setCatalogSource] = useState<CatalogSource>({
    type: "local",
    label: "Local catalog",
    location: "catalog/local-catalog.json"
  });
  const [installed, setInstalled] = useState<InstalledAddon[]>([]);
  const [githubAuth, setGithubAuth] = useState<GitHubAuthStatus>({ configured: false, source: null });
  const [githubCatalogUrl, setGithubCatalogUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [showGitHubSettings, setShowGitHubSettings] = useState(false);
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [storeMessage, setStoreMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [summary, setSummary] = useState<PlatformSummary>({
    version: "unknown",
    installedCount: 0,
    availableCount: 0,
    enabledCount: 0
  });
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingUserRequest[]>([]);
  const [newUser, setNewUser] = useState({ username: "", displayName: "", password: "", role: "user" as UserRole });
  const [userMessage, setUserMessage] = useState<string | null>(null);
  const [busyAddon, setBusyAddon] = useState<string | null>(null);
  const [directoryUsers, setDirectoryUsers] = useState<Array<Pick<AuthUser, "id" | "username" | "displayName">>>([]);
  const [chatMode, setChatMode] = useState<"general" | "direct">("general");
  const [selectedDmUserId, setSelectedDmUserId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<NebulaChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatAttachments, setChatAttachments] = useState<File[]>([]);
  const [chatMention, setChatMention] = useState<{ start: number; query: string } | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const [chatMessage, setChatMessage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NebulaNotification[]>([]);
  const [novaStatus, setNovaStatus] = useState<NovaStatus | null>(null);
  const [novaConversations, setNovaConversations] = useState<NovaConversation[]>([]);
  const [selectedNovaConversationId, setSelectedNovaConversationId] = useState<string | null>(null);
  const [novaDraft, setNovaDraft] = useState("");
  const [dashboardNovaDraft, setDashboardNovaDraft] = useState("");
  const [dashboardNovaConversationId, setDashboardNovaConversationId] = useState<string | null>(null);
  const [dashboardNovaReply, setDashboardNovaReply] = useState<{ prompt: string; reply: string } | null>(null);
  const [pendingNovaPrompt, setPendingNovaPrompt] = useState<{ body: string; conversationId?: string } | null>(null);
  const [typingNovaReply, setTypingNovaReply] = useState<{ conversationId: string; messageId?: string; body: string; visible: string; dashboardQuick: boolean; prompt: string } | null>(null);
  const [novaBusy, setNovaBusy] = useState(false);
  const [deletingNovaConversationId, setDeletingNovaConversationId] = useState<string | null>(null);
  const [novaMessage, setNovaMessage] = useState<string | null>(null);
  const [novaMemories, setNovaMemories] = useState<NovaMemory[]>([]);
  const [newNovaMemory, setNewNovaMemory] = useState({ kind: "note" as NovaMemoryKind, text: "", pinned: false });

  async function loadAuthStatus() {
    setAuthStatus(await requestJson<AuthStatus>("/api/auth/status"));
  }

  async function submitAuth(mode: "setup" | "login" | "register", values: { username: string; displayName?: string; password: string }) {
    setAuthBusy(true);
    setAuthMessage(null);

    try {
      if (mode === "register") {
        await requestJson<{ request: PendingUserRequest }>("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values)
        });
        setAuthView("login");
        setAuthMessage("Account request sent. An admin needs to approve it before you can sign in.");
        return;
      }

      const response = await requestJson<{ user: AuthUser }>(mode === "setup" ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });

      setAuthStatus({ setupRequired: false, user: response.user });
      await refresh();
    } catch {
      setAuthMessage(mode === "setup"
        ? "Nebula could not create that admin account."
        : mode === "register"
          ? "Nebula could not submit that request. Use a unique username and an 8+ character password."
          : "Invalid username or password.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthStatus({ setupRequired: false, user: null });
    setCatalog([]);
    setInstalled([]);
    setUsers([]);
    setDirectoryUsers([]);
    setChatMessages([]);
    setNotifications([]);
    setPendingRequests([]);
    setNovaStatus(null);
    setNovaConversations([]);
    setNovaMemories([]);
    setSelectedNovaConversationId(null);
    setDashboardNovaDraft("");
    setDashboardNovaConversationId(null);
    setDashboardNovaReply(null);
    setPendingNovaPrompt(null);
    setTypingNovaReply(null);
    setDeletingNovaConversationId(null);
    navigate({ section: "dashboard" });
  }

  async function refresh() {
    const [catalogResponse, installedResponse, summaryResponse, githubStatusResponse] = await Promise.all([
      requestJson<{ addons: AddonManifest[]; source: CatalogSource }>("/api/catalog"),
      requestJson<{ addons: InstalledAddon[] }>("/api/addons/installed"),
      requestJson<PlatformSummary>("/api/summary"),
      requestJson<GitHubAuthStatus>("/api/github/status")
    ]);

    setCatalog(catalogResponse.addons);
    setCatalogSource(catalogResponse.source);
    setInstalled(installedResponse.addons);
    setSummary(summaryResponse);
    setGithubAuth(githubStatusResponse);
    if (!githubCatalogUrl && githubStatusResponse.catalogSource?.label === "GitHub catalog") {
      setGithubCatalogUrl(githubStatusResponse.catalogSource.location);
    }
  }

  useEffect(() => {
    void loadAuthStatus();
  }, []);

  useEffect(() => {
    if (authStatus?.user) {
      void refresh();
    }
  }, [authStatus?.user?.id]);

  useEffect(() => {
    function handlePopState() {
      setRoute(routeFromPath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextRoute: RouteState) {
    setRoute(nextRoute);
    const nextPath = pathForRoute(nextRoute);
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

  async function installAddon(addonId: string) {
    setBusyAddon(addonId);
    setStoreMessage(null);
    try {
      await requestJson(`/api/addons/${addonId}/install`, { method: "POST" });
      await refresh();
      const addon = catalog.find((catalogAddon) => catalogAddon.id === addonId);
      const wasInstalled = installed.some((installedAddon) => installedAddon.id === addonId);
      setStoreMessage({
        kind: "success",
        text: `${addon?.name ?? "Add-on"} ${wasInstalled ? "updated" : "installed"} and ready to open.`
      });
    } catch {
      const addon = catalog.find((catalogAddon) => catalogAddon.id === addonId);
      setStoreMessage({ kind: "error", text: `Nebula could not install ${addon?.name ?? "that add-on"}. Check the package URL and GitHub access.` });
    } finally {
      setBusyAddon(null);
    }
  }

  async function refreshCatalog() {
    setCatalogRefreshing(true);
    setStoreMessage(null);

    try {
      const catalogResponse = await requestJson<{ addons: AddonManifest[]; source: CatalogSource }>("/api/catalog/refresh", { method: "POST" });
      const [installedResponse, summaryResponse, githubStatusResponse] = await Promise.all([
        requestJson<{ addons: InstalledAddon[] }>("/api/addons/installed"),
        requestJson<PlatformSummary>("/api/summary"),
        requestJson<GitHubAuthStatus>("/api/github/status")
      ]);

      setCatalog(catalogResponse.addons);
      setCatalogSource(catalogResponse.source);
      setInstalled(installedResponse.addons);
      setSummary(summaryResponse);
      setGithubAuth(githubStatusResponse);
      setStoreMessage({ kind: "success", text: "Catalog refreshed from source." });
    } catch {
      setStoreMessage({ kind: "error", text: "Nebula could not refresh the catalog." });
    } finally {
      setCatalogRefreshing(false);
    }
  }

  async function connectGitHub(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGithubBusy(true);
    setGithubMessage(null);

    try {
      const response = await fetch("/api/github/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: githubToken,
          catalogUrl: githubCatalogUrl.trim() || undefined
        })
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      setGithubToken("");
      setGithubMessage("GitHub connection saved.");
      await refresh();
    } catch {
      setGithubMessage("Nebula could not read the GitHub catalog with that token.");
    } finally {
      setGithubBusy(false);
    }
  }

  async function uninstallAddon(addonId: string) {
    setBusyAddon(addonId);
    setStoreMessage(null);
    try {
      const response = await fetch(`/api/addons/${addonId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      await refresh();
      const addon = installed.find((installedAddon) => installedAddon.id === addonId);
      setStoreMessage({ kind: "success", text: `${addon?.name ?? "Add-on"} was removed.` });
    } catch {
      const addon = installed.find((installedAddon) => installedAddon.id === addonId);
      setStoreMessage({ kind: "error", text: `Nebula could not remove ${addon?.name ?? "that add-on"}.` });
    } finally {
      setBusyAddon(null);
    }
  }

  async function loadUsers() {
    if (authStatus?.user?.role !== "admin") {
      return;
    }

    const response = await requestJson<{ users: AuthUser[]; pendingRequests: PendingUserRequest[] }>("/api/users");
    setUsers(response.users);
    setPendingRequests(response.pendingRequests);
  }

  async function loadDirectoryUsers() {
    const response = await requestJson<{ users: Array<Pick<AuthUser, "id" | "username" | "displayName">> }>("/api/users/directory");
    setDirectoryUsers(response.users);
    setSelectedDmUserId((current) => current ?? response.users[0]?.id ?? null);
  }

  async function loadChatMessages(mode = chatMode, dmUserId = selectedDmUserId) {
    if (mode === "direct") {
      if (!dmUserId) {
        setChatMessages([]);
        return;
      }

      const response = await requestJson<{ messages: NebulaChatMessage[] }>(`/api/chat/direct/${encodeURIComponent(dmUserId)}`);
      setChatMessages(response.messages);
      return;
    }

    const response = await requestJson<{ messages: NebulaChatMessage[] }>("/api/chat/general");
    setChatMessages(response.messages);
  }

  function updateChatMention(value: string, cursorPosition: number | null) {
    if (chatMode !== "general" || cursorPosition === null) {
      setChatMention(null);
      return;
    }

    const beforeCursor = value.slice(0, cursorPosition);
    const mentionMatch = beforeCursor.match(/(^|\s)@([a-z0-9_.-]*)$/i);
    if (!mentionMatch) {
      setChatMention(null);
      return;
    }

    setChatMention({
      start: beforeCursor.length - (mentionMatch[2]?.length ?? 0) - 1,
      query: mentionMatch[2] ?? ""
    });
  }

  function changeChatDraft(event: React.ChangeEvent<HTMLInputElement>) {
    setChatDraft(event.target.value);
    updateChatMention(event.target.value, event.target.selectionStart);
  }

  function selectChatMention(user: Pick<AuthUser, "id" | "username" | "displayName">) {
    if (!chatMention) {
      return;
    }

    const mentionName = user.id === novaChatUserId ? user.username : user.displayName.replace(/\s+/g, "");
    const mention = `@${mentionName} `;
    const cursorPosition = chatInputRef.current?.selectionStart ?? chatDraft.length;
    const nextDraft = `${chatDraft.slice(0, chatMention.start)}${mention}${chatDraft.slice(cursorPosition)}`;
    const nextCursorPosition = chatMention.start + mention.length;
    setChatDraft(nextDraft);
    setChatMention(null);
    window.setTimeout(() => {
      chatInputRef.current?.focus();
      chatInputRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    }, 0);
  }

  function handleChatComposerKeyDown(event: React.KeyboardEvent<HTMLInputElement>, suggestions: Array<Pick<AuthUser, "id" | "username" | "displayName">>) {
    if (event.key === "Escape" && chatMention) {
      event.preventDefault();
      setChatMention(null);
      return;
    }

    if ((event.key === "Tab" || event.key === "Enter") && chatMention && suggestions.length > 0) {
      event.preventDefault();
      selectChatMention(suggestions[0]);
    }
  }

  function addChatAttachments(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setChatAttachments((current) => [...current, ...files].slice(0, maxChatAttachments));
  }

  function removeChatAttachment(index: number) {
    setChatAttachments((current) => current.filter((_, candidateIndex) => candidateIndex !== index));
  }

  function selectChatAttachments(event: React.ChangeEvent<HTMLInputElement>) {
    addChatAttachments(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function pasteChatAttachments(event: React.ClipboardEvent<HTMLInputElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    addChatAttachments(files);
  }

  async function sendChatMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = chatDraft.trim();
    if (!body && chatAttachments.length === 0) {
      return;
    }

    setChatMessage(null);
    try {
      const url = chatMode === "direct" && selectedDmUserId
        ? `/api/chat/direct/${encodeURIComponent(selectedDmUserId)}`
        : "/api/chat/general";
      if (chatAttachments.length > 0) {
        const formData = new FormData();
        formData.append("body", body);
        chatAttachments.forEach((file) => formData.append("attachments", file, file.name));
        await requestJson<{ message: NebulaChatMessage }>(url, { method: "POST", body: formData });
      } else {
        await requestJson<{ message: NebulaChatMessage }>(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body })
        });
      }
      setChatDraft("");
      setChatAttachments([]);
      setChatMention(null);
      await Promise.all([loadChatMessages(), loadNotifications()]);
    } catch {
      setChatMessage("Nebula could not send that message.");
    }
  }

  async function loadNova() {
    const [statusResponse, conversationsResponse, memoryResponse] = await Promise.all([
      requestJson<{ status: NovaStatus }>("/api/nova/status"),
      requestJson<{ conversations: NovaConversation[] }>("/api/nova/conversations"),
      requestJson<{ memories: NovaMemory[] }>("/api/nova/memory")
    ]);

    setNovaStatus(statusResponse.status);
    setNovaConversations(conversationsResponse.conversations);
    setNovaMemories(memoryResponse.memories);
    setSelectedNovaConversationId((current) => current ?? conversationsResponse.conversations[0]?.id ?? null);
  }

  async function sendNovaMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitNovaDraft();
  }

  async function submitNovaDraft() {
    const body = novaDraft.trim();
    if (!body || novaBusy) {
      return;
    }

    setNovaDraft("");
    await submitNovaPrompt(body, selectedNovaConversationId ?? undefined);
  }

  function handleNovaDraftKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitNovaDraft();
    }
  }

  async function sendDashboardNovaMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = dashboardNovaDraft.trim();
    if (!body || novaBusy) {
      return;
    }

    setDashboardNovaDraft("");
    await submitNovaPrompt(body, dashboardNovaConversationId ?? undefined, { dashboardQuick: true });
  }

  async function submitNovaPrompt(body: string, conversationId?: string, options: { dashboardQuick?: boolean } = {}) {
    if (novaBusy) {
      return;
    }

    setNovaBusy(true);
    setNovaMessage(null);
    setPendingNovaPrompt({ body, conversationId });
    if (options.dashboardQuick) {
      setDashboardNovaReply(null);
    }
    try {
      const response = await requestJson<{ conversation: NovaConversation; message?: NovaMessage }>("/api/nova/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, conversationId })
      });
      setNovaConversations((current) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== response.conversation.id)
      ]);
      const assistantMessage = response.message
        ?? [...response.conversation.messages].reverse().find((message) => message.role === "assistant");
      if (assistantMessage) {
        setTypingNovaReply({
          body: assistantMessage.body,
          conversationId: response.conversation.id,
          dashboardQuick: Boolean(options.dashboardQuick),
          messageId: assistantMessage.id,
          prompt: body,
          visible: ""
        });
      }
      if (options.dashboardQuick) {
        setDashboardNovaConversationId(response.conversation.id);
        setDashboardNovaReply({ prompt: body, reply: assistantMessage?.body ?? "NOVA finished that request." });
      } else {
        setSelectedNovaConversationId(response.conversation.id);
      }
    } catch (error) {
      setNovaMessage(error instanceof Error ? error.message : "NOVA could not reach its model provider.");
    } finally {
      setPendingNovaPrompt(null);
      setNovaBusy(false);
    }
  }

  function novaMessageBody(message: { id: string; body: string }) {
    return typingNovaReply?.messageId === message.id ? typingNovaReply.visible : message.body;
  }

  async function createNovaMemory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = newNovaMemory.text.trim();
    if (!text) {
      return;
    }

    try {
      const response = await requestJson<{ memory: NovaMemory }>("/api/nova/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newNovaMemory, text })
      });
      setNewNovaMemory({ kind: "note", text: "", pinned: false });
      setNovaMemories((current) => [response.memory, ...current]);
    } catch {
      setNovaMessage("NOVA could not save that memory.");
    }
  }

  async function deleteNovaMemory(memoryId: string) {
    try {
      const response = await fetch(`/api/nova/memory/${memoryId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      setNovaMemories((current) => current.filter((memory) => memory.id !== memoryId));
    } catch {
      setNovaMessage("NOVA could not delete that memory.");
    }
  }

  async function deleteNovaConversation(conversationId: string) {
    if (deletingNovaConversationId) {
      return;
    }

    setNovaMessage(null);
    setDeletingNovaConversationId(conversationId);

    try {
      const response = await fetch(`/api/nova/conversations/${conversationId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      setNovaConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
      if (selectedNovaConversationId === conversationId) {
        setSelectedNovaConversationId(null);
      }
      if (dashboardNovaConversationId === conversationId) {
        setDashboardNovaConversationId(null);
        setDashboardNovaReply(null);
      }
      if (typingNovaReply?.conversationId === conversationId) {
        setTypingNovaReply(null);
      }
    } catch {
      setNovaMessage("NOVA could not delete that thread.");
    } finally {
      setDeletingNovaConversationId(null);
    }
  }

  async function loadNotifications() {
    const response = await requestJson<{ notifications: NebulaNotification[] }>("/api/notifications");
    setNotifications(response.notifications);
  }

  async function markNotificationRead(notificationId: string) {
    await requestJson<{ notification: NebulaNotification }>(`/api/notifications/${notificationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true })
    });
    await loadNotifications();
  }

  async function markAllNotificationsRead() {
    const response = await requestJson<{ notifications: NebulaNotification[] }>("/api/notifications/read-all", { method: "POST" });
    setNotifications(response.notifications);
  }

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserMessage(null);

    try {
      await requestJson<{ user: AuthUser }>("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUser.username,
          displayName: newUser.displayName || undefined,
          password: newUser.password,
          role: newUser.role
        })
      });
      setNewUser({ username: "", displayName: "", password: "", role: "user" });
      setUserMessage("User created.");
      await loadUsers();
    } catch {
      setUserMessage("Nebula could not create that user. Use a unique username and an 8+ character password.");
    }
  }

  async function approveAccountRequest(requestId: string, role: UserRole = "user") {
    setUserMessage(null);

    try {
      await requestJson<{ user: AuthUser }>(`/api/users/requests/${requestId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role })
      });
      setUserMessage("Account request approved.");
      await loadUsers();
    } catch {
      setUserMessage("Nebula could not approve that request.");
    }
  }

  async function rejectAccountRequest(requestId: string) {
    setUserMessage(null);

    try {
      const response = await fetch(`/api/users/requests/${requestId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      setUserMessage("Account request rejected.");
      await loadUsers();
    } catch {
      setUserMessage("Nebula could not reject that request.");
    }
  }

  async function deleteAccount(user: AuthUser) {
    setUserMessage(null);

    try {
      const response = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      setUserMessage(`${user.displayName} was deleted.`);
      await loadUsers();
    } catch {
      setUserMessage("Nebula could not delete that user. Keep at least one admin account.");
    }
  }

  useEffect(() => {
    if (route.section === "settings" && authStatus?.user?.role === "admin") {
      void loadUsers();
    }
  }, [route.section, authStatus?.user?.role]);

  useEffect(() => {
    if ((route.section === "chat" || route.section === "notifications") && authStatus?.user) {
      void loadDirectoryUsers();
    }
  }, [route.section, authStatus?.user?.id]);

  useEffect(() => {
    if (!authStatus?.user) {
      return;
    }

    void loadNotifications();
    const intervalId = window.setInterval(() => {
      void loadNotifications();
    }, notificationPollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [authStatus?.user?.id]);

  useEffect(() => {
    if (route.section === "chat" && authStatus?.user) {
      void loadChatMessages();
    }
  }, [route.section, chatMode, selectedDmUserId, authStatus?.user?.id]);

  useEffect(() => {
    if ((route.section === "nova" || route.section === "dashboard") && authStatus?.user) {
      void loadNova();
    }
  }, [route.section, authStatus?.user?.id]);

  useEffect(() => {
    if (route.section !== "chat" || !authStatus?.user) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadChatMessages();
    }, chatPollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [route.section, chatMode, selectedDmUserId, authStatus?.user?.id]);

  useEffect(() => {
    if (!typingNovaReply || typingNovaReply.visible.length >= typingNovaReply.body.length) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTypingNovaReply((current) => {
        if (!current) {
          return current;
        }

        const remaining = current.body.length - current.visible.length;
        const step = Math.min(Math.max(Math.ceil(remaining / 26), 2), 8);
        return {
          ...current,
          visible: current.body.slice(0, current.visible.length + step)
        };
      });
    }, 24);

    return () => window.clearTimeout(timeoutId);
  }, [typingNovaReply]);

  useEffect(() => {
    const routeTitle = route.section === "addon"
      ? installed.find((addon) => addon.id === route.addonId)?.name
        ?? catalog.find((addon) => addon.id === route.addonId)?.name
        ?? "Add-on"
      : navItems.find((item) => item.id === route.section)?.label ?? "Dashboard";
    const pageTitle = !authStatus
      ? "Loading Nebula"
      : authStatus.setupRequired
        ? "Create Admin Account"
        : !authStatus.user
          ? authView === "register" ? "Request Account" : "Sign In"
          : routeTitle;

    document.title = `${pageTitle} | Nebula`;
  }, [authStatus, authView, catalog, installed, route]);

  if (!authStatus) {
    return <AuthShell title="Loading Nebula" subtitle="Checking your session..." />;
  }

  if (authStatus.setupRequired) {
    return (
      <AuthShell title="Create Admin Account" subtitle="Set up the first Nebula administrator.">
        <AuthForm busy={authBusy} message={authMessage} mode="setup" onSubmit={(values) => submitAuth("setup", values)} />
      </AuthShell>
    );
  }

  if (!authStatus.user) {
    const isRegistering = authView === "register";
    return (
      <AuthShell title={isRegistering ? "Request Account" : "Sign In"} subtitle={isRegistering ? "Create a Nebula account request for an admin to approve." : "Use your Nebula account to open the portal."}>
        <AuthForm busy={authBusy} message={authMessage} mode={authView} onSubmit={(values) => submitAuth(authView, values)} />
        <button
          className="auth-switch"
          onClick={() => {
            setAuthMessage(null);
            setAuthView(isRegistering ? "login" : "register");
          }}
          type="button"
        >
          {isRegistering ? "Back to sign in" : "Create account"}
        </button>
      </AuthShell>
    );
  }

  const installedIds = new Set(installed.map((addon) => addon.id));
  const installedById = new Map(installed.map((addon) => [addon.id, addon]));
  const currentUser = authStatus.user;
  const canManagePlatform = authStatus.user.role === "admin";
  const needsGitHubToken = Boolean(githubAuth.catalogLocked) || (catalogSource.type === "remote" && !githubAuth.configured);
  const activeAddon = route.section === "addon" ? installed.find((addon) => addon.id === route.addonId) : undefined;
  const activeManifest = route.section === "addon" ? catalog.find((addon) => addon.id === route.addonId) : undefined;
  const activeNovaConversation = selectedNovaConversationId
    ? novaConversations.find((conversation) => conversation.id === selectedNovaConversationId)
    : undefined;
  const showPendingNovaPrompt = Boolean(pendingNovaPrompt)
    && (pendingNovaPrompt?.conversationId ? pendingNovaPrompt.conversationId === selectedNovaConversationId : !selectedNovaConversationId);
  const dashboardTypingReply = typingNovaReply?.dashboardQuick ? typingNovaReply : null;
  const activeTitle = route.section === "addon"
    ? activeAddon?.name ?? activeManifest?.name ?? "Add-on"
    : navItems.find((item) => item.id === route.section)?.label ?? "Dashboard";
  const visibleNavItems = canManagePlatform ? navItems : navItems.filter((item) => item.id !== "store");
  const unreadNotifications = notifications.filter((notification) => !notification.readAt).length;
  const chatMentionOptions: Array<Pick<AuthUser, "id" | "username" | "displayName">> = [novaMentionUser, ...directoryUsers];
  const chatMentionSuggestions = chatMention
    ? chatMentionOptions
      .filter((user) => {
        const query = chatMention.query.toLowerCase();
        return user.username.toLowerCase().includes(query) || user.displayName.toLowerCase().includes(query);
      })
      .slice(0, 6)
    : [];
  const showChatMentionSuggestions = chatMode === "general" && chatMention !== null && chatMentionSuggestions.length > 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <Cloud size={25} />
          </div>
          <div>
            <p>Nebula</p>
            <span>Local Core</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary navigation">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={route.section === item.id ? "nav-item active" : "nav-item"}
                key={item.id}
                onClick={() => navigate({ section: item.id })}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.id === "notifications" && unreadNotifications > 0 && <span className="nav-badge">{unreadNotifications}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <ShieldCheck size={18} />
          <div>
            <strong>{authStatus.user.displayName}</strong>
            <span>{authStatus.user.role}</span>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <span className="eyebrow">Nebula Portal</span>
            <h1>{activeTitle}</h1>
          </div>
          <div className="search-box">
            <Search size={18} />
            <span>Search apps and settings</span>
          </div>
          <button className="secondary-action" onClick={logout} type="button">
            <LogOut size={18} />
            Logout
          </button>
        </header>

        {route.section === "dashboard" && (
          <section className="content-grid dashboard-grid">
            <div className="hero-panel">
              <div className="hero-copy">
                <span className="eyebrow">Local Development</span>
                <h2>Welcome {currentUser.displayName} to Nebula.</h2>
                <p>
                  Build the portal locally, install add-ons into Nebula state, then package the same core into one
                  server container.
                </p>
                {canManagePlatform && (
                  <button className="primary-action" onClick={() => navigate({ section: "store" })} type="button">
                    <PackagePlus size={18} />
                    Open App Store
                  </button>
                )}
              </div>
              <div className="orbital-map" aria-hidden="true">
                <span className="orbit one" />
                <span className="orbit two" />
                <span className="node node-a" />
                <span className="node node-b" />
                <span className="node node-c" />
                <Cloud className="core-cloud" size={54} />
              </div>
            </div>

            {canManagePlatform && (
              <>
                <MetricCard icon={Gauge} label="Installed" value={summary.installedCount} />
                <MetricCard icon={PackagePlus} label="Available" value={summary.availableCount} />
                <MetricCard icon={CheckCircle2} label="Enabled" value={summary.enabledCount} />
              </>
            )}

            <section className="panel dashboard-nova-card">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">NOVA</span>
                  <h2>Assistant</h2>
                </div>
                <span className={novaStatus?.reachable ? "soft-pill nova-ready" : "soft-pill nova-offline"}>
                  {novaStatus?.reachable ? "Online" : "Offline"}
                </span>
              </div>
              <div className="dashboard-nova-stats">
                <span>{novaConversations.length} thread{novaConversations.length === 1 ? "" : "s"}</span>
                <span>{novaMemories.length} memor{novaMemories.length === 1 ? "y" : "ies"}</span>
                <span>{novaStatus?.provider.model ?? "No model"}</span>
              </div>
              <form className="dashboard-nova-form" onSubmit={sendDashboardNovaMessage}>
                <input
                  disabled={novaBusy || novaStatus?.enabled === false}
                  onChange={(event) => setDashboardNovaDraft(event.target.value)}
                  placeholder="Ask NOVA from the dashboard"
                  value={dashboardNovaDraft}
                />
                <button className="primary-action compact-action" disabled={novaBusy || novaStatus?.enabled === false} type="submit">
                  <Sparkles size={16} />
                  Ask
                </button>
              </form>
              {novaBusy && route.section === "dashboard" && (
                <div className="dashboard-nova-reply" aria-live="polite">
                  <strong>NOVA</strong>
                  <span className="typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="sr-only">NOVA is typing</span>
                </div>
              )}
              {dashboardNovaReply && !novaBusy && (
                <div className="dashboard-nova-reply">
                  <strong>NOVA</strong>
                  <p>{dashboardTypingReply?.visible || dashboardNovaReply.reply}</p>
                </div>
              )}
              <button className="text-action" onClick={() => navigate({ section: "nova" })} type="button">Open full chat</button>
              {novaMessage && route.section === "dashboard" && <p className="github-message">{novaMessage}</p>}
            </section>

            <section className="panel wide-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Installed Add-ons</span>
                  <h2>Launchpad</h2>
                </div>
              </div>
              {installed.length > 0 ? (
                <div className="launch-grid">
                  {installed.map((addon) => (
                    <AddonLaunchTile addon={addon} key={addon.id} onOpen={() => navigate({ section: "addon", addonId: addon.id })} />
                  ))}
                </div>
              ) : (
                <EmptyState action={() => navigate({ section: "store" })} />
              )}
            </section>
          </section>
        )}

        {route.section === "nova" && (
          <section className="panel page-panel chat-panel nova-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Local Assistant</span>
                <h2>NOVA</h2>
              </div>
              <span className={novaStatus?.reachable ? "soft-pill nova-ready" : "soft-pill nova-offline"}>
                {novaStatus?.reachable ? `${novaStatus.provider.model} online` : "Provider offline"}
              </span>
            </div>

            <div className="chat-layout nova-layout">
              <aside className="chat-sidebar nova-sidebar">
                <button className={!selectedNovaConversationId ? "chat-target active" : "chat-target"} onClick={() => setSelectedNovaConversationId(null)} type="button">
                  <Sparkles size={18} />
                  <span>New conversation</span>
                </button>
                {novaConversations.map((conversation) => (
                  <div className={activeNovaConversation?.id === conversation.id ? "chat-target-row active" : "chat-target-row"} key={conversation.id}>
                    <button
                      className="chat-target thread-target"
                      onClick={() => setSelectedNovaConversationId(conversation.id)}
                      type="button"
                    >
                      <MessageCircle size={18} />
                      <span>{conversation.title}</span>
                    </button>
                    <button
                      className="icon-button thread-delete-button"
                      disabled={Boolean(deletingNovaConversationId)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteNovaConversation(conversation.id);
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      title={`Delete ${conversation.title}`}
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </aside>

              <section className="chat-thread" aria-live="polite">
                <div className="message-list">
                  {activeNovaConversation?.messages.map((message) => (
                    <article className={message.role === "user" ? "chat-message own" : "chat-message nova-response"} key={message.id}>
                      <div>
                        <strong>{message.role === "user" ? currentUser.displayName : "NOVA"}</strong>
                        <time>{formatLocalDateTime(message.createdAt)}</time>
                      </div>
                      <p>{novaMessageBody(message)}</p>
                    </article>
                  ))}
                  {showPendingNovaPrompt && pendingNovaPrompt && (
                    <>
                      <article className="chat-message own pending-message">
                        <div>
                          <strong>{currentUser.displayName}</strong>
                          <time>Sending</time>
                        </div>
                        <p>{pendingNovaPrompt.body}</p>
                      </article>
                      <article className="chat-message nova-response typing-message" aria-label="NOVA is typing">
                        <div>
                          <strong>NOVA</strong>
                          <time>Typing</time>
                        </div>
                        <p>
                          <span className="typing-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                          <span className="sr-only">NOVA is typing</span>
                        </p>
                      </article>
                    </>
                  )}
                  {!activeNovaConversation?.messages.length && !showPendingNovaPrompt && (
                    <div className="empty-state compact-empty">
                      <Sparkles size={28} />
                      <h3>NOVA is ready</h3>
                    </div>
                  )}
                </div>
                <form className="chat-composer" onSubmit={sendNovaMessage}>
                  <textarea
                    disabled={novaBusy || novaStatus?.enabled === false}
                    onKeyDown={handleNovaDraftKeyDown}
                    onChange={(event) => setNovaDraft(event.target.value)}
                    placeholder="Ask NOVA"
                    rows={1}
                    value={novaDraft}
                  />
                  <button className="primary-action" disabled={novaBusy || novaStatus?.enabled === false} type="submit">
                    <Sparkles size={18} />
                    {novaBusy ? "Thinking" : "Send"}
                  </button>
                </form>
                {novaMessage && <p className="github-message">{novaMessage}</p>}
              </section>

              <aside className="chat-sidebar nova-memory-panel">
                <div className="nova-memory-heading">
                  <strong>Memory</strong>
                  <span>{novaMemories.length}</span>
                </div>
                <form className="nova-memory-form" onSubmit={createNovaMemory}>
                  <select
                    onChange={(event) => setNewNovaMemory((current) => ({ ...current, kind: event.target.value as NovaMemoryKind }))}
                    value={newNovaMemory.kind}
                  >
                    <option value="note">Note</option>
                    <option value="preference">Preference</option>
                    <option value="fact">Fact</option>
                    <option value="project">Project</option>
                    <option value="instruction">Instruction</option>
                  </select>
                  <input
                    onChange={(event) => setNewNovaMemory((current) => ({ ...current, text: event.target.value }))}
                    placeholder="Remember this"
                    value={newNovaMemory.text}
                  />
                  <label className="nova-memory-pin">
                    <input
                      checked={newNovaMemory.pinned}
                      onChange={(event) => setNewNovaMemory((current) => ({ ...current, pinned: event.target.checked }))}
                      type="checkbox"
                    />
                    Pinned
                  </label>
                  <button className="secondary-action compact-action" type="submit">Save</button>
                </form>
                <div className="nova-memory-list">
                  {novaMemories.length > 0 ? novaMemories.map((memory) => (
                    <article className="nova-memory-card" key={memory.id}>
                      <div>
                        <span className="soft-pill">{memory.kind}</span>
                        {memory.pinned && <span className="soft-pill nova-ready">Pinned</span>}
                      </div>
                      <p>{memory.text}</p>
                      <button className="icon-button" onClick={() => deleteNovaMemory(memory.id)} title="Delete memory" type="button">
                        <Trash2 size={16} />
                      </button>
                    </article>
                  )) : (
                    <div className="empty-state compact-empty">
                      <Sparkles size={28} />
                      <h3>No memories yet</h3>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </section>
        )}

        {route.section === "chat" && (
          <section className="panel page-panel chat-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Core Chat</span>
                <h2>Messages</h2>
              </div>
              <div className="segmented-control" aria-label="Chat mode">
                <button className={chatMode === "general" ? "active" : ""} onClick={() => setChatMode("general")} type="button">General</button>
                <button className={chatMode === "direct" ? "active" : ""} onClick={() => setChatMode("direct")} type="button">DMs</button>
              </div>
            </div>

            <div className="chat-layout">
              <aside className="chat-sidebar">
                <button className={chatMode === "general" ? "chat-target active" : "chat-target"} onClick={() => setChatMode("general")} type="button">
                  <MessageCircle size={18} />
                  <span>General server chat</span>
                </button>
                {directoryUsers.map((user) => (
                  <button
                    className={chatMode === "direct" && selectedDmUserId === user.id ? "chat-target active" : "chat-target"}
                    key={user.id}
                    onClick={() => {
                      setChatMode("direct");
                      setSelectedDmUserId(user.id);
                    }}
                    type="button"
                  >
                    <span className="avatar-dot">{user.displayName.slice(0, 1).toUpperCase()}</span>
                    <span>{user.displayName}</span>
                  </button>
                ))}
              </aside>

              <section className="chat-thread" aria-live="polite">
                <div className="message-list">
                  {chatMessages.length > 0 ? chatMessages.map((message) => (
                    <article className={message.senderUserId === currentUser.id ? "chat-message own" : message.senderUserId === novaChatUserId ? "chat-message nova-response" : "chat-message"} key={message.id}>
                      <div>
                        <strong>{message.senderDisplayName}</strong>
                        <time>{formatLocalDateTime(message.createdAt)}</time>
                      </div>
                      {message.body && <p>{message.body}</p>}
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="chat-attachments">
                          {message.attachments.map((attachment) => attachment.kind === "image" ? (
                            <a className="chat-image-attachment" href={attachment.contentUrl} key={attachment.id} target="_blank" rel="noreferrer">
                              <img alt={attachment.filename} src={attachment.contentUrl} />
                            </a>
                          ) : (
                            <a className="chat-file-attachment" href={attachment.contentUrl} key={attachment.id} target="_blank" rel="noreferrer">
                              <Paperclip size={16} />
                              <span>
                                <strong>{attachment.filename}</strong>
                                <small>{formatFileSize(attachment.size)}</small>
                              </span>
                            </a>
                          ))}
                        </div>
                      )}
                    </article>
                  )) : (
                    <div className="empty-state compact-empty">
                      <MessageCircle size={28} />
                      <h3>No messages yet</h3>
                    </div>
                  )}
                </div>
                <form className="chat-composer" onSubmit={sendChatMessage}>
                  <div className="mention-composer-field">
                    {chatAttachments.length > 0 && (
                      <div className="pending-attachments">
                        {chatAttachments.map((file, index) => (
                          <div className="pending-attachment" key={`${file.name}-${file.size}-${index}`}>
                            <Paperclip size={15} />
                            <span>
                              <strong>{file.name || "Pasted image"}</strong>
                              <small>{formatFileSize(file.size)}</small>
                            </span>
                            <button onClick={() => removeChatAttachment(index)} title={`Remove ${file.name || "attachment"}`} type="button">
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {showChatMentionSuggestions && (
                      <div className="mention-suggestions" role="listbox">
                        {chatMentionSuggestions.map((user) => (
                          <button
                            key={user.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectChatMention(user)}
                            role="option"
                            type="button"
                          >
                            <span className={user.id === novaChatUserId ? "avatar-dot nova-dot" : "avatar-dot"}>{user.displayName.slice(0, 1).toUpperCase()}</span>
                            <span>
                              <strong>{user.displayName}</strong>
                              <small>@{user.username}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      disabled={chatMode === "direct" && !selectedDmUserId}
                      onBlur={() => window.setTimeout(() => setChatMention(null), 120)}
                      onChange={changeChatDraft}
                      onClick={(event) => updateChatMention(event.currentTarget.value, event.currentTarget.selectionStart)}
                      onFocus={(event) => updateChatMention(event.currentTarget.value, event.currentTarget.selectionStart)}
                      onKeyDown={(event) => handleChatComposerKeyDown(event, chatMentionSuggestions)}
                      onPaste={pasteChatAttachments}
                      placeholder={chatMode === "direct" ? "Message this user" : "Message everyone"}
                      ref={chatInputRef}
                      value={chatDraft}
                    />
                  </div>
                  <input
                    accept="image/*,.pdf,.txt,.md,.json,.csv,.zip"
                    hidden
                    multiple
                    onChange={selectChatAttachments}
                    ref={chatFileInputRef}
                    type="file"
                  />
                  <button
                    className="icon-button chat-attach-button"
                    disabled={chatMode === "direct" && !selectedDmUserId}
                    onClick={() => chatFileInputRef.current?.click()}
                    title="Attach files"
                    type="button"
                  >
                    <Paperclip size={18} />
                  </button>
                  <button className="primary-action" disabled={chatMode === "direct" && !selectedDmUserId} type="submit">
                    <MessageCircle size={18} />
                    Send
                  </button>
                </form>
                {chatMessage && <p className="github-message">{chatMessage}</p>}
              </section>
            </div>
          </section>
        )}

        {route.section === "notifications" && (
          <section className="panel page-panel notifications-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Inbox</span>
                <h2>Notifications</h2>
              </div>
              <button className="secondary-action" disabled={unreadNotifications === 0} onClick={markAllNotificationsRead} type="button">
                <CheckCircle2 size={18} />
                Mark all read
              </button>
            </div>
            <div className="notification-list">
              {notifications.length > 0 ? notifications.map((notification) => (
                <article className={notification.readAt ? "notification-row" : "notification-row unread"} key={notification.id}>
                  <Bell size={18} />
                  <div>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    <time>{formatLocalDateTime(notification.createdAt)}</time>
                  </div>
                  {!notification.readAt && (
                    <button className="secondary-action compact-action" onClick={() => markNotificationRead(notification.id)} type="button">
                      Mark read
                    </button>
                  )}
                </article>
              )) : (
                <div className="empty-state compact-empty">
                  <Bell size={28} />
                  <h3>No notifications</h3>
                </div>
              )}
            </div>
          </section>
        )}

        {route.section === "store" && (
          <section className="panel page-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Catalog</span>
                <h2>Add-ons</h2>
              </div>
              <div className="catalog-actions">
                <span className="soft-pill" title={catalogSource.location}>{catalogSource.label}</span>
                {canManagePlatform && !needsGitHubToken && (
                  <button className="secondary-action compact-action" disabled={catalogRefreshing} onClick={refreshCatalog} type="button">
                    {catalogRefreshing ? <span className="loading-spinner" aria-hidden="true" /> : <RefreshCw size={16} />}
                    Refresh
                  </button>
                )}
                {canManagePlatform && !needsGitHubToken && (
                  <button className="secondary-action compact-action" onClick={() => setShowGitHubSettings((current) => !current)} type="button">
                    <Github size={16} />
                    Private Catalog
                  </button>
                )}
              </div>
            </div>
            {canManagePlatform && (needsGitHubToken || showGitHubSettings) ? (
              <GitHubConnectionPanel
                auth={githubAuth}
                busy={githubBusy}
                catalogUrl={githubCatalogUrl}
                message={githubMessage}
                onConnect={connectGitHub}
                onCatalogUrlChange={setGithubCatalogUrl}
                onTokenChange={setGithubToken}
                token={githubToken}
              />
            ) : !canManagePlatform ? (
              <div className="store-notice">Users can browse installed apps. Ask an admin to install or update add-ons.</div>
            ) : null}
            {storeMessage && (
              <div className={`store-notice ${storeMessage.kind}`} role="status">
                {storeMessage.text}
              </div>
            )}
            {needsGitHubToken ? (
              <div className="empty-state catalog-gate">
                <Github size={30} />
                <h3>Connect GitHub to browse this catalog</h3>
                <p>The active catalog is remote. Add a GitHub token above so Nebula can read private catalog data.</p>
              </div>
            ) : (
              catalog.length > 0 ? (
                <div className="addon-grid">
                  {catalog.map((addon) => (
                    <AddonStoreCard
                      addon={addon}
                      busy={busyAddon === addon.id}
                      canManage={canManagePlatform}
                      installedAddon={installedById.get(addon.id)}
                      key={addon.id}
                      onInstall={() => installAddon(addon.id)}
                      onUninstall={() => uninstallAddon(addon.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state catalog-gate">
                  <PackagePlus size={30} />
                  <h3>No add-ons found</h3>
                  <p>Nebula did not find any add-ons in this catalog.</p>
                </div>
              )
            )}
          </section>
        )}

        {route.section === "installed" && (
          <section className="panel page-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Runtime</span>
                <h2>Installed Add-ons</h2>
              </div>
              <span className="soft-pill">{installed.length} active record{installed.length === 1 ? "" : "s"}</span>
            </div>
            {installed.length > 0 ? (
              <div className="installed-list">
                {installed.map((addon) => (
                  <div className="installed-row" key={addon.id}>
                    <AddonIcon color={addon.color} icon={addon.icon} />
                    <button className="installed-link" onClick={() => navigate({ section: "addon", addonId: addon.id })} type="button">
                      <strong>{addon.name}</strong>
                      <span>{addon.route}</span>
                    </button>
                    <span className="status-dot">{addon.status}</span>
                    {canManagePlatform && (
                      <button
                        className="icon-button"
                        disabled={busyAddon === addon.id}
                        onClick={() => uninstallAddon(addon.id)}
                        title={`Uninstall ${addon.name}`}
                        type="button"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState action={() => navigate({ section: "store" })} />
            )}
          </section>
        )}

        {route.section === "settings" && (
          <section className="content-grid settings-grid">
            <section className="panel">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Platform</span>
                  <h2>Core</h2>
                </div>
                <span className="soft-pill">v{summary.version}</span>
              </div>
              <SettingRow icon={CheckCircle2} label="Core version" value={`v${summary.version}`} />
              <SettingRow icon={HardDrive} label="Data path" value=".nebula-data" />
              <SettingRow icon={Cloud} label="Server mode" value="Local development" />
              <SettingRow icon={Sparkles} label="Add-on runtime" value="UI modules first" />
            </section>
            <section className="panel">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Install Policy</span>
                  <h2>Permissions</h2>
                </div>
              </div>
              <div className="permission-list">
                {[
                  "storage.read",
                  "storage.write",
                  "settings.read",
                  "settings.write",
                  "notifications.send"
                ].map((permission) => (
                  <span className="permission-chip" key={permission}>{permission}</span>
                ))}
              </div>
            </section>
            {canManagePlatform && (
              <section className="panel users-panel">
                <div className="section-heading compact">
                  <div>
                    <span className="eyebrow">Access</span>
                    <h2>Users</h2>
                  </div>
                </div>
                {pendingRequests.length > 0 && (
                  <div className="approval-list">
                    {pendingRequests.map((request) => (
                      <div className="approval-row" key={request.id}>
                        <div>
                          <strong>{request.displayName}</strong>
                          <span>{request.username}</span>
                        </div>
                        <span className="soft-pill">Pending</span>
                        <div className="approval-actions">
                          <button className="primary-action compact-action" onClick={() => approveAccountRequest(request.id)} type="button">
                            <UserCheck size={16} />
                            Approve
                          </button>
                          <button className="secondary-action compact-action" onClick={() => rejectAccountRequest(request.id)} type="button">
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <form className="user-form" onSubmit={createAccount}>
                  <input
                    onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))}
                    placeholder="username"
                    value={newUser.username}
                  />
                  <input
                    onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))}
                    placeholder="display name"
                    value={newUser.displayName}
                  />
                  <input
                    onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
                    placeholder="temporary password"
                    type="password"
                    value={newUser.password}
                  />
                  <select
                    onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as UserRole }))}
                    value={newUser.role}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="primary-action" type="submit">
                    <UserPlus size={18} />
                    Create User
                  </button>
                </form>
                {userMessage && <p className="github-message">{userMessage}</p>}
                <div className="user-list">
                  {users.map((user) => (
                    <div className="user-row" key={user.id}>
                      <strong>{user.displayName}</strong>
                      <span>{user.username}</span>
                      <span className="soft-pill">{user.role}</span>
                      {user.id === currentUser.id ? (
                        <span className="soft-pill">Current</span>
                      ) : (
                        <button className="icon-button" onClick={() => deleteAccount(user)} title={`Delete ${user.displayName}`} type="button">
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </section>
        )}

        {route.section === "addon" && (
          <AddonRouteScreen
            addon={activeAddon}
            manifest={activeManifest}
            onBack={() => navigate({ section: "dashboard" })}
            onStore={() => navigate({ section: "store" })}
          />
        )}
      </main>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: number }) {
  return (
    <section className="metric-card">
      <Icon size={21} />
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

function AuthShell({ children, subtitle, title }: { children?: React.ReactNode; subtitle: string; title: string }) {
  return (
    <main className="auth-shell">
      <div className="auth-nebula" aria-hidden="true">
        <span className="nebula-cloud cloud-one" />
        <span className="nebula-cloud cloud-two" />
        <span className="nebula-cloud cloud-three" />
        <span className="nebula-rift" />
      </div>
      <section className="auth-card panel">
        <div className="brand-mark">
          <Cloud size={25} />
        </div>
        <span className="eyebrow">Nebula Portal</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {children}
      </section>
    </main>
  );
}

function AuthForm({
  busy,
  message,
  mode,
  onSubmit
}: {
  busy: boolean;
  message: string | null;
  mode: "login" | "register" | "setup";
  onSubmit: (values: { username: string; displayName?: string; password: string }) => void;
}) {
  const [values, setValues] = useState({ username: "", displayName: "", password: "" });

  return (
    <form className="auth-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit(values);
    }}>
      <input
        autoComplete="username"
        onChange={(event) => setValues((current) => ({ ...current, username: event.target.value }))}
        placeholder="username"
        required
        value={values.username}
      />
      {mode !== "login" && (
        <input
          onChange={(event) => setValues((current) => ({ ...current, displayName: event.target.value }))}
          placeholder="display name"
          value={values.displayName}
        />
      )}
      <input
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        minLength={mode === "login" ? 1 : 8}
        onChange={(event) => setValues((current) => ({ ...current, password: event.target.value }))}
        placeholder="password"
        required
        type="password"
        value={values.password}
      />
      <button className="primary-action" disabled={busy} type="submit">
        {busy && <span className="loading-spinner" aria-hidden="true" />}
        {mode === "setup" ? "Create Admin" : mode === "register" ? "Request Account" : "Sign In"}
      </button>
      {message && <p className="auth-message">{message}</p>}
    </form>
  );
}

function AddonIcon({ color, icon }: { color: string; icon: string }) {
  const Icon = iconMap[icon as keyof typeof iconMap] ?? Sparkles;
  return (
    <div className="addon-icon" style={{ backgroundColor: color }}>
      <Icon size={22} />
    </div>
  );
}

function AddonStoreCard({
  addon,
  busy,
  canManage,
  installedAddon,
  onInstall,
  onUninstall
}: {
  addon: AddonManifest;
  busy: boolean;
  canManage: boolean;
  installedAddon?: InstalledAddon;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const installed = Boolean(installedAddon);
  const hasUpdate = installedAddon ? compareVersions(addon.version, installedAddon.version) > 0 : false;
  const primaryLabel = busy ? hasUpdate ? "Updating" : installed ? "Removing" : "Installing" : hasUpdate ? "Update" : installed ? "Uninstall" : "Install";

  return (
    <article className="addon-card">
      <div className="addon-card-top">
        <AddonIcon color={addon.color} icon={addon.icon} />
        <div>
          <h3>{addon.name}</h3>
          <span>{installedAddon ? `Installed v${installedAddon.version}` : `v${addon.version}`}</span>
        </div>
      </div>
      <p>{addon.description}</p>
      {hasUpdate && <span className="update-pill">Update available: v{addon.version}</span>}
      <div className="permission-list tight">
        {addon.permissions.map((permission) => (
          <span className="permission-chip" key={permission}>{permission}</span>
        ))}
      </div>
      {canManage ? (
        <button
          className={installed && !hasUpdate ? "secondary-action" : "primary-action"}
          disabled={busy}
          onClick={installed && !hasUpdate ? onUninstall : onInstall}
          type="button"
        >
          {busy ? <span className="loading-spinner" aria-hidden="true" /> : installed && !hasUpdate ? <Trash2 size={18} /> : <PackagePlus size={18} />}
          {primaryLabel}
        </button>
      ) : (
        <span className="soft-pill">Admin managed</span>
      )}
    </article>
  );
}

function GitHubConnectionPanel({
  auth,
  busy,
  catalogUrl,
  message,
  onConnect,
  onCatalogUrlChange,
  onTokenChange,
  token
}: {
  auth: GitHubAuthStatus;
  busy: boolean;
  catalogUrl: string;
  message: string | null;
  onConnect: (event: React.FormEvent<HTMLFormElement>) => void;
  onCatalogUrlChange: (catalogUrl: string) => void;
  onTokenChange: (token: string) => void;
  token: string;
}) {
  const [showCatalogUrlInput, setShowCatalogUrlInput] = useState(false);
  const showCatalogUrl = showCatalogUrlInput || catalogUrl.trim().length > 0;

  return (
    <section className="github-panel">
      <div className="github-panel-copy">
        <Github size={20} />
        <div>
          <strong>{auth.configured ? "GitHub connected" : "Connect GitHub"}</strong>
          <span>
            {auth.configured
              ? `Token source: ${getGitHubSourceLabel(auth.source)}`
              : "Use a fine-grained token only when installing from private add-on repos."}
          </span>
        </div>
      </div>
      <form className="github-token-form" onSubmit={onConnect}>
        {showCatalogUrl && (
          <>
            <label className="sr-only" htmlFor="githubCatalogUrl">GitHub catalog URL</label>
            <input
              autoComplete="off"
              className="github-catalog-input"
              id="githubCatalogUrl"
              onChange={(event) => onCatalogUrlChange(event.target.value)}
              placeholder="https://raw.githubusercontent.com/owner/repo/main/catalog.json"
              type="url"
              value={catalogUrl}
            />
          </>
        )}
        <label className="sr-only" htmlFor="githubToken">GitHub token</label>
        <input
          autoComplete="off"
          id="githubToken"
          onChange={(event) => onTokenChange(event.target.value)}
          placeholder="github_pat_..."
          type="password"
          value={token}
        />
        <button className="primary-action" disabled={busy || token.trim().length === 0} type="submit">
          {busy ? "Connecting" : auth.configured ? "Update Token" : "Connect"}
        </button>
      </form>
      {!showCatalogUrl && (
        <button className="text-action" onClick={() => setShowCatalogUrlInput(true)} type="button">
          Use a private catalog URL
        </button>
      )}
      {message && <p className="github-message">{message}</p>}
    </section>
  );
}

function getGitHubSourceLabel(source: GitHubAuthStatus["source"]) {
  if (source === "environment") {
    return "server environment";
  }

  if (source === "saved") {
    return "saved local config";
  }

  if (source === "runtime") {
    return "this local session";
  }

  return "not connected";
}

function AddonLaunchTile({ addon, onOpen }: { addon: InstalledAddon; onOpen: () => void }) {
  return (
    <button className="launch-tile" onClick={onOpen} type="button">
      <AddonIcon color={addon.color} icon={addon.icon} />
      <span>{addon.name}</span>
      <ExternalLink size={16} />
    </button>
  );
}

function AddonRouteScreen({
  addon,
  manifest,
  onBack,
  onStore
}: {
  addon?: InstalledAddon;
  manifest?: AddonManifest;
  onBack: () => void;
  onStore: () => void;
}) {
  if (!addon) {
    return (
      <section className="panel page-panel addon-route-panel">
        <div className="empty-state">
          <PackagePlus size={30} />
          <h3>Add-on is not installed</h3>
          <p>Install this add-on before opening its Nebula route.</p>
          <button className="primary-action" onClick={onStore} type="button">
            <PackagePlus size={18} />
            Open App Store
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={addon.entryUrl ? "panel page-panel addon-route-panel live-addon-route" : "panel page-panel addon-route-panel"}>
      <div className="section-heading">
        <div className="addon-route-title">
          <AddonIcon color={addon.color} icon={addon.icon} />
          <div>
            <span className="eyebrow">Nebula Add-on Route</span>
            <h2>{addon.name}</h2>
          </div>
        </div>
        <button className="secondary-action" onClick={onBack} type="button">
          <Undo2 size={18} />
          Back to Dashboard
        </button>
      </div>

      <div className={addon.entryUrl ? "addon-runtime-grid live-runtime-grid" : "addon-runtime-grid"}>
        {addon.entryUrl ? (
          <iframe className="addon-frame" src={addon.entryUrl} title={addon.name} />
        ) : (
          <section className="addon-runtime-card primary">
            <span className="soft-pill">{addon.route}</span>
            <h3>This add-on route is active.</h3>
            <p>
              This add-on is installed as metadata only. Add a package URL to its catalog manifest to load a real
              frontend module here.
            </p>
          </section>
        )}

        <section className="addon-runtime-card">
          <span className="eyebrow">Install Record</span>
          <dl className="addon-facts">
            <div>
              <dt>Version</dt>
              <dd>{addon.version}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{addon.status}</dd>
            </div>
            <div>
              <dt>Installed</dt>
              <dd>{formatLocalDateTime(addon.installedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="addon-runtime-card">
          <span className="eyebrow">Manifest</span>
          {manifest ? (
            <>
              <p>{manifest.description}</p>
              <div className="permission-list">
                {manifest.permissions.map((permission) => (
                  <span className="permission-chip" key={permission}>{permission}</span>
                ))}
              </div>
            </>
          ) : (
            <p>Manifest metadata is not available for this installed add-on.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function SettingRow({ icon: Icon, label, value }: { icon: typeof Cloud; label: string; value: string }) {
  return (
    <div className="setting-row">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ action }: { action: () => void }) {
  return (
    <div className="empty-state">
      <PackagePlus size={30} />
      <h3>No add-ons installed</h3>
      <button className="primary-action" onClick={action} type="button">
        <PackagePlus size={18} />
        Browse Add-ons
      </button>
    </div>
  );
}

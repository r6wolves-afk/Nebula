import type { AuthUser, NovaMessage, NovaProvider, NovaStatus } from "@nebula/shared";

const defaultProvider: NovaProvider = {
  id: "local-ollama",
  name: "Local Ollama",
  kind: "ollama",
  baseUrl: process.env.NEBULA_NOVA_BASE_URL ?? "http://127.0.0.1:11434",
  model: process.env.NEBULA_NOVA_MODEL ?? "qwen2.5:7b",
  enabled: process.env.NEBULA_NOVA_ENABLED !== "false",
  priority: 0,
  roles: ["chat", "reasoning", "summarization", "memory"],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

type OllamaChatResponse = {
  message?: {
    content?: unknown;
  };
};

type OllamaVersionResponse = {
  version?: unknown;
};

function cleanBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function novaEnabled() {
  return process.env.NEBULA_NOVA_ENABLED !== "false";
}

function nebulaContext(user: AuthUser) {
  return [
    "Nebula is this self-hosted local portal. Nebula is not the assistant, not a fictional place, and not an outside product.",
    "Nebula provides one login, a persistent data directory, installable add-ons, a GitHub-powered app store, built-in chat, notifications, per-user add-on JSON storage, and per-user add-on file storage.",
    "NOVA is the local personal assistant inside Nebula. NOVA runs through the Nebula API so user identity, provider access, conversations, and memory stay server-side.",
    "When distinguishing names: Nebula is the portal/platform. NOVA is the assistant.",
    "NOVA can currently use a server-side tool to create notes in the Nebula Notes add-on when the user asks for a note to be created.",
    `The current signed-in Nebula user is ${user.displayName} with role ${user.role}.`,
    "If a user asks what Nebula is, describe this local portal and its current capabilities. Do not invent lore, companies, planets, or unrelated product history.",
    "If you do not have live data for a question, say what you know from Nebula context and what would need a future Nebula tool integration."
  ].join("\n");
}

function novaBehavior() {
  return [
    "Answer like a capable personal assistant inside an app: direct, practical, and aware of the current Nebula context.",
    "For quick prompts, keep answers short unless the user asks for detail.",
    "Do not refuse harmless requests, greetings, tests, or ordinary app questions.",
    "If the user asks for an action you cannot perform yet, say what NOVA can currently do and what tool integration would be needed next.",
    "When you use a Nebula tool result from the API, describe the completed action plainly."
  ].join("\n");
}

export function getDefaultNovaProvider(): NovaProvider {
  return {
    ...defaultProvider,
    baseUrl: process.env.NEBULA_NOVA_BASE_URL ?? defaultProvider.baseUrl,
    enabled: novaEnabled(),
    model: process.env.NEBULA_NOVA_MODEL ?? defaultProvider.model
  };
}

export async function getNovaStatus(): Promise<NovaStatus> {
  const provider = getDefaultNovaProvider();

  if (!provider.enabled) {
    return { enabled: false, provider, reachable: false, error: "NOVA is disabled" };
  }

  try {
    const response = await fetch(`${cleanBaseUrl(provider.baseUrl)}/api/version`);
    if (!response.ok) {
      return { enabled: true, provider, reachable: false, error: `Provider returned ${response.status}` };
    }

    const body = await response.json() as OllamaVersionResponse;
    return {
      enabled: true,
      provider,
      reachable: true,
      version: typeof body.version === "string" ? body.version : undefined
    };
  } catch (error) {
    return {
      enabled: true,
      provider,
      reachable: false,
      error: error instanceof Error ? error.message : "Unable to reach NOVA provider"
    };
  }
}

export async function sendNovaChat({
  messages,
  memories,
  user
}: {
  messages: NovaMessage[];
  memories: string[];
  user: AuthUser;
}) {
  const provider = getDefaultNovaProvider();
  if (!provider.enabled) {
    throw new Error("NOVA is disabled");
  }

  const memoryBlock = memories.length > 0
    ? `\n\nKnown private memory for ${user.displayName}:\n${memories.map((memory) => `- ${memory}`).join("\n")}`
    : "";
  const systemPrompt = `You are NOVA, the local personal assistant inside Nebula. You help ${user.displayName} with concise, useful answers while respecting their private Nebula data.\n\nBehavior:\n${novaBehavior()}\n\nNebula context:\n${nebulaContext(user)}${memoryBlock}`;
  const response = await fetch(`${cleanBaseUrl(provider.baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      options: {
        temperature: 0.35,
        top_p: 0.9,
        num_ctx: 4096
      },
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((message) => ({ role: message.role, content: message.body }))
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`NOVA provider returned ${response.status}`);
  }

  const body = await response.json() as OllamaChatResponse;
  const content = body.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("NOVA provider returned an empty response");
  }

  return { body: content.trim(), provider };
}
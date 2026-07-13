import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  clearCatalogCache,
  findCatalogAddon,
  getCatalog,
  getCatalogResponse,
  getCatalogSource,
  isCatalogWaitingForGitHubToken,
  setRuntimeCatalogUrl
} from "./catalog.js";
import { getInstalledAddonFilePath, installAddon, listInstalledAddons, uninstallAddon } from "./addon-store.js";
import {
  clearRuntimeGitHubConnection,
  getGitHubAuthStatus,
  saveGitHubConnection,
  setRuntimeGitHubToken
} from "./github-auth.js";

const server = Fastify({ logger: true });
const host = process.env.NEBULA_HOST ?? "127.0.0.1";
const port = Number(process.env.NEBULA_PORT ?? 8787);
const webDist = process.env.NEBULA_WEB_DIST ?? path.resolve(process.cwd(), "apps/web/dist");

await server.register(cors, { origin: true });

server.get("/api/health", async () => ({ status: "ok", name: "nebula" }));

server.get("/api/catalog", async () => getCatalogResponse());

server.get("/api/github/status", async () => ({
  ...getGitHubAuthStatus(),
  catalogSource: getCatalogSource(),
  catalogLocked: isCatalogWaitingForGitHubToken()
}));

server.post("/api/github/token", async (request, reply) => {
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

server.get("/api/addons/installed", async () => ({ addons: await listInstalledAddons() }));

server.get("/api/addons/:id/files/*", async (request, reply) => {
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

server.get("/api/summary", async () => {
  const catalog = await getCatalog();
  const installed = await listInstalledAddons();
  return {
    installedCount: installed.length,
    availableCount: catalog.length,
    enabledCount: installed.filter((addon) => addon.status === "enabled").length
  };
});

server.post("/api/addons/:id/install", async (request, reply) => {
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const manifest = await findCatalogAddon(params.id);

  if (!manifest) {
    return reply.code(404).send({ error: "Addon not found" });
  }

  const installed = await installAddon(manifest);
  return reply.code(201).send({ addon: installed });
});

server.delete("/api/addons/:id", async (request, reply) => {
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

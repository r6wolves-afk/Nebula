# Nebula

Nebula is a self-hosted portal for running small personal or server tools from one place.

Install Nebula once, sign in once, and add lightweight Nebula add-ons instead of running a separate full app container for every small tool.

The simple idea is:

```text
one portal + one login + one persistent data folder + many installable add-ons
```

## What Nebula Includes

- A web portal for users and admins.
- First-run setup for the first admin account.
- Account requests, approvals, and user management.
- A GitHub-powered app store for `Nebula-*` add-ons.
- Add-on install, update, uninstall, and embedded runtime support.
- Per-user JSON storage for add-ons.
- Per-user file storage for add-ons.
- Built-in general chat, direct messages, notifications, and attachments.
- NOVA, an optional local AI assistant powered by a model provider such as Ollama.

## Project Layout

```text
apps/api/              Fastify API, auth, add-ons, storage, chat, NOVA
apps/web/              React and Vite portal UI
packages/shared/       Shared TypeScript types
catalog/               Local development catalog fallback
Dockerfile             Production container build
docker-compose.yml     Basic local Nebula stack
docker-compose.nova.yml  Nebula + local Ollama/NOVA stack
portainer-stack.yml    Basic Portainer deployment template
```

## Local Development

Requirements:

- Node.js 22 or newer
- npm

Install dependencies:

```bash
npm install
```

Start the API and web portal:

```bash
npm run dev
```

Open Nebula:

```text
http://localhost:5173
```

On first launch, Nebula asks you to create the first admin account. After that, users can request access and admins can approve or create accounts from Settings.

Useful commands:

```bash
npm run dev      # Start API and web UI locally
npm run build    # Build shared, API, and web packages
npm run check    # Run TypeScript checks
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`:

```powershell
npm.cmd run check
```

## Docker Options

Nebula can run as one container by itself, or as a two-service stack with local AI.

### Nebula Only

Use this when you want the portal, users, add-ons, chat, and files without local AI:

```bash
docker compose up --build
```

This uses `docker-compose.yml`:

```text
nebula       Nebula portal/API/UI
nebula-data  Persistent Nebula data volume
```

Open:

```text
http://localhost:8787
```

### Nebula + NOVA Local AI

Use this when you want Nebula plus a local Ollama model server for NOVA:

```bash
docker compose -f docker-compose.nova.yml up -d --build
```

This branch's NOVA compose file is set up for Portainer testing and builds Nebula from GitHub:

```yaml
build: https://github.com/r6wolves-afk/Nebula.git#LLM-Compatibility
```

Push the branch before deploying, or change `build` back to `.` if you want Docker to build your local working folder instead.

This uses `docker-compose.nova.yml` and starts two services:

```text
nebula  The Nebula portal/API/UI and NOVA orchestration
ollama  The local AI model server used by NOVA
```

It also creates two Docker volumes:

```text
nebula-data    Accounts, sessions, add-ons, chat data, uploads, and NOVA memory
ollama-models  Downloaded Ollama models and runtime cache
```

Nebula talks to Ollama inside the Compose network at:

```text
http://ollama:11434
```

Ollama is not exposed to the host by default.

After the stack starts, pull the default model:

```bash
docker compose -f docker-compose.nova.yml exec ollama ollama pull qwen2.5:1.5b
```

Then test it:

```bash
docker compose -f docker-compose.nova.yml exec ollama ollama run qwen2.5:1.5b "say ok"
```

Refresh Nebula and NOVA should show `Online` with model `qwen2.5:1.5b`.

## Portainer Deployment

### Basic Nebula

For a normal server install without NOVA, use `portainer-stack.yml`.

Create the persistent host directory first:

```bash
sudo mkdir -p /opt/nebula/data
sudo chmod 700 /opt/nebula/data
```

Then create a Portainer stack from `portainer-stack.yml`.

That stack uses the published image:

```text
ghcr.io/r6wolves-afk/nebula:latest
```

and stores data at:

```text
/opt/nebula/data
```

### NOVA Branch Testing In Portainer

For testing this branch with NOVA, `docker-compose.nova.yml` currently builds Nebula directly from the branch:

```yaml
build: https://github.com/r6wolves-afk/Nebula.git#LLM-Compatibility
```

That makes it usable from Portainer's Web editor because Portainer can fetch the Git branch as the Docker build context.

Before deploying it:

```bash
git push origin LLM-Compatibility
```

After deploying it, open the `ollama` container console in Portainer and run:

```bash
ollama pull qwen2.5:1.5b
ollama run qwen2.5:1.5b "say ok"
```

Then refresh Nebula and test NOVA from the dashboard.

Notes:

- `build: https://github.com/...#LLM-Compatibility` builds the branch, not your local folder.
- If the repository is private, the Docker host or Portainer setup must be able to access it.
- If port `8787` is already used, change the host port mapping, for example `8788:8787`.
- If another container named `nebula` already exists, remove `container_name: nebula` or rename it.

## NOVA Local Assistant

NOVA is Nebula's assistant surface. It runs through the Nebula API so user identity, conversations, memory, and provider settings stay server-side.

Current NOVA behavior:

- Uses Ollama as the first local model provider.
- Stores conversations per Nebula user.
- Stores private memories per Nebula user.
- Can answer from the dashboard or the full NOVA chat page.
- Can respond in General chat when mentioned with `@nova`.
- Can use a server-side tool to create notes in the Nebula Notes add-on.

For local development with a host-installed Ollama:

```bash
ollama serve
ollama pull qwen2.5:1.5b
NEBULA_NOVA_ENABLED=true NEBULA_NOVA_BASE_URL=http://127.0.0.1:11434 NEBULA_NOVA_MODEL=qwen2.5:1.5b npm run dev
```

NOVA stores private user state in the Nebula data directory:

```text
.nebula-data/nova/users/<user-id>/conversations.json
.nebula-data/nova/users/<user-id>/memories.json
```

If NOVA shows `Online` but times out while answering, the connection to Ollama works but the model is too slow for the host. Try warming the model:

```bash
ollama run qwen2.5:1.5b "say ok"
```

or increase:

```text
NEBULA_NOVA_REQUEST_TIMEOUT_MS
```

## Published Image

Pushes to `main` publish Docker images to GitHub Container Registry:

```text
ghcr.io/r6wolves-afk/nebula:latest
ghcr.io/r6wolves-afk/nebula:<version>
ghcr.io/r6wolves-afk/nebula:<commit-sha>
```

Use `portainer-stack.yml` after the image publish workflow finishes. The template uses `latest` with `pull_policy: always`, so Portainer pulls the newest image on redeploy.

For a fixed release, pin the image tag instead of using `latest`.

## Add-ons

Nebula discovers add-ons from GitHub repositories owned by `r6wolves-afk` whose names start with `Nebula-`.

Each add-on needs a `manifest.json` at the repository root.

A minimal static add-on can look like this:

```text
manifest.json
frontend/
  index.html
  styles.css
  app.js
```

Example manifest:

```json
{
  "id": "notes",
  "name": "Nebula Notes",
  "version": "2.0.0",
  "type": "ui",
  "summary": "Private notes inside Nebula.",
  "description": "A frontend-only notes add-on for the Nebula portal.",
  "icon": "notebook-tabs",
  "color": "#9b5cff",
  "route": "/apps/notes",
  "entry": "frontend/index.html",
  "permissions": ["storage.read", "storage.write"],
  "repositoryUrl": "https://github.com/r6wolves-afk/Nebula-Notes"
}
```

To discover add-ons from a different owner or prefix:

```bash
NEBULA_GITHUB_OWNER=OWNER NEBULA_ADDON_REPO_PREFIX=Nebula- npm run dev
```

For private add-on repositories, set `NEBULA_GITHUB_TOKEN` on the backend or as a Portainer stack environment variable. Do not put GitHub tokens in frontend code, catalog files, or committed compose files.

## Add-on APIs

Installed add-ons can store JSON per logged-in user:

```text
GET /api/addons/<addon-id>/storage/<key>
PUT /api/addons/<addon-id>/storage/<key> { "value": ... }
```

Add-ons can also use per-user files:

```text
GET /api/addons/<addon-id>/user-files?parentId=<folder-id>
POST /api/addons/<addon-id>/user-folders { "name": "Photos", "parentId": null }
POST /api/addons/<addon-id>/user-files multipart/form-data file=<file> parentId=<folder-id>
PATCH /api/addons/<addon-id>/user-files/<entry-id> { "name": "New name", "parentId": null }
GET /api/addons/<addon-id>/user-files/<file-id>
DELETE /api/addons/<addon-id>/user-files/<entry-id>
```

Omit `parentId` or pass `null` for the root folder. Add-ons should declare `files.read` and `files.write` permissions when they use file storage.

The default upload limit is 1 GB and can be changed with:

```text
NEBULA_MAX_UPLOAD_BYTES
```

## Chat And Notifications

Nebula includes General chat, direct messages, attachments, and notifications.

Important behavior:

- General chat is visible to every authenticated user.
- General chat notifications are mention-based.
- Direct messages notify the recipient.
- Mention `@nova` in General chat to ask NOVA to reply publicly.

Core routes:

```text
GET /api/chat/general
POST /api/chat/general
GET /api/chat/direct/<user-id>
POST /api/chat/direct/<user-id>
GET /api/notifications
PATCH /api/notifications/<notification-id> { "read": true }
POST /api/notifications/read-all
```

## Useful Environment Variables

```text
NEBULA_HOST                      Host for the API server. Defaults to 127.0.0.1 locally and 0.0.0.0 in Docker.
NEBULA_PORT                      Port for the API server. Defaults to 8787.
NEBULA_DATA_DIR                  Persistent data directory. Defaults to /data in Docker.
NEBULA_WEB_DIST                  Built web UI directory served by the API in production.
NEBULA_GITHUB_OWNER              GitHub owner used for add-on discovery.
NEBULA_ADDON_REPO_PREFIX         Repository name prefix used for add-on discovery.
NEBULA_GITHUB_DISCOVERY          Set to false to disable GitHub discovery.
NEBULA_LOCAL_CATALOG             Set to true to use the local catalog fallback.
NEBULA_CATALOG_PATH              Path to a local catalog JSON file.
NEBULA_CATALOG_URL               URL to a remote catalog JSON file.
NEBULA_GITHUB_TOKEN              GitHub token for private catalogs or private add-on repositories.
NEBULA_MAX_UPLOAD_BYTES          Maximum upload size for add-on file storage. Defaults to 1 GB.
NEBULA_COOKIE_SECURE             Set to true when Nebula is served over HTTPS and cookies should be Secure.
NEBULA_NOVA_ENABLED              Set to false to disable NOVA provider calls. Defaults to true.
NEBULA_NOVA_BASE_URL             NOVA provider base URL. Defaults to http://127.0.0.1:11434.
NEBULA_NOVA_MODEL                NOVA provider model name. Defaults to qwen2.5:1.5b.
NEBULA_NOVA_REQUEST_TIMEOUT_MS   Maximum time to wait for a NOVA provider response. Defaults to 120000.
```

## API Reference

NOVA routes:

```text
GET /api/nova/status
GET /api/nova/conversations
GET /api/nova/conversations/<conversation-id>
POST /api/nova/chat { "body": "Hello", "conversationId": "optional-existing-id" }
GET /api/nova/memory
POST /api/nova/memory { "kind": "note", "text": "Remember this", "pinned": false }
DELETE /api/nova/memory/<memory-id>
```

Local catalog options:

```bash
NEBULA_LOCAL_CATALOG=true npm run dev
NEBULA_GITHUB_DISCOVERY=false npm run dev
NEBULA_LOCAL_CATALOG=true NEBULA_CATALOG_PATH=/path/to/catalog.json npm run dev
NEBULA_CATALOG_URL=https://raw.githubusercontent.com/OWNER/REPO/main/catalog.json npm run dev
```

# Nebula

Nebula is a self-hosted home portal for running small tools from one place. Install Nebula once on a server, then add apps to it as Nebula add-ons instead of running a separate Docker container for every tool.

The goal is simple: one portal, one login, one persistent data folder, and many installable add-ons.

## What Nebula Does

Nebula provides the core platform pieces that add-ons can build on:

- A web portal for users and admins.
- First-run setup for the first admin account.
- Account requests, approval, and user management.
- A GitHub-powered app store for discovering `Nebula-*` add-on repositories.
- Add-on install, update, uninstall, and embedded runtime support.
- Per-user add-on storage for JSON data.
- Per-user add-on file storage, folders, and viewer-only sharing.
- Built-in general chat, direct messages, and notifications.

Add-ons are intentionally lightweight. A simple add-on can be only static frontend files plus a `manifest.json`; Nebula handles login, installation, storage, and serving it inside the portal.

## Project Layout

```text
apps/api/         Fastify API, auth, catalog, add-on install, storage, files, chat
apps/web/         React and Vite portal UI
packages/shared/  Shared TypeScript types and schemas
catalog/          Local development catalog fallback
Dockerfile        Production container build
portainer-stack.yml  Portainer deployment template
```

## Quick Start

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

Open the portal at:

```text
http://localhost:5173
```

On first launch, Nebula asks you to create the first admin account. After that, users can request access from the login page, and admins can approve requests or create accounts from Settings.

## Common Commands

```bash
npm run dev      # Start the API and web UI locally
npm run build    # Build shared types, API, and web UI
npm run check    # Run TypeScript checks across the workspace
```

## Running With Docker

The production shape is one Nebula container with one persistent data directory.

```text
Server
└─ Docker
    └─ Nebula container
         ├─ Portal UI
         ├─ Core API
         ├─ Add-on installer
         ├─ Add-on runtime
         └─ Installed add-ons
```

For a local Docker run, use the included compose file:

```bash
docker compose up --build
```

Nebula will be available at:

```text
http://localhost:8787
```

### Optional Nebula + NOVA Local AI Stack

The base compose file runs Nebula only. To run Nebula with a local Ollama model server for NOVA, use the standalone NOVA compose file:

```bash
docker compose -f docker-compose.nova.yml up --build
```

This starts two sibling services:

```text
nebula  Portal, API, users, chat, add-ons, and NOVA orchestration
ollama  Local model runtime and downloaded model storage
```

Inside the compose network, Nebula reaches Ollama at:

```text
http://ollama:11434
```

Pull the default local model after the stack starts:

```bash
docker compose -f docker-compose.nova.yml exec ollama ollama pull qwen2.5:1.5b
```

The optional NOVA compose file stores Nebula data in `nebula-data` and Ollama models in `ollama-models`. It does not publish Ollama's port to the host by default, so it will not conflict with a host-installed Ollama. If you need host access to Ollama for debugging, add a local override that maps `11434:11434` on the `ollama` service.

For server installs, mount persistent storage at `/data`. The Portainer template mounts `/opt/nebula/data` on the host to `/data` in the container so users, sessions, installed add-ons, GitHub settings, add-on storage, and uploaded files survive updates.

### Fresh Server Setup

On a new Linux server, create the persistent Nebula data directory before loading the stack into Portainer or another Docker stack manager:

```bash
sudo mkdir -p /opt/nebula/data
sudo chmod 700 /opt/nebula/data
sudo ls -ld /opt/nebula /opt/nebula/data
```

Then create a new stack in your Docker manager and paste in `portainer-stack.yml`. If you want to store Nebula data somewhere else, update both the host directory you create and the stack volume mapping:

```yaml
volumes:
   - /opt/nebula/data:/data
```

Keep the host path stable across redeploys and image updates. That directory is where Nebula keeps accounts, sessions, installed add-ons, app data, and uploaded files.

## Published Image

Pushes to `main` publish Docker images to GitHub Container Registry:

```text
ghcr.io/r6wolves-afk/nebula:latest
ghcr.io/r6wolves-afk/nebula:0.2.0
ghcr.io/r6wolves-afk/nebula:<commit-sha>
```

Use `portainer-stack.yml` as the Portainer stack template after the image publish workflow finishes. The template uses `latest` with `pull_policy: always`, so Portainer pulls the newest image when the stack is redeployed. Pin the `image` value to a version tag, such as `ghcr.io/r6wolves-afk/nebula:0.2.0`, when you want a fixed release.

For private add-on repositories, add a Portainer stack environment variable named `NEBULA_GITHUB_TOKEN` with a GitHub token that can read the private `Nebula-*` repos. The token is passed into Nebula without being written into the compose file.

## Add-ons

Nebula discovers add-ons from GitHub repositories owned by `r6wolves-afk` whose names start with `Nebula-`. Each add-on repository needs a valid `manifest.json` at the repository root.

A minimal static add-on looks like this:

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

During discovery, Nebula validates the manifest before showing the add-on in the portal. The App Store description comes from the GitHub repository About description, with the manifest description as a fallback.

To discover add-ons from a different owner or prefix:

```bash
NEBULA_GITHUB_OWNER=OWNER NEBULA_ADDON_REPO_PREFIX=Nebula- npm run dev
```

## Installing Add-ons

Catalog entries can include `packageUrl` to install a real add-on package. The package should be a zip file containing `manifest.json` and the manifest `entry` file.

GitHub source archives work when the add-on files are at the repository root:

```json
{
   "repositoryUrl": "https://github.com/OWNER/ADDON",
   "packageUrl": "https://api.github.com/repos/OWNER/ADDON/zipball/main"
}
```

When Nebula installs an add-on with `packageUrl`, it extracts the package into `.nebula-data/addons/<addon-id>` during local development, or into the configured Nebula data directory in production. If a discovered catalog version is newer than the installed version, the App Store shows an update action and reinstalls the package from GitHub.

## Local Catalog Options

The local fallback catalog at `catalog/local-catalog.json` is for development and offline testing. Use it explicitly with either of these settings:

```bash
NEBULA_LOCAL_CATALOG=true npm run dev
NEBULA_GITHUB_DISCOVERY=false npm run dev
```

To point at another local catalog file:

```bash
NEBULA_LOCAL_CATALOG=true NEBULA_CATALOG_PATH=/path/to/catalog.json npm run dev
```

To browse a GitHub-hosted catalog JSON file:

```bash
NEBULA_CATALOG_URL=https://raw.githubusercontent.com/OWNER/REPO/main/catalog.json npm run dev
```

For private GitHub catalogs, provide a token through the backend environment:

```bash
NEBULA_GITHUB_TOKEN=github_pat_xxx NEBULA_CATALOG_URL=https://raw.githubusercontent.com/OWNER/REPO/main/catalog.json npm run dev
```

Do not put GitHub tokens in catalog files or frontend code. For local development, the App Store can save a GitHub token to `.nebula-data/github-connection.json`; that file is ignored by git, but it stores the token in plain text. Treat the Nebula data folder like a secret and use `NEBULA_GITHUB_TOKEN` for server deployments.

## Add-on APIs

Installed add-ons can store JSON per logged-in Nebula user:

```text
GET /api/addons/<addon-id>/storage/<key>
PUT /api/addons/<addon-id>/storage/<key> { "value": ... }
```

Add-ons that need user files can use Nebula's per-user file tree API:

```text
GET /api/addons/<addon-id>/user-files?parentId=<folder-id>
POST /api/addons/<addon-id>/user-folders { "name": "Photos", "parentId": null }
POST /api/addons/<addon-id>/user-files multipart/form-data file=<file> parentId=<folder-id>
PATCH /api/addons/<addon-id>/user-files/<entry-id> { "name": "New name", "parentId": null }
GET /api/addons/<addon-id>/user-files/<file-id>
DELETE /api/addons/<addon-id>/user-files/<entry-id>
```

Omit `parentId` or pass `null` for the root folder. Add-ons should declare `files.read` and `files.write` permissions when they use file storage. The default upload limit is 1 GB and can be changed with `NEBULA_MAX_UPLOAD_BYTES`.

Add-ons can also use viewer-only file sharing:

```text
GET /api/users/directory
POST /api/addons/<addon-id>/user-files/<entry-id>/shares { "scope": "user", "targetUserId": "...", "permission": "viewer" }
POST /api/addons/<addon-id>/user-files/<entry-id>/shares { "scope": "server", "permission": "viewer" }
GET /api/addons/<addon-id>/shared-with-me
GET /api/addons/<addon-id>/shared-by-me
GET /api/addons/<addon-id>/shared-with-me/<share-id>/files?parentId=<folder-id>
DELETE /api/addons/<addon-id>/user-files/<entry-id>/shares/<share-id>
```

User-scoped shares are visible only to the target Nebula user. Server-scoped shares are visible to any authenticated user on the Nebula server. Shared users can list shared entries and open or download shared files, but owner-only routes still control rename, move, delete, and share revocation.

## Core Chat And Notifications

Nebula includes chat and notifications for signed-in users:

```text
GET /api/chat/general
POST /api/chat/general { "body": "Hello everyone" }
GET /api/chat/direct/<user-id>
POST /api/chat/direct/<user-id> { "body": "Hello" }
GET /api/notifications
PATCH /api/notifications/<notification-id> { "read": true }
POST /api/notifications/read-all
```

General chat is visible to every authenticated user. Direct messages are visible only to the sender and target user. Chat messages create notifications for recipients, and users can mark one notification or all notifications as read.

## NOVA Local Assistant

NOVA is Nebula's local personal assistant surface. It runs through the Nebula API so user identity, per-user memory, and provider credentials stay on the server side. The first provider target is Ollama, but the API layer is shaped so other OpenAI-compatible local or remote providers can be added behind NOVA later.

For local development with Ollama:

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

Authenticated NOVA routes:

```text
GET /api/nova/status
GET /api/nova/conversations
GET /api/nova/conversations/<conversation-id>
POST /api/nova/chat { "body": "Hello", "conversationId": "optional-existing-id" }
GET /api/nova/memory
POST /api/nova/memory { "kind": "note", "text": "Remember this", "pinned": false }
DELETE /api/nova/memory/<memory-id>
```

## Useful Environment Variables

```text
NEBULA_HOST                 Host for the API server. Defaults to 127.0.0.1 locally and 0.0.0.0 in Docker.
NEBULA_PORT                 Port for the API server. Defaults to 8787.
NEBULA_DATA_DIR             Persistent data directory. Defaults to /data in Docker.
NEBULA_WEB_DIST             Built web UI directory served by the API in production.
NEBULA_GITHUB_OWNER         GitHub owner used for add-on discovery.
NEBULA_ADDON_REPO_PREFIX    Repository name prefix used for add-on discovery.
NEBULA_GITHUB_DISCOVERY     Set to false to disable GitHub discovery.
NEBULA_LOCAL_CATALOG        Set to true to use the local catalog fallback.
NEBULA_CATALOG_PATH         Path to a local catalog JSON file.
NEBULA_CATALOG_URL          URL to a remote catalog JSON file.
NEBULA_GITHUB_TOKEN         GitHub token for private catalogs or private add-on repositories.
NEBULA_MAX_UPLOAD_BYTES     Maximum upload size for add-on file storage. Defaults to 1 GB.
NEBULA_COOKIE_SECURE        Set to true when Nebula is served over HTTPS and cookies should be Secure.
NEBULA_NOVA_ENABLED         Set to false to disable NOVA provider calls. Defaults to true.
NEBULA_NOVA_BASE_URL        NOVA provider base URL. Defaults to http://127.0.0.1:11434.
NEBULA_NOVA_MODEL           NOVA provider model name. Defaults to qwen2.5:1.5b.
NEBULA_NOVA_REQUEST_TIMEOUT_MS  Maximum time to wait for a NOVA provider response. Defaults to 120000.
```

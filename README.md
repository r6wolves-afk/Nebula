# Nebula

Nebula is a self-hosted portal designed to run as the only Docker app on a server. Everything else installs as Nebula add-ons inside the platform.

## Local Development

Install dependencies:

```bash
npm install
```

Start the local API and web portal:

```bash
npm run dev
```

Open the portal at http://localhost:5173.

On the first launch, Nebula asks you to create the first admin account. After setup, people can request an account from the login page, and admins approve or reject those requests from Settings. Admins can also create additional admin or user accounts directly. Admins manage GitHub catalog access and add-on installs; users can open installed add-ons and keep their own add-on data.

## Scripts

- `npm run dev` starts the API and web UI locally.
- `npm run build` builds shared types, API, and web UI.
- `npm run check` runs TypeScript checks across the workspace.

## Docker Image

Pushes to `main` publish a Docker image to GitHub Container Registry:

```text
ghcr.io/r6wolves-afk/nebula:latest
ghcr.io/r6wolves-afk/nebula:0.2.0
ghcr.io/r6wolves-afk/nebula:<commit-sha>
```

Use `portainer-stack.yml` as the Portainer stack template after the image publish workflow finishes. The stack uses `latest` with `pull_policy: always`, so Portainer pulls the newest published image on redeploy. Pin the `image` value to a version tag such as `ghcr.io/r6wolves-afk/nebula:0.2.0` if you want a fixed release instead.

For private add-on repositories, add a Portainer stack environment variable named `NEBULA_GITHUB_TOKEN` with a GitHub token that can read the private `Nebula-*` repos. The stack passes that token into Nebula without storing it in the compose file. The stack also sets `NEBULA_MAX_UPLOAD_BYTES=1073741824`, which allows 1 GB uploads for file-based add-ons.

## Server Shape

The intended server layout is:

```text
Ubuntu Server
└─ Docker
   └─ Nebula
      ├─ Portal UI
      ├─ Core API
      ├─ Add-on installer
      ├─ Add-on runtime
      └─ Installed add-ons
```

The Docker packaging here is intentionally one Nebula container with one persistent data directory. For server installs, bind mount `/opt/nebula/data` to `/data` so users, sessions, installed add-ons, GitHub settings, and add-on storage survive container updates.

## Add-on Catalog

By default, Nebula discovers add-ons from GitHub repositories owned by `r6wolves-afk` whose names start with `Nebula-`. Each discovered repository must contain a valid `manifest.json` at the repository root. The API validates each manifest before exposing add-ons in the portal or installing them. During discovery, the App Store description comes from the GitHub repository About description, with the manifest description as a fallback.

You can change discovery with:

```bash
NEBULA_GITHUB_OWNER=OWNER NEBULA_ADDON_REPO_PREFIX=Nebula- npm run dev
```

The local fallback catalog at `catalog/local-catalog.json` is only for development or offline testing. Use `NEBULA_LOCAL_CATALOG=true` or `NEBULA_GITHUB_DISCOVERY=false` to opt into it explicitly.

Catalog entries can include `packageUrl` to install a real add-on package. `packageUrl` should point to a zip that contains `manifest.json` and the manifest `entry` file. GitHub source archives work when the repo has the add-on files at the repo root:

```json
{
   "repositoryUrl": "https://github.com/OWNER/ADDON",
   "packageUrl": "https://api.github.com/repos/OWNER/ADDON/zipball/main"
}
```

When an add-on with `packageUrl` is installed, Nebula extracts it into `.nebula-data/addons/<addon-id>` and serves the entry file inside the portal. If a discovered catalog version is newer than the installed version, the App Store shows an update action and reinstalls the package from GitHub.

Installed add-ons can store JSON through Nebula's add-on storage API:

```text
GET /api/addons/<addon-id>/storage/<key>
PUT /api/addons/<addon-id>/storage/<key> { "value": ... }
```

Storage is written under the Nebula data volume per logged-in Nebula user, so it survives container restarts and follows that user across browsers and devices.

Add-ons that need real files, such as Media or Files, can use Nebula's per-user add-on file API:

```text
GET /api/addons/<addon-id>/user-files?parentId=<folder-id>
POST /api/addons/<addon-id>/user-folders { "name": "Photos", "parentId": null }
POST /api/addons/<addon-id>/user-files multipart/form-data file=<file> parentId=<folder-id>
PATCH /api/addons/<addon-id>/user-files/<entry-id> { "name": "New name", "parentId": null }
GET /api/addons/<addon-id>/user-files/<file-id>
DELETE /api/addons/<addon-id>/user-files/<entry-id>
```

The file API is a per-user folder tree. Omit `parentId` or pass `null` for the root folder. Listing a folder returns `entries`, `files`, `currentFolder`, `breadcrumbs`, and `allEntries`; entries are either `type: "folder"` with `id`, `name`, `parentId`, timestamps, or `type: "file"` with `id`, `name`, `filename`, `mimeType`, `size`, `parentId`, timestamps. `PATCH` renames an entry, moves it to another folder, or both. `DELETE` removes files and recursively removes folders.

File uploads are stored under the Nebula data volume at `addon-files/users/<user-id>/<addon-id>`. Add-ons should declare `files.read` and `files.write` permissions when they use this API. The default upload limit is 1 GB and can be changed with `NEBULA_MAX_UPLOAD_BYTES`.

Core also supports viewer-only file sharing for add-ons that build file experiences:

```text
GET /api/users/directory
POST /api/addons/<addon-id>/user-files/<entry-id>/shares { "scope": "user", "targetUserId": "...", "permission": "viewer" }
POST /api/addons/<addon-id>/user-files/<entry-id>/shares { "scope": "server", "permission": "viewer" }
GET /api/addons/<addon-id>/shared-with-me
GET /api/addons/<addon-id>/shared-by-me
GET /api/addons/<addon-id>/shared-with-me/<share-id>/files?parentId=<folder-id>
DELETE /api/addons/<addon-id>/user-files/<entry-id>/shares/<share-id>
```

User-scoped shares are visible only to the target Nebula user. Server-scoped shares are visible to any authenticated user on this Nebula server. Shared users can list shared entries and open/download shared files, including files inside a shared folder, but owner-only routes still control rename, move, delete, and share revocation.

Nebula core includes chat and notifications for signed-in users:

```text
GET /api/chat/general
POST /api/chat/general { "body": "Hello everyone" }
GET /api/chat/direct/<user-id>
POST /api/chat/direct/<user-id> { "body": "Hello" }
GET /api/notifications
PATCH /api/notifications/<notification-id> { "read": true }
POST /api/notifications/read-all
```

General chat is visible to every authenticated user. Direct messages are visible only to the sender and target user. Chat messages create `chat` notifications for recipients; users can mark one notification or all notifications as read.

If local catalog fallback is enabled, you can point Nebula at a different local catalog file with:

```bash
NEBULA_LOCAL_CATALOG=true NEBULA_CATALOG_PATH=/path/to/catalog.json npm run dev
```

To browse a GitHub-hosted catalog instead, set:

```bash
NEBULA_CATALOG_URL=https://raw.githubusercontent.com/OWNER/REPO/main/catalog.json npm run dev
```

For private GitHub catalogs, provide a token through the backend environment:

```bash
NEBULA_GITHUB_TOKEN=github_pat_xxx NEBULA_CATALOG_URL=https://raw.githubusercontent.com/OWNER/REPO/main/catalog.json npm run dev
```

Do not put GitHub tokens in catalog files or frontend code.

For local development, the App Store can also accept a GitHub token and save it to `.nebula-data/github-connection.json`. This file is ignored by git, but it contains the token in plain text, so treat the Nebula data folder like a secret. Use `NEBULA_GITHUB_TOKEN` for server deployments.

The App Store can also save a GitHub catalog URL during local development. Use a raw JSON URL that returns the same shape as `catalog/local-catalog.json`.

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

## Scripts

- `npm run dev` starts the API and web UI locally.
- `npm run build` builds shared types, API, and web UI.
- `npm run check` runs TypeScript checks across the workspace.

## Docker Image

Pushes to `main` publish a Docker image to GitHub Container Registry:

```text
ghcr.io/r6wolves-afk/nebula:latest
```

Use `portainer-stack.yml` as the Portainer stack template after the image publish workflow finishes.

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

The Docker packaging here is intentionally one Nebula container with one persistent data volume.

## Add-on Catalog

By default, Nebula discovers add-ons from GitHub repositories owned by `r6wolves-afk` whose names start with `Nebula-`. Each discovered repository must contain a valid `manifest.json` at the repository root. The API validates each manifest before exposing add-ons in the portal or installing them. During discovery, the App Store description comes from the GitHub repository About description, with the manifest description as a fallback.

You can change discovery with:

```bash
NEBULA_GITHUB_OWNER=OWNER NEBULA_ADDON_REPO_PREFIX=Nebula- npm run dev
```

Set `NEBULA_GITHUB_DISCOVERY=false` to use the local fallback catalog at `catalog/local-catalog.json`.

Catalog entries can include `packageUrl` to install a real add-on package. `packageUrl` should point to a zip that contains `manifest.json` and the manifest `entry` file. GitHub source archives work when the repo has the add-on files at the repo root:

```json
{
   "repositoryUrl": "https://github.com/OWNER/ADDON",
   "packageUrl": "https://api.github.com/repos/OWNER/ADDON/zipball/main"
}
```

When an add-on with `packageUrl` is installed, Nebula extracts it into `.nebula-data/addons/<addon-id>` and serves the entry file inside the portal. If a discovered catalog version is newer than the installed version, the App Store shows an update action and reinstalls the package from GitHub.

You can point Nebula at a different local catalog file with:

```bash
NEBULA_CATALOG_PATH=/path/to/catalog.json npm run dev
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

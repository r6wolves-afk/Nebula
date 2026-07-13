import {
  Activity,
  Boxes,
  CheckCircle2,
  Cloud,
  Github,
  ExternalLink,
  FolderOpen,
  Gauge,
  Grid3X3,
  HardDrive,
  NotebookTabs,
  PackagePlus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Undo2,
  Trash2
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AddonManifest, CatalogSource, InstalledAddon, PlatformSummary } from "@nebula/shared";

type Section = "dashboard" | "store" | "installed" | "settings";
type RouteState =
  | { section: Section; addonId?: undefined }
  | { section: "addon"; addonId: string };
type GitHubAuthStatus = {
  configured: boolean;
  source: "environment" | "saved" | "runtime" | null;
  catalogSource?: CatalogSource;
  catalogLocked?: boolean;
};

const iconMap = {
  "notebook-tabs": NotebookTabs,
  "folder-open": FolderOpen,
  activity: Activity
};

const navItems: Array<{ id: Section; label: string; icon: typeof Grid3X3 }> = [
  { id: "dashboard", label: "Dashboard", icon: Grid3X3 },
  { id: "store", label: "App Store", icon: PackagePlus },
  { id: "installed", label: "Installed", icon: Boxes },
  { id: "settings", label: "Settings", icon: Settings }
];

function routeFromPath(pathname: string): RouteState {
  const addonMatch = pathname.match(/^\/apps\/([^/]+)$/);
  if (addonMatch) {
    return { section: "addon", addonId: decodeURIComponent(addonMatch[1]) };
  }

  return { section: "dashboard" };
}

function pathForRoute(route: RouteState): string {
  if (route.section === "addon") {
    return `/apps/${encodeURIComponent(route.addonId)}`;
  }

  return "/";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
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
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [storeMessage, setStoreMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [summary, setSummary] = useState<PlatformSummary>({
    installedCount: 0,
    availableCount: 0,
    enabledCount: 0
  });
  const [busyAddon, setBusyAddon] = useState<string | null>(null);

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
    void refresh();
  }, []);

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

  const installedIds = new Set(installed.map((addon) => addon.id));
  const installedById = new Map(installed.map((addon) => [addon.id, addon]));
  const needsGitHubToken = Boolean(githubAuth.catalogLocked) || (catalogSource.type === "remote" && !githubAuth.configured);
  const activeAddon = route.section === "addon" ? installed.find((addon) => addon.id === route.addonId) : undefined;
  const activeManifest = route.section === "addon" ? catalog.find((addon) => addon.id === route.addonId) : undefined;
  const activeTitle = route.section === "addon"
    ? activeAddon?.name ?? activeManifest?.name ?? "Add-on"
    : navItems.find((item) => item.id === route.section)?.label ?? "Dashboard";

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
          {navItems.map((item) => {
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
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <ShieldCheck size={18} />
          <div>
            <strong>Single app mode</strong>
            <span>Docker runs Nebula only</span>
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
        </header>

        {route.section === "dashboard" && (
          <section className="content-grid dashboard-grid">
            <div className="hero-panel">
              <div className="hero-copy">
                <span className="eyebrow">Local Development</span>
                <h2>Nebula is your server home base.</h2>
                <p>
                  Build the portal locally, install add-ons into Nebula state, then package the same core into one
                  server container.
                </p>
                <button className="primary-action" onClick={() => navigate({ section: "store" })} type="button">
                  <PackagePlus size={18} />
                  Open App Store
                </button>
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

            <MetricCard icon={Gauge} label="Installed" value={summary.installedCount} />
            <MetricCard icon={PackagePlus} label="Available" value={summary.availableCount} />
            <MetricCard icon={CheckCircle2} label="Enabled" value={summary.enabledCount} />

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

        {route.section === "store" && (
          <section className="panel page-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Catalog</span>
                <h2>Add-ons</h2>
              </div>
              <span className="soft-pill" title={catalogSource.location}>{catalogSource.label}</span>
            </div>
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
              <div className="addon-grid">
                {catalog.map((addon) => (
                  <AddonStoreCard
                    addon={addon}
                    busy={busyAddon === addon.id}
                    installedAddon={installedById.get(addon.id)}
                    key={addon.id}
                    onInstall={() => installAddon(addon.id)}
                    onUninstall={() => uninstallAddon(addon.id)}
                  />
                ))}
              </div>
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
                    <button
                      className="icon-button"
                      disabled={busyAddon === addon.id}
                      onClick={() => uninstallAddon(addon.id)}
                      title={`Uninstall ${addon.name}`}
                      type="button"
                    >
                      <Trash2 size={18} />
                    </button>
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
              </div>
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
  installedAddon,
  onInstall,
  onUninstall
}: {
  addon: AddonManifest;
  busy: boolean;
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
      <button
        className={installed && !hasUpdate ? "secondary-action" : "primary-action"}
        disabled={busy}
        onClick={installed && !hasUpdate ? onUninstall : onInstall}
        type="button"
      >
        {busy ? <span className="loading-spinner" aria-hidden="true" /> : installed && !hasUpdate ? <Trash2 size={18} /> : <PackagePlus size={18} />}
        {primaryLabel}
      </button>
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
              <dd>{new Date(addon.installedAt).toLocaleString()}</dd>
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

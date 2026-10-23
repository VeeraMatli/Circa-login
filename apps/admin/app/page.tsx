"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  ChevronRight,
  CircleHelp,
  Flag,
  Heart,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
type Row = Record<string, string | number | null>;
const navigation = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "users", name: "Members", icon: Users },
  { id: "cases", name: "Trust & safety", icon: ShieldCheck },
  { id: "photos", name: "Photo review", icon: Heart },
  { id: "finance", name: "Subscriptions", icon: Wallet },
  { id: "health", name: "Platform health", icon: Activity },
  { id: "flags", name: "Feature controls", icon: Settings2 },
  { id: "audit", name: "Audit history", icon: ListChecks },
];
async function api(path: string, init?: RequestInit) {
  const res = await fetch("/api/admin/" + path, init);
  const result = await res.json();
  if (!res.ok) throw new Error(result.error?.message ?? "Request failed");
  return result;
}
export default function Dashboard() {
  const [tab, setTab] = useState("overview"),
    [rows, setRows] = useState<Row[]>([]),
    [stats, setStats] = useState<Row>({}),
    [cases, setCases] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [mode, setMode] = useState(""),
    [role, setRole] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [evidence, setEvidence] = useState<unknown>(null),
    [resolution, setResolution] = useState(""),
    [notice, setNotice] = useState(""),
    [menu, setMenu] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const overview = await api("overview");
      setStats(overview.data);
      setMode(overview.mode);
      setRole(overview.role);
      if (["moderator", "super_admin"].includes(overview.role)) {
        const reports = await api("cases");
        setCases(reports.data);
      } else {
        setCases([]);
      }
      if (tab !== "overview") {
        const result = await api(tab);
        setRows(Array.isArray(result.data) ? result.data : [result.data]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load data.");
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => {
    void load();
  }, [load]);
  const allowed = (id: string) =>
    ["cases", "photos"].includes(id)
      ? ["moderator", "super_admin"].includes(role)
      : id === "finance"
        ? ["finance", "super_admin"].includes(role)
        : id === "flags"
          ? ["operations", "super_admin"].includes(role)
          : id === "audit"
            ? role === "super_admin"
            : true;
  const title = navigation.find((x) => x.id === tab)?.name ?? "Overview";
  const viewCases = cases.filter((r) =>
    Object.values(r).some((v) =>
      String(v).toLowerCase().includes(query.toLowerCase()),
    ),
  );
  async function review(row: Row) {
    setSelected(row);
    setEvidence(null);
    setResolution("");
    try {
      setEvidence((await api(`cases/${row.id}/evidence`)).data);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to load evidence.");
    }
  }
  async function resolve(ban = false) {
    if (!selected || !resolution.trim()) return;
    try {
      await api(`cases/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved", resolution, ban_user: ban }),
      });
      setSelected(null);
      setNotice(
        "Case resolved. This action has been recorded in the audit history.",
      );
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to resolve case.");
    }
  }
  async function moderatePhoto(id: string, status: "approved" | "rejected") {
    try {
      await api(`photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setNotice("Photo decision saved and audited.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to moderate photo.");
    }
  }
  return (
    <div className="shell">
      <aside className={menu ? "sidebar mobile-open" : "sidebar"}>
        <a className="wordmark" href="/">
          HeartTrail<span>♡</span>
        </a>
        <div className="workspace-tag">OPERATIONS STUDIO</div>
        <nav aria-label="Main navigation">
          {navigation
            .filter((item) => allowed(item.id))
            .map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? "nav-item active" : "nav-item"}
                onClick={() => {
                  setTab(item.id);
                  setQuery("");
                  setMenu(false);
                }}
                aria-current={tab === item.id ? "page" : undefined}
              >
                <item.icon size={18} />
                <span>{item.name}</span>
                {item.id === "cases" && Number(stats.urgent_cases) > 0 && (
                  <b className="nav-count">{stats.urgent_cases}</b>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-footer">
          <div className="secure-note">
            <LockKeyhole size={16} />
            <span>Care begins with privacy</span>
          </div>
          <div className="operator">
            <div className="avatar">HT</div>
            <div>
              <strong>HeartTrail operations</strong>
              <small>{mode || "Authenticated workspace"}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Toggle navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <span className="environment">
              <i />
              {mode === "local development" ? "Development" : "Operations"}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh data"
              onClick={() => void load()}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Open urgent safety reports"
              onClick={() => setTab("cases")}
            >
              <Bell size={18} />
            </button>
            <div className="avatar mini">HT</div>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">FOLLOW YOUR HEART.</div>
              <h1>{tab === "overview" ? "A thoughtful overview." : title}</h1>
              <p>
                {tab === "overview"
                  ? "A pulse on your community, and the people behind every connection."
                  : "Real platform records. Every privileged action is audited."}
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              {loading ? "Refreshing…" : "Refresh workspace"}
            </button>
          </div>
          {error && (
            <div className="error" role="alert">
              <strong>We couldn’t reach the platform.</strong>
              <span>{error}</span>
              <button onClick={() => void load()}>Try again</button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notice"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {tab === "overview" ? (
            <>
              <section className="welcome-card">
                <div>
                  <span className="pill">
                    <Heart size={12} /> BUILT FOR MEANINGFUL CONNECTIONS
                  </span>
                  <h2>
                    Good connections start
                    <br />
                    with a community that feels safe.
                  </h2>
                  <p>
                    Keep a close eye on what matters. Give every member
                    <br className="desktop-break" /> the space to meet someone,
                    with confidence.
                  </p>
                  <button
                    className="cream-button"
                    onClick={() =>
                      setTab(allowed("cases") ? "cases" : "health")
                    }
                  >
                    {allowed("cases")
                      ? "Visit trust & safety"
                      : "View platform health"}{" "}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="orb-art" aria-hidden="true">
                  <div className="orbit one" />
                  <div className="orbit two" />
                  <div className="heart-orb">♡</div>
                  <span className="little-star">✧</span>
                  <span className="little-star second">✦</span>
                  <div className="art-caption">Follow Your Heart.</div>
                </div>
              </section>
              <section className="metrics" aria-label="Platform metrics">
                {[
                  {
                    name: "Community members",
                    key: "registered_users",
                    icon: Users,
                    note: "Registered accounts",
                  },
                  {
                    name:
                      mode === "local development"
                        ? "Adults · mock eligibility"
                        : "Verified adults",
                    key: "verified_adults",
                    icon: ShieldCheck,
                    note:
                      mode === "local development"
                        ? "Local DOB check; no provider"
                        : "Eligible, active members",
                  },
                  {
                    name: "Meaningful matches",
                    key: "active_matches",
                    icon: Heart,
                    note: "Active mutual connections",
                  },
                  {
                    name: "Active subscribers",
                    key: "paying_subscribers",
                    icon: Wallet,
                    note: "Verified, unexpired entitlements",
                  },
                ].map((m) => (
                  <article className="metric" key={m.key}>
                    <div className="metric-label">
                      {m.name}
                      <m.icon size={17} />
                    </div>
                    <strong>
                      {loading
                        ? "—"
                        : Number(stats[m.key] ?? 0).toLocaleString()}
                    </strong>
                    <small>
                      <span className="metric-dot" />
                      {m.note}
                    </small>
                  </article>
                ))}
              </section>
              <div className="content-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Trust & safety</h2>
                      <p>A human touch, where it matters most.</p>
                    </div>
                    {allowed("cases") && (
                      <button
                        className="text-button"
                        onClick={() => setTab("cases")}
                      >
                        View queue <ChevronRight size={15} />
                      </button>
                    )}
                  </div>
                  <div className="safety-summary">
                    <div className="safety-icon">
                      <ShieldCheck size={25} />
                    </div>
                    <div>
                      <strong>
                        {Number(stats.moderation_backlog ?? 0)} cases need
                        attention
                      </strong>
                      <p>
                        {Number(stats.urgent_cases ?? 0)} prioritized for urgent
                        human review
                      </p>
                    </div>
                    <span className="status-badge">Live queue</span>
                  </div>
                  <div className="mini-table">
                    <div className="table-labels">
                      <span>REPORTED CONCERN</span>
                      <span>PRIORITY</span>
                      <span>STATUS</span>
                    </div>
                    {loading ? (
                      <p className="empty">Loading the safety queue…</p>
                    ) : cases.length ? (
                      cases.slice(0, 4).map((r) => (
                        <button
                          className="case-row"
                          key={String(r.id)}
                          onClick={() => void review(r)}
                        >
                          <span>
                            <Flag size={15} />
                            {String(r.category).replaceAll("_", " ")}
                          </span>
                          <span
                            className={
                              r.priority === "urgent"
                                ? "priority urgent"
                                : "priority"
                            }
                          >
                            {r.priority}
                          </span>
                          <span>
                            {r.status}
                            <ChevronRight size={14} />
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="empty">
                        <ShieldCheck size={25} />
                        <strong>A little peace of mind.</strong>
                        <p>
                          No reports in the queue. New reports will appear here.
                        </p>
                      </div>
                    )}
                  </div>
                </section>
                <section className="panel community-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Community pulse</h2>
                      <p>Connections beyond the first hello.</p>
                    </div>
                    <Activity size={18} />
                  </div>
                  <div className="pulse-number">
                    {loading
                      ? "—"
                      : Number(
                          stats.conversations_started ?? 0,
                        ).toLocaleString()}
                    <span>conversations started</span>
                  </div>
                  <div className="connection-art" aria-hidden="true">
                    <span>♡</span>
                    <i />
                    <span>✧</span>
                    <i />
                    <span>↗</span>
                  </div>
                  <p className="pulse-note">
                    Every number is a real connection.
                    <br />
                    No simulated activity. No invented growth.
                  </p>
                  <button
                    className="secondary-button full"
                    onClick={() => setTab("health")}
                  >
                    Check platform health <ArrowUpRight size={15} />
                  </button>
                </section>
              </div>
              <section className="care-banner">
                <div className="care-icon">✧</div>
                <div>
                  <h3>Privacy is part of the promise.</h3>
                  <p>
                    Private conversations stay private. Reported evidence is
                    available only to authorized moderators.
                  </p>
                </div>
                {allowed("audit") && (
                  <button
                    className="text-button"
                    onClick={() => setTab("audit")}
                  >
                    Audit history <ArrowUpRight size={16} />
                  </button>
                )}
              </section>
            </>
          ) : (
            <section className="panel records">
              <div className="panel-heading">
                <div>
                  <h2>{title}</h2>
                  <p>
                    {tab === "finance"
                      ? "Subscription counts are not financial revenue. App Store financial reports are required for accounting."
                      : "Scoped records from the platform API."}
                  </p>
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search loaded records"
                    placeholder="Search loaded records"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {loading ? (
                <div className="empty">Loading records…</div>
              ) : (tab === "cases"
                  ? viewCases
                  : rows.filter((r) =>
                      Object.values(r).some((v) =>
                        String(v).toLowerCase().includes(query.toLowerCase()),
                      ),
                    )
                ).length ? (
                <div className="record-list">
                  {(tab === "cases"
                    ? viewCases
                    : rows.filter((r) =>
                        Object.values(r).some((v) =>
                          String(v).toLowerCase().includes(query.toLowerCase()),
                        ),
                      )
                  ).map((row, i) => (
                    <article className="record" key={String(row.id ?? i)}>
                      {Object.entries(row).map(([key, value]) => (
                        <div key={key}>
                          <small>{key.replaceAll("_", " ")}</small>
                          <span>{String(value ?? "—")}</span>
                        </div>
                      ))}
                      {tab === "photos" && (
                        <div className="photo-review">
                          <img
                            src={`/api/admin/photos/${row.id}/content`}
                            alt="Private pending profile photo for moderation"
                          />
                          <button
                            className="secondary-button"
                            onClick={() =>
                              void moderatePhoto(String(row.id), "approved")
                            }
                          >
                            Approve
                          </button>
                          <button
                            className="danger-button"
                            onClick={() =>
                              void moderatePhoto(String(row.id), "rejected")
                            }
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {tab === "cases" && (
                        <button
                          className="secondary-button"
                          onClick={() => void review(row)}
                        >
                          Review case <ChevronRight size={15} />
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <CircleHelp size={28} />
                  <strong>No records to show.</strong>
                  <p>
                    {query
                      ? "Try a different search."
                      : "Records will appear as your community uses HeartTrail."}
                  </p>
                </div>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>
              HEARTTRAIL <span className="footer-dot">·</span> Follow Your
              Heart.
            </span>
            <span>
              <LockKeyhole size={12} /> Restricted operations workspace
            </span>
          </footer>
        </main>
      </div>
      <Dialog.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog">
            <div className="panel-heading">
              <Dialog.Title>Review safety case</Dialog.Title>
              <Dialog.Close asChild>
                <button className="icon-button" aria-label="Close review">
                  <X size={20} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Reported evidence is restricted. Your access and resolution are
              audited.
            </Dialog.Description>
            <pre>
              {evidence
                ? JSON.stringify(evidence, null, 2)
                : "Loading evidence…"}
            </pre>
            <label className="resolution">
              Resolution notes
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                maxLength={1000}
              />
            </label>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                disabled={!resolution.trim()}
                onClick={() => void resolve(false)}
              >
                Resolve case
              </button>
              <button
                className="danger-button"
                disabled={!resolution.trim()}
                onClick={() => void resolve(true)}
              >
                Resolve & ban reported account
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

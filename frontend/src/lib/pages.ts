// The canonical set of access-controlled pages. The `key` is what gets stored
// in a member's permission map; `to` is the route; `label` is shown in the
// invite UI and nav. Keep this in sync with the sidebar nav in app-shell.tsx.
export interface PageDef {
  key: string;
  label: string;
  to: string;
  // Mandatory pages are available to every member and are NOT shown in the
  // invite/edit access grid (their access can't be revoked).
  mandatory?: boolean;
}

export const PAGES: PageDef[] = [
  { key: "dashboard", label: "Dashboard", to: "/dashboard" },
  { key: "calendar", label: "Calendar", to: "/calendar" },
  { key: "board", label: "My Board", to: "/board" },
  { key: "meeting", label: "Meetings", to: "/meeting" },
  { key: "templates", label: "My Templates", to: "/templates" },
  { key: "organization", label: "Organization", to: "/organization", mandatory: true },
  { key: "team", label: "Team", to: "/team" },
  { key: "settings", label: "Settings", to: "/settings", mandatory: true },
];

/** Pages whose access can be granted per-member (excludes mandatory ones). */
export const ASSIGNABLE_PAGES: PageDef[] = PAGES.filter((p) => !p.mandatory);

// Routes that reuse another page's access key instead of having their own
// permission. "My Notes" is just a focused view of the calendar's notes, so it
// follows "calendar" access (no separate toggle in the invite grid).
const ROUTE_ALIASES: Record<string, string> = { "/notes": "calendar" };

/** Resolve a route pathname (e.g. "/board") to its page key. */
export function pageKeyForPath(pathname: string): string | null {
  for (const [prefix, key] of Object.entries(ROUTE_ALIASES)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return key;
  }
  const match = PAGES.find((p) => pathname === p.to || pathname.startsWith(p.to + "/"));
  return match ? match.key : null;
}

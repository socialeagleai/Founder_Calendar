// The canonical set of access-controlled pages. The `key` is what gets stored
// in a member's permission map; `to` is the route; `label` is shown in the
// invite UI and nav. Keep this in sync with the sidebar nav in app-shell.tsx.
export interface PageDef {
  key: string;
  label: string;
  to: string;
}

export const PAGES: PageDef[] = [
  { key: "dashboard", label: "Dashboard", to: "/dashboard" },
  { key: "calendar", label: "Calendar", to: "/calendar" },
  { key: "board", label: "My Board", to: "/board" },
  { key: "meeting", label: "Meetings", to: "/meeting" },
  { key: "templates", label: "My Templates", to: "/templates" },
  { key: "organization", label: "Organization", to: "/organization" },
  { key: "team", label: "Team", to: "/team" },
  { key: "settings", label: "Settings", to: "/settings" },
];

/** Resolve a route pathname (e.g. "/board") to its page key. */
export function pageKeyForPath(pathname: string): string | null {
  const match = PAGES.find((p) => pathname === p.to || pathname.startsWith(p.to + "/"));
  return match ? match.key : null;
}

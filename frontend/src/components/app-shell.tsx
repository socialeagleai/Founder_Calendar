import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Calendar,
  LayoutGrid,
  CalendarClock,
  LayoutTemplate,
  Building2,
  Users,
  Settings,
  LogOut,
  Search,
  Bell,
  Menu,
  X,
} from "lucide-react";
import { useStore, useCurrentUser, levelFor } from "@/lib/store";
import { pageKeyForPath } from "@/lib/pages";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/board", label: "My Board", icon: LayoutGrid },
  { to: "/meeting", label: "Meetings", icon: CalendarClock },
  { to: "/templates", label: "My Templates", icon: LayoutTemplate },
  { to: "/organization", label: "Organization", icon: Building2 },
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { status, currentUser, organization, access, logout } = useStore();
  const user = useCurrentUser();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Only the pages this user is allowed to open (owners see all).
  const visibleNav = nav.filter((item) => {
    const key = pageKeyForPath(item.to);
    return key ? levelFor(access, key) !== "none" : true;
  });

  useEffect(() => {
    if (status !== "ready") return;
    if (!currentUser) {
      navigate({ to: "/login" });
      return;
    }
    if (!organization) {
      navigate({ to: "/onboarding" });
      return;
    }
    // Guard against opening a page this member has no access to: bounce them to
    // their first accessible page.
    const key = pageKeyForPath(pathname);
    if (key && levelFor(access, key) === "none") {
      const fallback = nav.find((item) => {
        const k = pageKeyForPath(item.to);
        return k ? levelFor(access, k) !== "none" : false;
      });
      if (fallback) navigate({ to: fallback.to });
    }
  }, [status, currentUser, organization, access, pathname, navigate]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (status !== "ready" || !currentUser || !organization || !user) return null;

  const initial = user.name.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[240px] flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
          <Logo size="sm" />
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1.5 hover:bg-accent lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {visibleNav.map((item) => {
            const active = pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "font-semibold text-primary"
                    : "font-medium text-foreground/70 hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="activeNav"
                    className="absolute inset-0 rounded-xl bg-accent"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <Icon
                  className={cn(
                    "relative z-10 h-[18px] w-[18px] transition-transform group-hover:scale-110",
                    active ? "text-primary group-hover:scale-100" : "text-muted-foreground",
                  )}
                />
                <span className="relative z-10">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-lg p-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-sm font-semibold text-primary-foreground shadow-soft ring-2 ring-primary/20">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
            <button
              onClick={() => {
                logout();
                navigate({ to: "/login" });
              }}
              title="Logout"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[240px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-primary">
              <Building2 className="h-3.5 w-3.5" />
            </span>
            <span className="truncate text-sm font-semibold">{organization.name}</span>
          </div>
          <div className="relative ml-auto hidden max-w-md flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search notes, plans, members…"
              className="h-9 border-border bg-secondary pl-9 text-sm transition-shadow focus-visible:shadow-soft"
            />
          </div>
          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <ThemeToggle />
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
            </Button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

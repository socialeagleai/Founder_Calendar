import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Calendar,
  NotebookPen,
  LayoutGrid,
  CalendarClock,
  LayoutTemplate,
  Building2,
  Users,
  Settings,
  LogOut,
  Bell,
  Menu,
  X,
  Check,
  ChevronsUpDown,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import {
  useStore,
  useCurrentUser,
  levelFor,
  type Invitation,
  type LeaveRequest,
} from "@/lib/store";
import { pageKeyForPath } from "@/lib/pages";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { GlobalSearch } from "./global-search";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/notes", label: "My Notes", icon: NotebookPen },
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
  const refreshBell = useStore((s) => s.refreshBell);
  const user = useCurrentUser();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Poll the notification bell (invites, leave requests, messages) so it updates
  // without a manual reload - including cross-user events from other people.
  useEffect(() => {
    if (!currentUser) return;
    void refreshBell();
    const id = setInterval(() => void refreshBell(), 15000);
    return () => clearInterval(id);
  }, [currentUser, refreshBell]);

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
          <OrgSwitcher />
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <ThemeToggle />
            <NotificationBell />
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

/** Navbar dropdown to switch between the organizations the user belongs to. */
function OrgSwitcher() {
  const navigate = useNavigate();
  const organization = useStore((s) => s.organization);
  const myOrgs = useStore((s) => s.myOrgs);
  const switchOrg = useStore((s) => s.switchOrg);
  if (!organization) return null;

  const pick = async (id: string) => {
    if (id === organization.id) return;
    try {
      await switchOrg(id);
    } catch {
      toast.error("Could not switch organization");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="hidden min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent lg:flex">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-primary">
            <Building2 className="h-3.5 w-3.5" />
          </span>
          <span className="max-w-[180px] truncate text-sm font-semibold">{organization.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {myOrgs.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => void pick(o.id)} className="gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-xs font-bold text-primary">
              {o.name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{o.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {o.isOwner ? "Owner" : o.role}
              </div>
            </div>
            {o.id === organization.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/organization" })} className="gap-2">
          <Plus className="h-4 w-4" /> Create / manage
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Notification bell listing pending invitations with accept / decline. */
function NotificationBell() {
  const invitations = useStore((s) => s.invitations);
  const leaveRequests = useStore((s) => s.leaveRequests);
  const notifications = useStore((s) => s.notifications);
  const acceptInvitation = useStore((s) => s.acceptInvitation);
  const declineInvitation = useStore((s) => s.declineInvitation);
  const acceptLeaveRequest = useStore((s) => s.acceptLeaveRequest);
  const declineLeaveRequest = useStore((s) => s.declineLeaveRequest);
  const dismissNotification = useStore((s) => s.dismissNotification);
  // Which leave request is in its "confirm remove" step.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const count = invitations.length + leaveRequests.length + notifications.length;

  const accept = async (inv: Invitation) => {
    try {
      await acceptInvitation(inv.id);
      toast.success(`Joined ${inv.organizationName}`);
    } catch {
      toast.error("Could not accept invitation");
    }
  };
  const decline = async (inv: Invitation) => {
    try {
      await declineInvitation(inv.id);
      toast.message(`Declined ${inv.organizationName}`);
    } catch {
      toast.error("Could not decline invitation");
    }
  };
  const approveLeave = async (r: LeaveRequest) => {
    try {
      await acceptLeaveRequest(r.id);
      toast.success(`${r.memberName} removed from ${r.organizationName}`);
    } catch {
      toast.error("Could not remove member");
    } finally {
      setConfirmingId(null);
    }
  };
  const rejectLeave = async (r: LeaveRequest) => {
    try {
      await declineLeaveRequest(r.id);
      toast.message(`${r.memberName} stays in ${r.organizationName}`);
    } catch {
      toast.error("Could not decline request");
    }
  };

  return (
    <DropdownMenu onOpenChange={(o) => !o && setConfirmingId(null)}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute right-1 top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
              {count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {count === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            No new notifications
          </div>
        ) : (
          <>
            {notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-2 px-3 py-2.5">
                <p className="flex-1 text-sm leading-snug">{n.message}</p>
                <button
                  onClick={() => void dismissNotification(n.id)}
                  title="Dismiss"
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {invitations.map((inv) => (
              <div key={inv.id} className="px-3 py-2.5">
                <p className="text-sm leading-snug">
                  You're invited to join{" "}
                  <span className="font-semibold">{inv.organizationName}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Role: {inv.role}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    className="h-8 flex-1 bg-primary text-primary-foreground hover:bg-primary-dark"
                    onClick={() => void accept(inv)}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1"
                    onClick={() => void decline(inv)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
            {leaveRequests.map((r) => (
              <div key={r.id} className="px-3 py-2.5">
                <p className="text-sm leading-snug">
                  <span className="font-semibold">{r.memberName}</span> requested to leave{" "}
                  <span className="font-semibold">{r.organizationName}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{r.memberEmail}</p>
                {confirmingId === r.id ? (
                  <div className="mt-2">
                    <p className="text-[11px] text-muted-foreground">
                      Remove {r.memberName} from {r.organizationName}? This can't be undone.
                    </p>
                    <div className="mt-1.5 flex gap-2">
                      <Button
                        size="sm"
                        className="h-8 flex-1 bg-primary text-primary-foreground hover:bg-primary-dark"
                        onClick={() => void approveLeave(r)}
                      >
                        Confirm remove
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-1"
                        onClick={() => setConfirmingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      className="h-8 flex-1 bg-primary text-primary-foreground hover:bg-primary-dark"
                      onClick={() => setConfirmingId(r.id)}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1"
                      onClick={() => void rejectLeave(r)}
                    >
                      Decline
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AppShell } from "@/components/app-shell";
import { MonthCalendar } from "@/components/month-calendar";
import { AnimatedNumber } from "@/components/animated-number";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  CalendarCheck,
  CalendarClock,
  FileText,
  StickyNote,
  Users,
  ArrowUpRight,
  Clock,
  LayoutGrid,
} from "lucide-react";
import { format, isAfter, parseISO, startOfMonth, endOfMonth } from "date-fns";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Founder Calendar" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  // Personal lists use the user's own boards/meetings; the calendar widget uses
  // the org-wide feed so it matches the shared Calendar page.
  const { notes, team, organization, boards, meetings, calendarBoards, calendarMeetings } =
    useStore();
  const [month, setMonth] = useState(new Date());
  const today = new Date();

  const stats = useMemo(() => {
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    const plansThisMonth = notes.filter((n) => {
      const d = parseISO(n.date);
      return d >= monthStart && d <= monthEnd;
    }).length;
    const upcomingDays = new Set(
      notes.filter((n) => isAfter(parseISO(n.date), today)).map((n) => n.date),
    ).size;
    return {
      totalNotes: notes.length,
      plansThisMonth,
      upcomingDays,
      teamMembers: team.length,
    };
  }, [notes, team]);

  const noteCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of notes) m[n.date] = (m[n.date] ?? 0) + 1;
    return m;
  }, [notes]);

  const boardCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of calendarBoards) m[b.date] = (m[b.date] ?? 0) + 1;
    return m;
  }, [calendarBoards]);

  const meetingCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const mt of calendarMeetings) if (mt.date) m[mt.date] = (m[mt.date] ?? 0) + 1;
    return m;
  }, [calendarMeetings]);

  const recentBoards = [...boards]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  const recentMeetings = [...meetings]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  const upcoming = [...notes]
    .filter((n) => isAfter(parseISO(n.date), today))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back to {organization?.name}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Here's what's happening across your workspace today.
        </p>
      </div>

      <motion.div
        variants={statContainer}
        initial="hidden"
        animate="show"
        className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard label="Total Notes" value={stats.totalNotes} icon={StickyNote} accent />
        <StatCard label="Plans This Month" value={stats.plansThisMonth} icon={FileText} accent />
        <StatCard
          label="Upcoming Planned Days"
          value={stats.upcomingDays}
          icon={CalendarCheck}
          accent
        />
        <StatCard label="Team Members" value={stats.teamMembers} icon={Users} accent />
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionHeader
            title="Monthly Calendar"
            action={
              <Link
                to="/calendar"
                className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                Open Calendar <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <div className="h-[520px]">
            <MonthCalendar
              month={month}
              onMonthChange={setMonth}
              noteCounts={noteCounts}
              boardCounts={boardCounts}
              meetingCounts={meetingCounts}
              compact
            />
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <SectionHeader title="Upcoming Activities" />
            <div className="rounded-2xl border border-border bg-card shadow-soft">
              {upcoming.length === 0 ? (
                <EmptyRow icon={Clock} label="Nothing planned ahead" />
              ) : (
                upcoming.map((n, i) => (
                  <div
                    key={n.id}
                    className={`flex gap-3 p-4 transition-colors hover:bg-accent/30 ${i !== upcoming.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <div className="flex w-12 shrink-0 flex-col items-center rounded-lg border border-border bg-secondary px-2 py-1.5 text-center">
                      <span className="text-[10px] font-bold uppercase text-primary">
                        {format(parseISO(n.date), "MMM")}
                      </span>
                      <span className="text-lg font-bold leading-none">
                        {format(parseISO(n.date), "d")}
                      </span>
                    </div>
                    <p className="line-clamp-3 flex-1 text-sm leading-snug">{n.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <SectionHeader
              title="Boards"
              action={
                <Link
                  to="/board"
                  className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  Open <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <div className="rounded-2xl border border-border bg-card shadow-soft">
              {recentBoards.length === 0 ? (
                <EmptyRow icon={LayoutGrid} label="No boards yet" />
              ) : (
                recentBoards.map((b, i) => (
                  <Link
                    key={b.id}
                    to="/board"
                    className={`flex items-center gap-3 p-4 transition-colors hover:bg-accent/30 ${i !== recentBoards.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                      <LayoutGrid className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{b.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {format(parseISO(b.date), "d MMM yyyy")} · {b.boxCount}{" "}
                        {b.boxCount === 1 ? "box" : "boxes"}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))
              )}
            </div>
          </div>

          <div>
            <SectionHeader
              title="Meetings"
              action={
                <Link
                  to="/meeting"
                  className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  Open <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <div className="rounded-2xl border border-border bg-card shadow-soft">
              {recentMeetings.length === 0 ? (
                <EmptyRow icon={CalendarClock} label="No meetings yet" />
              ) : (
                recentMeetings.map((m, i) => (
                  <Link
                    key={m.id}
                    to="/meeting"
                    search={{ meeting: m.id }}
                    className={`flex items-center gap-3 p-4 transition-colors hover:bg-accent/30 ${i !== recentMeetings.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                      <CalendarClock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{m.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {m.date ? `${format(parseISO(m.date), "d MMM yyyy")} · ` : ""}
                        {m.schedule}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

const statContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const statItem = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: boolean;
}) {
  return (
    <motion.div
      variants={statItem}
      className={cn(
        "hover-lift group relative overflow-hidden rounded-2xl border p-5 shadow-soft",
        accent
          ? "border-primary/20 bg-stat-gradient text-primary-foreground"
          : "border-border bg-card",
      )}
    >
      {/* decorative glow */}
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl transition-opacity",
          accent ? "bg-white/20" : "bg-primary/5 group-hover:bg-primary/10",
        )}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p
            className={cn(
              "text-xs font-semibold uppercase tracking-widest",
              accent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {label}
          </p>
          <p className="mt-3 text-3xl font-bold tracking-tight">
            <AnimatedNumber value={value} />
          </p>
        </div>
        <div
          className={cn(
            "grid h-10 w-10 place-items-center rounded-xl transition-transform group-hover:scale-110",
            accent ? "bg-primary-foreground/15" : "bg-accent text-primary",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </motion.div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {action}
    </div>
  );
}

function EmptyRow({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-10 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

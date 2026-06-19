import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { MonthCalendar } from "@/components/month-calendar";
import { NotesDrawer } from "@/components/notes-drawer";
import { useStore } from "@/lib/store";
import { format, parseISO } from "date-fns";

export const Route = createFileRoute("/calendar")({
  // A `date` (YYYY-MM-DD) opens that day's drawer - used by global search.
  validateSearch: (search: Record<string, unknown>): { date?: string } => ({
    date: typeof search.date === "string" ? search.date : undefined,
  }),
  component: CalendarPage,
});

function CalendarPage() {
  const navigate = useNavigate();
  const { date: dateParam } = Route.useSearch();
  const initialDate = dateParam ? parseISO(dateParam) : null;
  const [month, setMonth] = useState(initialDate ?? new Date());
  const [selected, setSelected] = useState<Date | null>(initialDate);

  // Open (and jump the month to) the date passed via the URL, e.g. from search.
  useEffect(() => {
    if (!dateParam) return;
    const d = parseISO(dateParam);
    setSelected(d);
    setMonth(d);
  }, [dateParam]);

  const closeDrawer = () => {
    setSelected(null);
    // Drop the ?date= param so searching the same day again reopens it.
    if (dateParam) navigate({ to: "/calendar", search: {}, replace: true });
  };
  // The calendar is the shared surface: show every org member's notes, boards
  // and meetings (calendarBoards/calendarMeetings), not just the current user's.
  const { notes, calendarBoards, calendarMeetings } = useStore();

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

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your monthly planning surface. Click any date to capture plans and notes.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
          <span className="text-muted-foreground">Viewing</span>{" "}
          <span className="font-semibold">{format(month, "MMMM yyyy")}</span>
        </div>
      </div>

      <div className="h-[calc(100vh-220px)] min-h-[640px]">
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={setSelected}
          noteCounts={noteCounts}
          boardCounts={boardCounts}
          meetingCounts={meetingCounts}
        />
      </div>

      <NotesDrawer date={selected} onClose={closeDrawer} />
    </AppShell>
  );
}

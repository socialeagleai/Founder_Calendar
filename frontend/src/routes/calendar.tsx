import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { MonthCalendar } from "@/components/month-calendar";
import { NotesDrawer } from "@/components/notes-drawer";
import { useStore } from "@/lib/store";
import { format } from "date-fns";

export const Route = createFileRoute("/calendar")({
  head: () => ({ meta: [{ title: "Calendar — Founder Calendar" }] }),
  component: CalendarPage,
});

function CalendarPage() {
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState<Date | null>(null);
  const { notes, boards, meetings } = useStore();

  const noteCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of notes) m[n.date] = (m[n.date] ?? 0) + 1;
    return m;
  }, [notes]);

  const boardCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of boards) m[b.date] = (m[b.date] ?? 0) + 1;
    return m;
  }, [boards]);

  const meetingCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const mt of meetings) if (mt.date) m[mt.date] = (m[mt.date] ?? 0) + 1;
    return m;
  }, [meetings]);

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

      <NotesDrawer date={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}

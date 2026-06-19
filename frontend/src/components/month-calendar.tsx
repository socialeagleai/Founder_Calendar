import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  setYear,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarClock, ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  month: Date;
  onMonthChange: (d: Date) => void;
  selected?: Date | null;
  onSelect?: (d: Date) => void;
  noteCounts: Record<string, number>; // YYYY-MM-DD -> count
  boardCounts?: Record<string, number>; // YYYY-MM-DD -> count
  meetingCounts?: Record<string, number>; // YYYY-MM-DD -> count
  compact?: boolean;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
  noteCounts,
  boardCounts = {},
  meetingCounts = {},
  compact,
}: Props) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);
  const today = new Date();

  // Year options: a range around the current year, always including the
  // currently-viewed year.
  const viewYear = month.getFullYear();
  const baseYear = today.getFullYear();
  const yearSet = new Set<number>();
  for (let y = baseYear - 10; y <= baseYear + 5; y++) yearSet.add(y);
  yearSet.add(viewYear);
  const years = [...yearSet].sort((a, b) => a - b);

  const days: Date[] = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    days.push(cur);
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className={cn("font-bold tracking-tight", compact ? "text-base" : "text-2xl")}>
            {format(month, "MMMM yyyy")}
          </h2>
          {!compact && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Click a date to add notes & plans
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Select
            value={String(viewYear)}
            onValueChange={(v) => onMonthChange(setYear(month, Number(v)))}
          >
            <SelectTrigger
              className={cn(
                "gap-1 font-semibold",
                compact ? "h-8 w-[78px] text-xs" : "h-9 w-[92px]",
              )}
              aria-label="Select year"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => onMonthChange(subMonths(month, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMonthChange(new Date())}
            className="h-9 px-3 text-xs font-semibold"
          >
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => onMonthChange(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-secondary/40">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {compact ? d.charAt(0) : d}
          </div>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const key = format(d, "yyyy-MM-dd");
          const inMonth = isSameMonth(d, month);
          const isToday = isSameDay(d, today);
          const isSel = selected && isSameDay(d, selected);
          const count = noteCounts[key] ?? 0;
          const boardCount = boardCounts[key] ?? 0;
          const meetingCount = meetingCounts[key] ?? 0;
          return (
            <button
              key={i}
              onClick={() => onSelect?.(d)}
              className={cn(
                "group relative flex flex-col items-start border-b border-r border-border p-2 text-left transition-all hover:bg-accent/40 focus:z-10 focus:outline-none focus:ring-2 focus:ring-primary",
                (i + 1) % 7 === 0 && "border-r-0",
                i >= days.length - 7 && "border-b-0",
                !inMonth && "bg-secondary/30 text-muted-foreground/60",
                isSel && "bg-accent/60 ring-2 ring-inset ring-primary",
                compact ? "min-h-[44px]" : "min-h-[96px]",
              )}
            >
              <div className="flex w-full items-center">
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full text-sm font-semibold transition-all group-hover:scale-110",
                    isToday && "bg-primary text-primary-foreground shadow-soft",
                    !isToday && inMonth && "text-foreground group-hover:bg-accent",
                  )}
                >
                  {format(d, "d")}
                </span>
              </div>
              {(count > 0 || boardCount > 0 || meetingCount > 0) && (
                <div className="mt-auto flex flex-col gap-1">
                  {count > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                      {!compact && (
                        <span className="text-sm font-bold text-primary">
                          {count} {count === 1 ? "note" : "notes"}
                        </span>
                      )}
                    </div>
                  )}
                  {boardCount > 0 && (
                    <div className="flex items-center gap-1.5 text-foreground">
                      <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                      {!compact && (
                        <span className="text-sm font-bold">
                          {boardCount} {boardCount === 1 ? "board" : "boards"}
                        </span>
                      )}
                    </div>
                  )}
                  {meetingCount > 0 && (
                    <div className="flex items-center gap-1.5 text-primary">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                      {!compact && (
                        <span className="text-sm font-bold">
                          {meetingCount} {meetingCount === 1 ? "meeting" : "meetings"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

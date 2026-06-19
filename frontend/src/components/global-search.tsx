import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, StickyNote, LayoutGrid, CalendarClock, Users } from "lucide-react";
import { format, parseISO } from "date-fns";

import { useStore, usePageAccess } from "@/lib/store";
import { Input } from "@/components/ui/input";

type ResultType = "note" | "board" | "meeting" | "member";

interface SearchResult {
  type: ResultType;
  id: string;
  title: string;
  subtitle: string;
  go: () => void;
}

const ICONS: Record<ResultType, typeof Search> = {
  note: StickyNote,
  board: LayoutGrid,
  meeting: CalendarClock,
  member: Users,
};

const PER_CATEGORY = 5;

/** Header search across notes, boards, meetings and team members. Results
 *  respect the member's page access and navigate to the matching item. */
export function GlobalSearch() {
  const navigate = useNavigate();
  const notes = useStore((s) => s.notes);
  const boards = useStore((s) => s.calendarBoards);
  const meetings = useStore((s) => s.calendarMeetings);
  const team = useStore((s) => s.team);
  const canNotes = usePageAccess("calendar") !== "none";
  const canBoards = usePageAccess("board") !== "none";
  const canMeetings = usePageAccess("meeting") !== "none";
  const canTeam = usePageAccess("team") !== "none";

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchResult[] = [];

    if (canNotes) {
      for (const n of notes
        .filter((n) => n.content.toLowerCase().includes(q))
        .slice(0, PER_CATEGORY)) {
        out.push({
          type: "note",
          id: n.id,
          title: n.content.replace(/\s+/g, " ").trim().slice(0, 70) || "Note",
          subtitle: format(parseISO(n.date), "d MMM yyyy"),
          go: () => navigate({ to: "/calendar", search: { date: n.date } }),
        });
      }
    }
    if (canBoards) {
      for (const b of boards
        .filter((b) => b.title.toLowerCase().includes(q))
        .slice(0, PER_CATEGORY)) {
        out.push({
          type: "board",
          id: b.id,
          title: b.title,
          subtitle: `Board · ${format(parseISO(b.date), "d MMM yyyy")}`,
          go: () => navigate({ to: "/board", search: { board: b.id } }),
        });
      }
    }
    if (canMeetings) {
      for (const m of meetings
        .filter((m) => m.name.toLowerCase().includes(q))
        .slice(0, PER_CATEGORY)) {
        out.push({
          type: "meeting",
          id: m.id,
          title: m.name,
          subtitle: m.date ? `Meeting · ${format(parseISO(m.date), "d MMM yyyy")}` : "Meeting",
          go: () => navigate({ to: "/meeting", search: { meeting: m.id } }),
        });
      }
    }
    if (canTeam) {
      for (const mem of team
        .filter((mem) => mem.name.toLowerCase().includes(q) || mem.email.toLowerCase().includes(q))
        .slice(0, PER_CATEGORY)) {
        out.push({
          type: "member",
          id: mem.id,
          title: mem.name,
          subtitle: mem.email,
          go: () => navigate({ to: "/team" }),
        });
      }
    }
    return out;
  }, [query, notes, boards, meetings, team, canNotes, canBoards, canMeetings, canTeam, navigate]);

  const open = focused && query.trim().length > 0;

  const select = (r: SearchResult) => {
    r.go();
    setQuery("");
    setFocused(false);
  };

  return (
    <div className="relative ml-auto hidden max-w-md flex-1 md:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setFocused(true);
        }}
        onBlur={() => {
          // Delay so a click on a result registers before the panel closes.
          blurTimer.current = setTimeout(() => setFocused(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) select(results[0]);
          if (e.key === "Escape") {
            setQuery("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Search notes, plans, members…"
        className="h-9 border-border bg-secondary pl-9 text-sm transition-shadow focus-visible:shadow-soft"
      />

      {open && (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-border bg-popover shadow-elevated">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No results for “{query.trim()}”
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((r) => {
                const Icon = ICONS[r.type];
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    // onMouseDown fires before input blur, so navigation isn't lost.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(r);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {r.subtitle}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { ChevronDown, UserRound } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useStore, type TeamMember } from "@/lib/store";
import { cn } from "@/lib/utils";

/** A short label for a set of attendees, e.g. "No attendees", "Priya Nair", "3 people". */
export function attendeeSummary(ids: string[], team: TeamMember[]): string {
  if (ids.length === 0) return "No attendees";
  if (ids.length === 1) return team.find((m) => m.id === ids[0])?.name ?? "1 person";
  return `${ids.length} people`;
}

/**
 * The attendees named in full, for read-only display.
 *
 * Ids with no matching teammate are dropped rather than rendered as a raw id:
 * that's someone who left the org, and their absence is the honest answer.
 */
export function attendeeNames(ids: string[], team: TeamMember[]): string {
  const names = ids
    .map((id) => team.find((m) => m.id === id)?.name)
    .filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(", ") : "No attendees";
}

/**
 * Picks the teammates expected at a meeting.
 *
 * Attendees are who gets the invite email and the 30-minute reminder - a
 * narrower thing than who can *see* the meeting, which is the AudiencePicker
 * next to it. Naming someone here never grants them access: the backend rejects
 * an attendee the audience hides rather than widening it (see
 * backend/app/attendees.py), so the two pickers stay independent and neither
 * silently overrides the other.
 */
export function AttendeePicker({
  value,
  onChange,
  align = "start",
  className,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const team = useStore((s) => s.team);

  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value, id] : value.filter((x) => x !== id));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent",
            className,
          )}
        >
          <UserRound className="h-3.5 w-3.5 text-primary" />
          <span className="max-w-[140px] truncate">{attendeeSummary(value, team)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Who's attending?
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            They get an invite now, and a reminder 30 minutes before.
          </p>
        </div>
        <div className="max-h-56 overflow-y-auto p-1.5">
          {team.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No teammates yet.</p>
          ) : (
            team.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
              >
                <Checkbox
                  checked={value.includes(m.id)}
                  onCheckedChange={(c) => toggle(m.id, c === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.name}</span>
                  {/* Invited-but-never-signed-up members can be attendees, but
                      nothing can be emailed to an unverified address - so say
                      so here rather than let the invite vanish silently. */}
                  {m.status === "Invited" && (
                    <span className="block text-[11px] text-muted-foreground">
                      Hasn't joined yet - no email until they do
                    </span>
                  )}
                </span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

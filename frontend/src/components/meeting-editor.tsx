import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import {
  useStore,
  usePageAccess,
  audienceOf,
  EVERYONE_AUDIENCE,
  SCHEDULES,
  type Audience,
  type MeetingDetail,
  type MeetingSection,
  type Schedule,
  type SectionType,
} from "@/lib/store";
import { AudiencePicker, isAudienceComplete } from "@/components/audience-picker";
import { AttendeePicker, attendeeNames } from "@/components/attendee-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Mode = "view" | "editor";

const SECTION_TYPES: { value: SectionType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "bulleted", label: "Bulleted" },
  { value: "numbered", label: "Numbered" },
];

const uid = () => Math.random().toString(36).slice(2, 10);

interface DecoratedItem {
  item: MeetingSection["items"][number];
  marker: string;
  isHeader: boolean;
}

// Compute the marker (number / bullet / none) for each item. In a BULLETED
// section, a top-level item that is followed by indented children renders as a
// plain bold sub-header (e.g. "Employee" / "Manager"); standalone top-level
// items get a "•". NUMBERED sections number their top-level items.
function decorate(section: MeetingSection): DecoratedItem[] {
  let n = 0;
  return section.items.map((item, i) => {
    if (section.type === "numbered") {
      if (item.level === 0) {
        n += 1;
        return { item, marker: `${n}.`, isHeader: false };
      }
      return { item, marker: "•", isHeader: false };
    }
    // bulleted
    if (item.level === 0) {
      const isHeader = section.items[i + 1]?.level === 1;
      return { item, marker: isHeader ? "" : "•", isHeader };
    }
    return { item, marker: "•", isHeader: false };
  });
}

export function MeetingEditor({
  meetingId,
  onBack,
  initialMode = "view",
}: {
  meetingId: string;
  onBack: () => void;
  initialMode?: Mode;
}) {
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("Weekly");
  const [duration, setDuration] = useState("");
  const [sections, setSections] = useState<MeetingSection[]>([]);
  const [attendees, setAttendees] = useState<string[]>([]);
  // The list item to focus next (the one just created by pressing Enter).
  const [focusId, setFocusId] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [audience, setAudience] = useState<Audience>(EVERYONE_AUDIENCE);
  const [loading, setLoading] = useState(true);
  // Start times are org-local, so name the zone rather than let people guess.
  const orgTimezone = useStore((s) => s.organization?.timezone ?? "");
  const team = useStore((s) => s.team);
  // "edit" access can change anyone's meeting; "view" can only edit their own.
  const level = usePageAccess("meeting");
  const canEdit = level === "edit" || meeting?.mine === true;
  const [mode, setMode] = useState<Mode>("view");
  const readOnly = mode === "view";

  useEffect(() => setMode(canEdit ? initialMode : "view"), [initialMode, canEdit]);

  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  // Latest values for the debounced save. Every editable field must be listed
  // here - one that isn't is simply never sent, silently, with no type error.
  const latest = useRef({ name, startTime, schedule, duration, sections, attendees });
  latest.current = { name, startTime, schedule, duration, sections, attendees };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(() => {
    api
      .updateMeeting(meetingId, latest.current)
      .then(() => useStore.getState().refreshMeetings())
      .catch((err) =>
        // Show the server's message, not a generic one: the refusal that
        // actually happens here is "Priya can't see this meeting", which names
        // the person and the fix. Swallowing it would leave an autosave that
        // just quietly stops working.
        toast.error(err instanceof Error ? err.message : "Could not save changes"),
      );
  }, [meetingId]);

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 600);
  }, [save]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .getMeeting(meetingId)
      .then((m) => {
        if (!active) return;
        setMeeting(m);
        setName(m.name);
        setStartTime(m.startTime);
        setSchedule(m.schedule);
        setDuration(m.duration);
        setSections(m.sections);
        setAttendees(m.attendees ?? []);
        setAudience(audienceOf(m));
      })
      .catch(() => {
        if (!active) return;
        toast.error("That meeting no longer exists");
        onBackRef.current();
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      if (timer.current) {
        clearTimeout(timer.current);
        api.updateMeeting(meetingId, latest.current).catch(() => {});
      }
    };
  }, [meetingId]);

  // ---- mutations (update state + autosave) ----
  const patchSection = (id: string, patch: Partial<MeetingSection>) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    scheduleSave();
  };
  const addSection = () => {
    setSections((prev) => [
      ...prev,
      { id: uid(), title: "", type: "bulleted", body: "", items: [] },
    ]);
    scheduleSave();
  };
  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
    scheduleSave();
  };
  const addItem = (sectionId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, items: [...s.items, { id: uid(), text: "", level: 0 }] } : s,
      ),
    );
    scheduleSave();
  };
  const patchItem = (
    sectionId: string,
    itemId: string,
    patch: Partial<{ text: string; level: number }>,
  ) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
          : s,
      ),
    );
    scheduleSave();
  };
  const removeItem = (sectionId: string, itemId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, items: s.items.filter((it) => it.id !== itemId) } : s,
      ),
    );
    scheduleSave();
  };
  // Insert a new item right after `afterItemId` (same indent level) - used when
  // the user presses Enter to keep writing the next bullet/numbered point.
  const addItemAfter = (sectionId: string, afterItemId: string, level: number) => {
    const newId = uid();
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        const idx = s.items.findIndex((it) => it.id === afterItemId);
        const items = [...s.items];
        items.splice(idx + 1, 0, { id: newId, text: "", level });
        return { ...s, items };
      }),
    );
    setFocusId(newId);
    scheduleSave();
  };

  // Move the cursor into a freshly inserted item once it has rendered.
  useEffect(() => {
    if (focusId && itemRefs.current[focusId]) {
      itemRefs.current[focusId]?.focus();
      setFocusId(null);
    }
  }, [focusId, sections]);

  const changeAudience = (next: Audience) => {
    setAudience(next);
    // Don't persist a half-finished choice (e.g. "Departments" with nothing
    // ticked). The picker warns until at least one is selected; we save once
    // the audience is complete.
    if (!isAudienceComplete(next)) return;
    useStore
      .getState()
      .setMeetingAudience(meetingId, next)
      .catch(() => toast.error("Could not update visibility"));
  };

  if (loading || !meeting) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Meetings
        </Button>
        <input
          value={name}
          readOnly={readOnly}
          onChange={(e) => {
            setName(e.target.value);
            scheduleSave();
          }}
          placeholder="Meeting name"
          className="min-w-0 flex-1 truncate bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/50"
        />
        {canEdit && (
          <div className="ml-auto flex items-center rounded-lg border border-border bg-secondary/50 p-0.5 text-sm">
            <button
              onClick={() => setMode("view")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors",
                mode === "view"
                  ? "bg-card text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Eye className="h-3.5 w-3.5" /> View
            </button>
            <button
              onClick={() => setMode("editor")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors",
                mode === "editor"
                  ? "bg-card text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Pencil className="h-3.5 w-3.5" /> Editor
            </button>
          </div>
        )}
      </div>

      {/* Schedule + duration */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {readOnly ? (
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-primary">
            {schedule}
          </span>
        ) : (
          <Select
            value={schedule}
            onValueChange={(v) => {
              setSchedule(v as Schedule);
              scheduleSave();
            }}
          >
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium">Starts</span>
          {readOnly ? (
            <span>{startTime ? `${startTime} ${orgTimezone}` : "No time set"}</span>
          ) : (
            <Input
              type="time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                scheduleSave();
              }}
              className="h-9 w-[130px]"
              title={
                orgTimezone ? `${orgTimezone} - reminders go out 30 minutes before` : undefined
              }
            />
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium">Duration</span>
          {readOnly ? (
            <span>{duration || "-"}</span>
          ) : (
            <Input
              value={duration}
              onChange={(e) => {
                setDuration(e.target.value);
                scheduleSave();
              }}
              placeholder="e.g. 60 mins"
              className="h-9 w-[160px]"
            />
          )}
        </div>
        {/* Attendees + audience - pickers are shown only to editors. Attendees
            are who gets the invite and the reminder; the audience is who can
            open the meeting at all. Naming an attendee never widens the
            audience (the save 422s instead) - see backend/app/attendees.py. */}
        {!readOnly && canEdit && (
          <AttendeePicker
            value={attendees}
            onChange={(next) => {
              setAttendees(next);
              scheduleSave();
            }}
            align="end"
          />
        )}
        {!readOnly && canEdit && (
          <AudiencePicker value={audience} onChange={changeAudience} align="end" />
        )}
      </div>
      {readOnly && attendees.length > 0 && (
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" />
          <span>{attendeeNames(attendees, team)}</span>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {sections.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground shadow-soft">
            {readOnly
              ? "This meeting has no sections yet."
              : "Add a section to start building your agenda."}
          </div>
        )}

        {sections.map((section) => (
          <div
            key={section.id}
            className="rounded-2xl border border-border bg-card p-5 shadow-soft"
          >
            {/* Section header */}
            <div className="mb-3 flex items-center gap-2">
              <input
                value={section.title}
                readOnly={readOnly}
                onChange={(e) => patchSection(section.id, { title: e.target.value })}
                placeholder="Section title"
                className="min-w-0 flex-1 bg-transparent text-base font-bold tracking-tight outline-none placeholder:text-muted-foreground/50"
              />
              {!readOnly && (
                <>
                  <Select
                    value={section.type}
                    onValueChange={(v) => patchSection(section.id, { type: v as SectionType })}
                  >
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SECTION_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => removeSection(section.id)}
                    title="Delete section"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>

            {/* Section body */}
            {section.type === "text" ? (
              readOnly ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {section.body || "-"}
                </p>
              ) : (
                <Textarea
                  value={section.body}
                  onChange={(e) => patchSection(section.id, { body: e.target.value })}
                  placeholder="Type here…"
                  rows={2}
                  className="resize-none text-sm"
                />
              )
            ) : (
              <div className="space-y-1.5">
                {decorate(section).map(({ item, marker, isHeader }) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2"
                    style={{ paddingLeft: item.level * 24 }}
                  >
                    {!readOnly && (
                      <button
                        onClick={() =>
                          patchItem(section.id, item.id, { level: item.level === 0 ? 1 : 0 })
                        }
                        title={item.level === 0 ? "Make sub-item" : "Promote"}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {item.level === 0 ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronLeft className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    <span className="w-5 shrink-0 text-right text-sm font-medium text-muted-foreground">
                      {marker}
                    </span>
                    {readOnly ? (
                      <span
                        className={cn(
                          "flex-1 text-sm leading-relaxed",
                          isHeader && "font-semibold",
                        )}
                      >
                        {item.text}
                      </span>
                    ) : (
                      <input
                        ref={(el) => {
                          itemRefs.current[item.id] = el;
                        }}
                        value={item.text}
                        onChange={(e) => patchItem(section.id, item.id, { text: e.target.value })}
                        onKeyDown={(e) => {
                          // Enter starts the next point; Backspace on an empty
                          // line removes it and hops back to the previous one.
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addItemAfter(section.id, item.id, item.level);
                          } else if (e.key === "Backspace" && item.text === "") {
                            e.preventDefault();
                            const idx = section.items.findIndex((it) => it.id === item.id);
                            if (idx > 0) setFocusId(section.items[idx - 1].id);
                            removeItem(section.id, item.id);
                          }
                        }}
                        placeholder={isHeader ? "Sub-header…" : "List item…"}
                        className={cn(
                          "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40",
                          isHeader && "font-semibold",
                        )}
                      />
                    )}
                    {!readOnly && (
                      <button
                        onClick={() => removeItem(section.id, item.id)}
                        title="Remove item"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-primary"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {!readOnly && (
                  <button
                    onClick={() => addItem(section.id)}
                    className="mt-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:bg-accent"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add item
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {!readOnly && (
          <Button onClick={addSection} variant="outline" className="w-full gap-1.5 border-dashed">
            <Plus className="h-4 w-4" /> Add Section
          </Button>
        )}
      </div>
    </div>
  );
}

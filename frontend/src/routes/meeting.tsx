import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { ArrowLeft, CalendarClock, CalendarPlus, Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { MeetingEditor } from "@/components/meeting-editor";
import { MeetingContent } from "@/components/meeting-content";
import { AudiencePicker, isAudienceComplete } from "@/components/audience-picker";
import { AttendeePicker } from "@/components/attendee-picker";
import { Calendar } from "@/components/ui/calendar";
import {
  useStore,
  usePageAccess,
  EVERYONE_AUDIENCE,
  SCHEDULES,
  type Audience,
  type MeetingInput,
  type MeetingSummary,
  type MeetingTemplateData,
  type Schedule,
  type Template,
} from "@/lib/store";
import { cloneSections, isMeetingData } from "@/lib/template-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/meeting")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { meeting?: string; mode?: "view" | "editor" } => ({
    meeting: typeof search.meeting === "string" ? search.meeting : undefined,
    mode: search.mode === "editor" ? "editor" : undefined,
  }),
  component: MeetingPage,
});

const BLANK_KEY = "__blank__";

function NewMeetingDialog({ onCreate }: { onCreate: (input: MeetingInput) => Promise<void> }) {
  // Select the stable array; filtering inside the selector returns a new
  // reference each render and trips useSyncExternalStore's infinite-loop guard.
  const allTemplates = useStore((s) => s.templates);
  const meetingTemplates = useMemo(
    () => allTemplates.filter((t): t is Template => t.kind === "meeting"),
    [allTemplates],
  );
  // Start times are org-local, so name the zone rather than let people guess.
  const orgTimezone = useStore((s) => s.organization?.timezone ?? "");

  const [open, setOpen] = useState(false);
  // Two-step flow: pick the date first, then the meeting details.
  const [step, setStep] = useState<"date" | "details">("date");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [tpl, setTpl] = useState<string>(BLANK_KEY);
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("Weekly");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [audience, setAudience] = useState<Audience>(EVERYONE_AUDIENCE);
  // The sections/duration carried by the currently picked template.
  const [picked, setPicked] = useState<MeetingTemplateData | null>(null);

  const reset = () => {
    setStep("date");
    setDate(undefined);
    setTpl(BLANK_KEY);
    setPicked(null);
    setName("");
    setStartTime("");
    setSchedule("Weekly");
    setAttendees([]);
    setAudience(EVERYONE_AUDIENCE);
  };

  const pickDate = (d: Date | undefined) => {
    if (!d) return;
    setDate(d);
    setStep("details");
  };

  const pickBlank = () => {
    setTpl(BLANK_KEY);
    setPicked(null);
    setName("");
    setStartTime("");
    setSchedule("Weekly");
  };

  const pickTemplate = (t: Template) => {
    if (!isMeetingData(t)) return;
    setTpl(t.id);
    setPicked(t.data);
    setName(t.name);
    setStartTime(t.data.startTime ?? "");
    setSchedule(t.data.schedule);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;
    if (!isAudienceComplete(audience))
      return toast.error("Select at least one department or person, or change who can see this");
    await onCreate({
      name: name.trim() || "Untitled meeting",
      date: format(date, "yyyy-MM-dd"),
      startTime,
      schedule,
      attendees,
      duration: picked?.duration ?? "",
      // Fresh ids so editing the new meeting never mutates the template.
      sections: picked ? cloneSections(picked.sections) : [],
      visibility: audience.visibility,
      visibleDepartments: audience.visibleDepartments,
      visibleMembers: audience.visibleMembers,
    });
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary-dark">
          <Plus className="h-4 w-4" /> New Meeting
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
          <DialogDescription>
            {step === "date"
              ? "Pick the date this meeting is scheduled for."
              : "Start blank or from a template, then refine the details."}
          </DialogDescription>
        </DialogHeader>

        {step === "date" ? (
          <div className="flex justify-center py-2">
            <Calendar mode="single" selected={date} onSelect={pickDate} autoFocus />
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <button
              type="button"
              onClick={() => setStep("date")}
              className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {date ? format(date, "EEEE, d MMMM yyyy") : "Pick a date"}
            </button>
            <div className="space-y-2">
              <Label>Template</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={pickBlank}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all",
                    tpl === BLANK_KEY
                      ? "border-primary bg-accent shadow-soft"
                      : "border-border hover:bg-accent/50",
                  )}
                >
                  <div className="text-sm font-semibold">Blank</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">Start from scratch</div>
                </button>
                {meetingTemplates.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => pickTemplate(t)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-all",
                      tpl === t.id
                        ? "border-primary bg-accent shadow-soft"
                        : "border-border hover:bg-accent/50",
                    )}
                  >
                    <div className="truncate text-sm font-semibold">{t.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {isMeetingData(t) ? t.data.schedule : ""}
                      {isMeetingData(t) && t.data.duration ? ` · ${t.data.duration}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mname">Meeting name</Label>
              <Input
                id="mname"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Leadership Meeting"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Schedule</Label>
                <Select value={schedule} onValueChange={(v) => setSchedule(v as Schedule)}>
                  <SelectTrigger>
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="mtime">Start time</Label>
                <Input
                  id="mtime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {startTime
                    ? `${orgTimezone} - reminders go out 30 minutes before`
                    : "Optional. Without one, no reminders are sent."}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Who can see this</Label>
                <div>
                  <AudiencePicker value={audience} onChange={setAudience} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Attendees</Label>
                <div>
                  <AttendeePicker value={attendees} onChange={setAttendees} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={!isAudienceComplete(audience)}
                className="bg-primary text-primary-foreground hover:bg-primary-dark"
              >
                Create meeting
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MeetingCard({
  meeting,
  onOpen,
  onRename,
  onCopy,
  onDelete,
  canEdit,
}: {
  meeting: MeetingSummary;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onCopy: (id: string, date: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  canEdit: boolean;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(meeting.name);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState<Date | undefined>(undefined);

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = name.trim();
    if (!t) return;
    await onRename(meeting.id, t);
    setRenameOpen(false);
  };

  const confirmCopy = async () => {
    if (!copyDate) return;
    await onCopy(meeting.id, format(copyDate, "yyyy-MM-dd"));
    setCopyOpen(false);
    setCopyDate(undefined);
  };

  const iconBtn =
    "rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-primary group-hover:opacity-100";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onOpen(meeting.id)}
      className="hover-lift group relative mb-4 block w-full cursor-pointer break-inside-avoid rounded-2xl border border-border bg-card p-5 text-left shadow-soft"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
          <CalendarClock className="h-5 w-5" />
        </div>
        {canEdit && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Dialog
              open={renameOpen}
              onOpenChange={(o) => {
                setRenameOpen(o);
                if (o) setName(meeting.name);
              }}
            >
              <DialogTrigger asChild>
                <button title="Rename meeting" className={iconBtn}>
                  <Pencil className="h-4 w-4" />
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rename meeting</DialogTitle>
                </DialogHeader>
                <form onSubmit={submitRename} className="space-y-4">
                  <Input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Meeting name"
                  />
                  <DialogFooter>
                    <Button
                      type="submit"
                      className="bg-primary text-primary-foreground hover:bg-primary-dark"
                    >
                      Save
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog
              open={copyOpen}
              onOpenChange={(o) => {
                setCopyOpen(o);
                if (!o) setCopyDate(undefined);
              }}
            >
              <DialogTrigger asChild>
                <button title="Copy to date" className={iconBtn}>
                  <CalendarPlus className="h-4 w-4" />
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Copy meeting to a date</DialogTitle>
                  <DialogDescription>
                    Creates a copy of “{meeting.name}” - same agenda and audience - on the day you
                    pick.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-center">
                  <Calendar mode="single" selected={copyDate} onSelect={setCopyDate} autoFocus />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCopyOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={!copyDate}
                    onClick={confirmCopy}
                    className="bg-primary text-primary-foreground hover:bg-primary-dark"
                  >
                    OK
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button title="Delete meeting" className={iconBtn}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete meeting?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes “{meeting.name}”.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(meeting.id)}
                    className="bg-primary text-primary-foreground hover:bg-primary-dark"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
      {meeting.date && (
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {format(parseISO(meeting.date), "d MMM yyyy")}
          {meeting.startTime && ` · ${meeting.startTime}`}
        </div>
      )}
      <span className="inline-block rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-primary">
        {meeting.schedule}
      </span>
      <div className="mt-2 truncate text-base font-bold">{meeting.name}</div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {meeting.sectionCount} {meeting.sectionCount === 1 ? "section" : "sections"}
        </span>
        {meeting.duration && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {meeting.duration}
          </span>
        )}
      </div>

      {meeting.sections.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <MeetingContent sections={meeting.sections} />
        </div>
      )}
    </motion.div>
  );
}

function MeetingPage() {
  const navigate = useNavigate();
  const { meeting: selectedId, mode } = Route.useSearch();
  const { meetings, createMeeting, renameMeeting, copyMeeting, deleteMeeting } = useStore();
  // Every meeting on this page is the member's own, so view access is enough.
  const canEdit = usePageAccess("meeting") !== "none";

  const openMeeting = (id: string) => navigate({ to: "/meeting", search: { meeting: id } });
  const closeMeeting = () => navigate({ to: "/meeting", search: {} });

  const handleCreate = async (input: MeetingInput) => {
    try {
      const m = await createMeeting(input);
      navigate({ to: "/meeting", search: { meeting: m.id, mode: "editor" } });
      toast.success("Meeting created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create meeting");
    }
  };

  const handleRename = async (id: string, name: string) => {
    try {
      await renameMeeting(id, name);
      toast.success("Meeting renamed");
    } catch {
      toast.error("Could not rename meeting");
    }
  };

  const handleCopy = async (id: string, date: string) => {
    try {
      await copyMeeting(id, date);
      toast.success(`Meeting copied to ${format(parseISO(date), "d MMM yyyy")}`);
    } catch {
      toast.error("Could not copy meeting");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMeeting(id);
      toast.success("Meeting deleted");
    } catch {
      toast.error("Could not delete meeting");
    }
  };

  if (selectedId) {
    return (
      <AppShell>
        <MeetingEditor
          meetingId={selectedId}
          onBack={closeMeeting}
          initialMode={mode === "editor" ? "editor" : "view"}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meetings</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Recurring meeting templates with structured agendas. Plan once, run them every time.
          </p>
        </div>
        {canEdit && <NewMeetingDialog onCreate={handleCreate} />}
      </div>

      {meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card py-20 text-center shadow-soft">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent text-primary">
            <CalendarClock className="h-7 w-7" />
          </div>
          <p className="mt-5 text-base font-semibold">No meetings yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {canEdit
              ? "Create a meeting from a template or start blank, then build its agenda."
              : "No meetings have been shared with you yet."}
          </p>
          {canEdit && (
            <div className="mt-6">
              <NewMeetingDialog onCreate={handleCreate} />
            </div>
          )}
        </div>
      ) : (
        <div className="[column-gap:1rem] sm:columns-2 lg:columns-3">
          {meetings.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              onOpen={openMeeting}
              onRename={handleRename}
              onCopy={handleCopy}
              onDelete={handleDelete}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

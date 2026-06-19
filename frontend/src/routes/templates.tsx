import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Clock, LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { MeetingContent } from "@/components/meeting-content";
import { MeetingSectionsEditor } from "@/components/meeting-sections-editor";
import { BoardTemplateEditor } from "@/components/board-template-editor";
import {
  useStore,
  usePageAccess,
  type MeetingSection,
  type MeetingTemplateData,
  type Schedule,
  type Template,
} from "@/lib/store";
import { isBoardData, isMeetingData } from "@/lib/template-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export const Route = createFileRoute("/templates")({
  // `board` holds a board-template id to edit, or "new" to author a fresh one —
  // it opens the full-page board canvas (same as a real board).
  validateSearch: (search: Record<string, unknown>): { board?: string } => ({
    board: typeof search.board === "string" ? search.board : undefined,
  }),
  head: () => ({ meta: [{ title: "My Templates — Founder Calendar" }] }),
  component: TemplatesPage,
});

const SCHEDULES: Schedule[] = ["Daily", "Weekly", "Biweekly", "Monthly", "Yearly"];

const iconBtn =
  "rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-primary group-hover:opacity-100";

// ---------------------------------------------------------------------------
// Meeting template editor
// ---------------------------------------------------------------------------
function MeetingTemplateDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Template | null;
  onSave: (name: string, data: MeetingTemplateData) => Promise<void>;
}) {
  const seed = () => {
    if (initial && isMeetingData(initial)) {
      return {
        name: initial.name,
        schedule: initial.data.schedule ?? "Weekly",
        duration: initial.data.duration ?? "",
        sections: initial.data.sections ?? [],
      };
    }
    return {
      name: "",
      schedule: "Weekly" as Schedule,
      duration: "",
      sections: [] as MeetingSection[],
    };
  };

  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("Weekly");
  const [duration, setDuration] = useState("");
  const [sections, setSections] = useState<MeetingSection[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const s = seed();
    setName(s.name);
    setSchedule(s.schedule);
    setDuration(s.duration);
    setSections(s.sections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(name.trim() || "Untitled meeting template", { schedule, duration, sections });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit meeting template" : "New meeting template"}</DialogTitle>
          <DialogDescription>
            Build a reusable agenda. It appears as an option when creating a new meeting.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="mtname">Template name</Label>
            <Input
              id="mtname"
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
              <Label htmlFor="mtdur">Duration</Label>
              <Input
                id="mtdur"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g. 60 mins"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Agenda sections</Label>
            <MeetingSectionsEditor sections={sections} onChange={setSections} />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary-dark"
            >
              {initial ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
function TemplateCard({
  template,
  onEdit,
  onDelete,
  children,
  icon,
  canEdit,
}: {
  template: Template;
  onEdit: () => void;
  onDelete: () => void;
  children?: React.ReactNode;
  icon: React.ReactNode;
  canEdit: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="hover-lift group relative rounded-2xl border border-border bg-card p-5 shadow-soft"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
          {icon}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <button title="Edit template" onClick={onEdit} className={iconBtn}>
              <Pencil className="h-4 w-4" />
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button title="Delete template" className={iconBtn}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete template?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes “{template.name}”.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
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
      <div className="truncate text-base font-bold">{template.name}</div>
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function TemplatesPage() {
  const navigate = useNavigate();
  const { board: boardParam } = Route.useSearch();
  const { templates, createTemplate, updateTemplate, deleteTemplate } = useStore();

  const boardTemplates = templates.filter((t) => t.kind === "board");
  const meetingTemplates = templates.filter((t) => t.kind === "meeting");

  const canEdit = usePageAccess("templates") === "edit";
  const [tab, setTab] = useState<"board" | "meeting">("board");
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  // Board templates open the full-page canvas (same as a real board) via the URL.
  const openNewBoard = () => navigate({ to: "/templates", search: { board: "new" } });
  const openEditBoard = (t: Template) => navigate({ to: "/templates", search: { board: t.id } });
  const closeBoardEditor = () => navigate({ to: "/templates", search: {} });

  const openNewMeeting = () => {
    setEditing(null);
    setMeetingOpen(true);
  };
  const openEditMeeting = (t: Template) => {
    setEditing(t);
    setMeetingOpen(true);
  };

  // Full-page board-template canvas (edit-only).
  if (boardParam && canEdit) {
    return (
      <AppShell>
        <BoardTemplateEditor
          key={boardParam}
          templateId={boardParam === "new" ? undefined : boardParam}
          onBack={closeBoardEditor}
        />
      </AppShell>
    );
  }

  const saveMeeting = async (name: string, data: MeetingTemplateData) => {
    try {
      if (editing) {
        await updateTemplate(editing.id, { name, data });
        toast.success("Template updated");
      } else {
        await createTemplate({ kind: "meeting", name, data });
        toast.success("Meeting template created");
      }
    } catch {
      toast.error("Could not save template");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTemplate(id);
      toast.success("Template deleted");
    } catch {
      toast.error("Could not delete template");
    }
  };

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">My Templates</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Author reusable templates for boards and meetings. They show up as choices when you create
          a new board or meeting.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "board" | "meeting")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="board" className="gap-1.5">
              <LayoutGrid className="h-4 w-4" /> Board Templates
            </TabsTrigger>
            <TabsTrigger value="meeting" className="gap-1.5">
              <CalendarClock className="h-4 w-4" /> Meeting Templates
            </TabsTrigger>
          </TabsList>
          {canEdit && (
            <Button
              onClick={tab === "board" ? openNewBoard : openNewMeeting}
              className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary-dark"
            >
              <Plus className="h-4 w-4" />
              {tab === "board" ? "New Board Template" : "New Meeting Template"}
            </Button>
          )}
        </div>

        {/* Board templates */}
        <TabsContent value="board" className="mt-6">
          {boardTemplates.length === 0 ? (
            <EmptyState
              icon={<LayoutGrid className="h-7 w-7" />}
              title="No board templates yet"
              hint="Create a board template to drop a ready-made set of boxes onto any board."
            />
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              {boardTemplates.map((t) => {
                const count = isBoardData(t) ? (t.data.boxes?.length ?? 0) : 0;
                return (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    icon={<LayoutGrid className="h-5 w-5" />}
                    onEdit={() => openEditBoard(t)}
                    onDelete={() => handleDelete(t.id)}
                    canEdit={canEdit}
                  >
                    <div className="mt-2 text-xs text-muted-foreground">
                      {count} {count === 1 ? "box" : "boxes"}
                    </div>
                  </TemplateCard>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Meeting templates */}
        <TabsContent value="meeting" className="mt-6">
          {meetingTemplates.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="h-7 w-7" />}
              title="No meeting templates yet"
              hint="Create a meeting template to reuse a structured agenda every time."
            />
          ) : (
            <div className="[column-gap:1rem] sm:columns-2 lg:columns-3">
              {meetingTemplates.map((t) => {
                const data = isMeetingData(t) ? t.data : null;
                return (
                  <div key={t.id} className="mb-4 break-inside-avoid">
                    <TemplateCard
                      template={t}
                      icon={<CalendarClock className="h-5 w-5" />}
                      onEdit={() => openEditMeeting(t)}
                      onDelete={() => handleDelete(t.id)}
                      canEdit={canEdit}
                    >
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-primary">
                          {data?.schedule ?? "Weekly"}
                        </span>
                        {data?.duration && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {data.duration}
                          </span>
                        )}
                      </div>
                      {data && data.sections.length > 0 && (
                        <div className="mt-4 border-t border-border pt-4">
                          <MeetingContent sections={data.sections} />
                        </div>
                      )}
                    </TemplateCard>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <MeetingTemplateDialog
        open={meetingOpen}
        onOpenChange={setMeetingOpen}
        initial={editing && editing.kind === "meeting" ? editing : null}
        onSave={saveMeeting}
      />
    </AppShell>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card py-20 text-center shadow-soft">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent text-primary">
        {icon}
      </div>
      <p className="mt-5 text-base font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

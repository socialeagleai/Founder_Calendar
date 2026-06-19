import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { CalendarClock, Pencil, Trash2, X, Plus, Check, LayoutGrid, UserRound } from "lucide-react";
import { useState } from "react";
import { useStore, usePageAccess, type Note } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface Props {
  date: Date | null;
  onClose: () => void;
}

export function NotesDrawer({ date, onClose }: Props) {
  const navigate = useNavigate();
  // `boards` = the current user's own boards (used to find-or-create their board
  // for a date). `calendarBoards`/`calendarMeetings` = the whole org's, shown on
  // the shared calendar so everyone's plans are visible here.
  const {
    notes,
    boards,
    calendarBoards,
    calendarMeetings,
    saveNote,
    deleteNote,
    createBoard,
    createMeeting,
  } = useStore();
  const canEditNotes = usePageAccess("calendar") === "edit";
  const boardAccess = usePageAccess("board");
  const canViewBoards = boardAccess !== "none";
  const canEditBoards = boardAccess === "edit";
  const meetingAccess = usePageAccess("meeting");
  const canViewMeetings = meetingAccess !== "none";
  const canEditMeetings = meetingAccess === "edit";
  const dateKey = date ? format(date, "yyyy-MM-dd") : "";
  const dayNotes = notes.filter((n) => n.date === dateKey);
  const dayMeetings = canViewMeetings ? calendarMeetings.filter((m) => m.date === dateKey) : [];
  const dayBoards = canViewBoards ? calendarBoards.filter((b) => b.date === dateKey) : [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  // Open (or create) the board for this date and jump into the editor.
  const goToBoard = async () => {
    if (!date) return;
    try {
      const existing = boards.find((b) => b.date === dateKey);
      const id = existing
        ? existing.id
        : (await createBoard(dateKey, `Board · ${format(date, "d MMM yyyy")}`)).id;
      onClose();
      navigate({ to: "/board", search: { board: id, mode: "editor" } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open board");
    }
  };

  const openMeeting = (id: string) => {
    onClose();
    navigate({ to: "/meeting", search: { meeting: id } });
  };

  // Open any org member's board (read-only by default) from the calendar.
  const openBoard = (id: string) => {
    onClose();
    navigate({ to: "/board", search: { board: id } });
  };

  // Create a blank meeting on this date and jump into its editor.
  const addMeeting = async () => {
    if (!date) return;
    try {
      const m = await createMeeting({
        name: "Untitled meeting",
        date: dateKey,
        schedule: "Weekly",
        duration: "",
        sections: [],
      });
      onClose();
      navigate({ to: "/meeting", search: { meeting: m.id, mode: "editor" } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create meeting");
    }
  };

  const startEdit = (n: Note) => {
    setEditingId(n.id);
    setDraft(n.content);
    setAdding(false);
  };
  const startAdd = () => {
    setEditingId(null);
    setDraft("");
    setAdding(true);
  };
  const cancel = () => {
    setEditingId(null);
    setDraft("");
    setAdding(false);
  };
  const save = async () => {
    if (!draft.trim()) return toast.error("Note can't be empty");
    try {
      await saveNote(dateKey, draft.trim(), editingId ?? undefined);
      toast.success(editingId ? "Note updated" : "Note saved");
      cancel();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save note");
    }
  };

  return (
    <AnimatePresence>
      {date && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-border bg-background shadow-elevated"
          >
            <div className="flex items-start justify-between border-b border-border px-6 py-5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {format(date, "EEEE")}
                </div>
                <h2 className="mt-1 text-xl font-bold tracking-tight">
                  {format(date, "d MMMM yyyy")}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dayNotes.length} {dayNotes.length === 1 ? "note" : "notes"}
                  {dayBoards.length > 0 &&
                    ` · ${dayBoards.length} ${dayBoards.length === 1 ? "board" : "boards"}`}
                  {dayMeetings.length > 0 &&
                    ` · ${dayMeetings.length} ${dayMeetings.length === 1 ? "meeting" : "meetings"}`}
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
              {dayNotes.length === 0 &&
                dayMeetings.length === 0 &&
                dayBoards.length === 0 &&
                !adding && (
                  <button
                    type="button"
                    onClick={startAdd}
                    disabled={!canEditNotes}
                    title={canEditNotes ? "Add a note" : undefined}
                    className="group flex w-full flex-col items-center justify-center rounded-2xl py-12 text-center transition-colors hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent transition-all group-hover:scale-105 group-enabled:group-hover:bg-primary group-enabled:group-hover:text-primary-foreground">
                      <Plus className="h-6 w-6 text-primary group-enabled:group-hover:text-primary-foreground" />
                    </div>
                    <p className="mt-4 text-sm font-medium">No notes for this day</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {canEditNotes
                        ? "What needs to happen on this day?"
                        : "View only — no notes yet"}
                    </p>
                  </button>
                )}

              {dayNotes.map((n) =>
                editingId === n.id ? (
                  <Editor
                    key={n.id}
                    value={draft}
                    onChange={setDraft}
                    onSave={save}
                    onCancel={cancel}
                  />
                ) : (
                  <div
                    key={n.id}
                    className="group rounded-xl border border-border bg-card p-4 transition-all hover:shadow-soft"
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{n.content}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {format(new Date(n.updatedAt), "h:mm a")}
                      </span>
                      <div className="flex min-w-0 items-center gap-2">
                        <CreatorBadge name={n.creatorName} />
                        {canEditNotes && (
                          <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => startEdit(n)}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await deleteNote(n.id);
                                  toast.success("Note deleted");
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : "Could not delete note",
                                  );
                                }
                              }}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ),
              )}

              {adding && (
                <Editor value={draft} onChange={setDraft} onSave={save} onCancel={cancel} />
              )}

              {dayBoards.length > 0 && (
                <div className="pt-2">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    <LayoutGrid className="h-3.5 w-3.5" /> Boards
                  </div>
                  <div className="space-y-2">
                    {dayBoards.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => openBoard(b.id)}
                        className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-all hover:shadow-soft"
                      >
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                          <LayoutGrid className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{b.title}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {b.boxCount} {b.boxCount === 1 ? "box" : "boxes"}
                            {b.openTaskCount > 0 ? ` · ${b.openTaskCount} open` : ""}
                          </p>
                        </div>
                        <CreatorBadge name={b.creatorName} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {dayMeetings.length > 0 && (
                <div className="pt-2">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" /> Meetings
                  </div>
                  <div className="space-y-2">
                    {dayMeetings.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => openMeeting(m.id)}
                        className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-all hover:shadow-soft"
                      >
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                          <CalendarClock className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{m.name}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {m.schedule}
                            {m.duration ? ` · ${m.duration}` : ""}
                          </p>
                        </div>
                        <CreatorBadge name={m.creatorName} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {!adding && !editingId && (canEditNotes || canEditBoards || canEditMeetings) && (
              <div className="space-y-2 border-t border-border bg-secondary/40 px-6 py-4">
                {canEditNotes && (
                  <Button
                    onClick={startAdd}
                    className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary-dark"
                  >
                    <Plus className="h-4 w-4" /> Add Note
                  </Button>
                )}
                {canEditBoards && (
                  <Button variant="outline" onClick={goToBoard} className="h-11 w-full">
                    <LayoutGrid className="h-4 w-4" /> Add Board
                  </Button>
                )}
                {canEditMeetings && (
                  <Button variant="outline" onClick={addMeeting} className="h-11 w-full">
                    <CalendarClock className="h-4 w-4" /> Add Meeting
                  </Button>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** Small right-aligned chip showing who added a note / board / meeting. */
function CreatorBadge({ name }: { name?: string | null }) {
  if (!name) return null;
  return (
    <span
      title={`Added by ${name}`}
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
    >
      <UserRound className="h-3 w-3" />
      <span className="max-w-[90px] truncate">{name}</span>
    </span>
  );
}

function Editor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border-2 border-primary/30 bg-card p-3">
      <Textarea
        autoFocus
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What needs to happen on this day?"
        className="resize-none border-0 px-1 text-sm shadow-none focus-visible:ring-0"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          className="bg-primary text-primary-foreground hover:bg-primary-dark"
        >
          <Check className="h-3.5 w-3.5" /> Save Note
        </Button>
      </div>
    </div>
  );
}

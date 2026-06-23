import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { CalendarPlus, NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AudiencePicker, isAudienceComplete } from "@/components/audience-picker";
import {
  useStore,
  usePageAccess,
  audienceOf,
  EVERYONE_AUDIENCE,
  type Audience,
  type Note,
} from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
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

export const Route = createFileRoute("/notes")({
  component: NotesPage,
});

const cardContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const cardItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

const iconBtn =
  "rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-primary group-hover:opacity-100";

// Create a note: content + audience + the date it lands on.
function NewNoteDialog() {
  const saveNote = useStore((s) => s.saveNote);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [audience, setAudience] = useState<Audience>(EVERYONE_AUDIENCE);
  const [date, setDate] = useState<Date | undefined>(new Date());

  const reset = () => {
    setContent("");
    setAudience(EVERYONE_AUDIENCE);
    setDate(new Date());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return toast.error("Note can't be empty");
    if (!date) return toast.error("Pick a date for this note");
    if (!isAudienceComplete(audience))
      return toast.error("Select at least one department or person, or change who can see this");
    try {
      await saveNote(format(date, "yyyy-MM-dd"), content.trim(), undefined, audience);
      toast.success("Note created");
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create note");
    }
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
          <Plus className="h-4 w-4" /> New Note
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New note</DialogTitle>
          <DialogDescription>
            Jot something down, choose who can see it, and pick the day it belongs to.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ncontent">Note</Label>
            <Textarea
              id="ncontent"
              autoFocus
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What needs to happen?"
              className="resize-none"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label className="shrink-0">Who can see this</Label>
            <AudiencePicker value={audience} onChange={setAudience} align="end" />
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <div className="flex justify-center rounded-xl border border-border">
              <Calendar mode="single" selected={date} onSelect={setDate} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!isAudienceComplete(audience)}
              className="bg-primary text-primary-foreground hover:bg-primary-dark"
            >
              Create note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Edit a note's content + audience (the date is fixed; use "Copy to date" to
// place it on another day).
function EditNoteDialog({ note }: { note: Note }) {
  const saveNote = useStore((s) => s.saveNote);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(note.content);
  const [audience, setAudience] = useState<Audience>(audienceOf(note));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return toast.error("Note can't be empty");
    if (!isAudienceComplete(audience))
      return toast.error("Select at least one department or person, or change who can see this");
    try {
      await saveNote(note.date, content.trim(), note.id, audience);
      toast.success("Note updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update note");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setContent(note.content);
          setAudience(audienceOf(note));
        }
      }}
    >
      <DialogTrigger asChild>
        <button title="Edit note" className={iconBtn}>
          <Pencil className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit note</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <Textarea
            autoFocus
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="resize-none"
          />
          <div className="flex items-center justify-between gap-3">
            <Label className="shrink-0">Who can see this</Label>
            <AudiencePicker value={audience} onChange={setAudience} align="end" />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!isAudienceComplete(audience)}
              className="bg-primary text-primary-foreground hover:bg-primary-dark"
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Duplicate a note onto another date (same content + audience).
function CopyToDateDialog({ note }: { note: Note }) {
  const saveNote = useStore((s) => s.saveNote);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(undefined);

  const confirm = async () => {
    if (!date) return;
    try {
      await saveNote(format(date, "yyyy-MM-dd"), note.content, undefined, audienceOf(note));
      toast.success(`Note copied to ${format(date, "d MMM yyyy")}`);
      setOpen(false);
      setDate(undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not copy note");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setDate(undefined);
      }}
    >
      <DialogTrigger asChild>
        <button title="Copy to date" className={iconBtn}>
          <CalendarPlus className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy note to a date</DialogTitle>
          <DialogDescription>Creates a copy of this note on the day you pick.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center">
          <Calendar mode="single" selected={date} onSelect={setDate} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!date}
            onClick={confirm}
            className="bg-primary text-primary-foreground hover:bg-primary-dark"
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteCard({
  note,
  canEdit,
  onDelete,
}: {
  note: Note;
  canEdit: boolean;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <motion.div
      variants={cardItem}
      className="hover-lift group relative flex flex-col rounded-2xl border border-border bg-card p-5 shadow-soft"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
          <NotebookPen className="h-5 w-5" />
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <EditNoteDialog note={note} />
            <CopyToDateDialog note={note} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button title="Delete note" className={iconBtn}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete note?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes this note.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(note.id)}
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
      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {format(parseISO(note.date), "d MMM yyyy")}
      </div>
      <p className="mt-1.5 line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed">
        {note.content}
      </p>
    </motion.div>
  );
}

function NotesPage() {
  const { notes, deleteNote } = useStore();
  // Notes follow calendar access; this page lists only the user's own notes.
  const canEdit = usePageAccess("calendar") !== "none";

  const myNotes = notes
    .filter((n) => n.mine)
    .sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt),
    );

  const handleDelete = async (id: string) => {
    try {
      await deleteNote(id);
      toast.success("Note deleted");
    } catch {
      toast.error("Could not delete note");
    }
  };

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Notes</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Your own notes across every date. Choose who sees each one, and copy any note to another
            day.
          </p>
        </div>
        {canEdit && <NewNoteDialog />}
      </div>

      {myNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card py-20 text-center shadow-soft">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent text-primary">
            <NotebookPen className="h-7 w-7" />
          </div>
          <p className="mt-5 text-base font-semibold">No notes yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {canEdit
              ? "Capture a thought and pick the date it belongs to. Your notes also show up on the calendar."
              : "You don't have any notes yet."}
          </p>
          {canEdit && (
            <div className="mt-6">
              <NewNoteDialog />
            </div>
          )}
        </div>
      ) : (
        <motion.div
          variants={cardContainer}
          initial="hidden"
          animate="show"
          className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]"
        >
          {myNotes.map((n) => (
            <NoteCard key={n.id} note={n} canEdit={canEdit} onDelete={handleDelete} />
          ))}
        </motion.div>
      )}
    </AppShell>
  );
}

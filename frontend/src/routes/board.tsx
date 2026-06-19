import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import {
  CalendarPlus,
  CheckSquare,
  FileDown,
  LayoutGrid,
  Link2,
  Pencil,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { BoardEditor } from "@/components/board-editor";
import { api } from "@/lib/api";
import { downloadBoardPdf } from "@/lib/board-pdf";
import { useStore, usePageAccess, type BoardSummary } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
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

export const Route = createFileRoute("/board")({
  // The open board (and its mode) live in the URL so a refresh stays on it.
  validateSearch: (
    search: Record<string, unknown>,
  ): { board?: string; mode?: "view" | "editor" } => ({
    board: typeof search.board === "string" ? search.board : undefined,
    mode: search.mode === "editor" ? "editor" : undefined,
  }),
  component: BoardPage,
});

const cardContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const cardItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

// Module-scope (stable identity) so the Radix popover trigger isn't remounted
// on every parent render. Uncontrolled: Radix manages its own open state.
function NewBoardButton({
  onPick,
  label = "New Board",
}: {
  onPick: (date: Date | undefined, name: string) => void;
  label?: string;
}) {
  const [name, setName] = useState("");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary-dark">
          <Plus className="h-4 w-4" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="space-y-2 border-b border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">Board name</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Launch plan (optional)"
            className="h-9 w-full text-sm"
          />
        </div>
        <div className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
          Pick a date
        </div>
        <Calendar mode="single" onSelect={(d) => onPick(d, name)} autoFocus />
      </PopoverContent>
    </Popover>
  );
}

function BoardCard({
  board,
  onOpen,
  onRename,
  onCopy,
  onDelete,
  canEdit,
}: {
  board: BoardSummary;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onCopy: (id: string, date: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  canEdit: boolean;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(board.title);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState<Date | undefined>(undefined);

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = name.trim();
    if (!t) return;
    await onRename(board.id, t);
    setRenameOpen(false);
  };

  const shareLink = async () => {
    try {
      const { token } = await api.shareBoard(board.id);
      const url = `${window.location.origin}/shared/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied to clipboard");
      } catch {
        toast.message("Share link", { description: url });
      }
    } catch {
      toast.error("Could not create share link");
    }
  };

  const downloadPdf = async () => {
    try {
      const detail = await api.getBoard(board.id);
      downloadBoardPdf(detail);
    } catch {
      toast.error("Could not generate PDF");
    }
  };

  const confirmCopy = async () => {
    if (!copyDate) return;
    // Auto-named boards ("Board · 18 Jun 2026") embed the date - regenerate it
    // for the new date; keep any custom title as-is.
    const isAutoName = /^Board · \d{1,2} [A-Za-z]{3} \d{4}$/.test(board.title);
    const title = isAutoName ? `Board · ${format(copyDate, "d MMM yyyy")}` : board.title;
    await onCopy(board.id, format(copyDate, "yyyy-MM-dd"), title);
    setCopyOpen(false);
    setCopyDate(undefined);
  };

  const iconBtn =
    "rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-primary group-hover:opacity-100";

  return (
    <motion.div
      variants={cardItem}
      onClick={() => onOpen(board.id)}
      className="hover-lift group relative cursor-pointer rounded-2xl border border-border bg-card p-5 shadow-soft"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
          <LayoutGrid className="h-5 w-5" />
        </div>
        {canEdit && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button title="Share" className={iconBtn}>
                  <Share2 className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={shareLink}>
                  <Link2 className="h-4 w-4" /> Share link
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCopyOpen(true)}>
                  <CalendarPlus className="h-4 w-4" /> Copy to date
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={downloadPdf}>
                  <FileDown className="h-4 w-4" /> Download as PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Copy to date dialog */}
            <Dialog
              open={copyOpen}
              onOpenChange={(o) => {
                setCopyOpen(o);
                if (!o) setCopyDate(undefined);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Copy board to a date</DialogTitle>
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

            <Dialog
              open={renameOpen}
              onOpenChange={(o) => {
                setRenameOpen(o);
                if (o) setName(board.title);
              }}
            >
              <DialogTrigger asChild>
                <button title="Rename board" className={iconBtn}>
                  <Pencil className="h-4 w-4" />
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rename board</DialogTitle>
                </DialogHeader>
                <form onSubmit={submitRename} className="space-y-4">
                  <Input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Board name"
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

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button title="Delete board" className={iconBtn}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete board?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes “{board.title}” and all its boxes.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(board.id)}
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
        {format(parseISO(board.date), "d MMM yyyy")}
      </div>
      <div className="mt-1 truncate text-base font-bold">{board.title}</div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {board.boxCount} {board.boxCount === 1 ? "box" : "boxes"}
        </span>
        {board.openTaskCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 font-semibold text-primary">
            <CheckSquare className="h-3 w-3" /> {board.openTaskCount} open
          </span>
        )}
      </div>
    </motion.div>
  );
}

function BoardPage() {
  const navigate = useNavigate();
  const { board: selectedId, mode } = Route.useSearch();
  const { boards, createBoard, renameBoard, copyBoard, deleteBoard } = useStore();
  // Every board on this page is the member's own, so view access is enough to
  // create/rename/delete them (edit access only matters for others' boards).
  const canEdit = usePageAccess("board") !== "none";

  const openBoard = (id: string) => navigate({ to: "/board", search: { board: id } });
  const closeBoard = () => navigate({ to: "/board", search: {} });

  const handleCreate = async (date: Date | undefined, name: string) => {
    if (!date) return;
    try {
      const title = name.trim() || `Board · ${format(date, "d MMM yyyy")}`;
      const board = await createBoard(format(date, "yyyy-MM-dd"), title);
      openBoard(board.id);
      toast.success("Board created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create board");
    }
  };

  const handleRename = async (id: string, title: string) => {
    try {
      await renameBoard(id, title);
      toast.success("Board renamed");
    } catch {
      toast.error("Could not rename board");
    }
  };

  const handleCopy = async (id: string, date: string, title: string) => {
    try {
      await copyBoard(id, date, title);
      toast.success(`Board copied to ${format(parseISO(date), "d MMM yyyy")}`);
    } catch {
      toast.error("Could not copy board");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBoard(id);
      toast.success("Board deleted");
    } catch {
      toast.error("Could not delete board");
    }
  };

  if (selectedId) {
    return (
      <AppShell>
        <BoardEditor
          boardId={selectedId}
          onBack={closeBoard}
          initialMode={mode === "editor" ? "editor" : "view"}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Board</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Free-form OneNote-style boards. Create one on any date and arrange boxes however you
            think.
          </p>
        </div>
        {canEdit && <NewBoardButton onPick={handleCreate} />}
      </div>

      {boards.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card py-20 text-center shadow-soft">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent text-primary">
            <LayoutGrid className="h-7 w-7" />
          </div>
          <p className="mt-5 text-base font-semibold">No boards yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {canEdit
              ? "Boards let you sketch out a day on a free canvas. Name it and pick a date to create your first one."
              : "No boards have been shared with you yet."}
          </p>
          {canEdit && (
            <div className="mt-6">
              <NewBoardButton onPick={handleCreate} label="Create your first board" />
            </div>
          )}
        </div>
      ) : (
        <motion.div
          variants={cardContainer}
          initial="hidden"
          animate="show"
          className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,260px))]"
        >
          {boards.map((b) => (
            <BoardCard
              key={b.id}
              board={b}
              onOpen={openBoard}
              onRename={handleRename}
              onCopy={handleCopy}
              onDelete={handleDelete}
              canEdit={canEdit}
            />
          ))}
        </motion.div>
      )}
    </AppShell>
  );
}

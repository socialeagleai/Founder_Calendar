import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Eye, LayoutTemplate, Pencil, Plus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { api } from "@/lib/api";
import {
  useStore,
  usePageAccess,
  audienceOf,
  EVERYONE_AUDIENCE,
  type Audience,
  type BoardDetail,
  type Box,
  type Template,
} from "@/lib/store";
import { isBoardData, layoutBoxes, nextFreeSlot } from "@/lib/template-utils";
import { BoardCanvas, type CardHandlers } from "@/components/board-canvas";
import { AudiencePicker, isAudienceComplete } from "@/components/audience-picker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Mode = "editor" | "view";

export function BoardEditor({
  boardId,
  onBack,
  initialMode = "view",
}: {
  boardId: string;
  onBack: () => void;
  initialMode?: Mode;
}) {
  const refreshBoards = useStore((s) => s.refreshBoards);
  // Select the stable array, then filter via useMemo - filtering inside the
  // selector returns a new reference each render and triggers an infinite loop.
  const allTemplates = useStore((s) => s.templates);
  const boardTemplates = useMemo(
    () => allTemplates.filter((t): t is Template => t.kind === "board"),
    [allTemplates],
  );
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<Audience>(EVERYONE_AUDIENCE);
  const [loading, setLoading] = useState(true);
  // "edit" access can change anyone's board; "view" can only edit their own.
  const level = usePageAccess("board");
  const canEdit = level === "edit" || board?.mine === true;
  const [mode, setMode] = useState<Mode>("view");
  const readOnly = mode === "view";

  // Follow the mode supplied via the URL (e.g. "Add Board" opens in editor) -
  // but lock to view when the member can't edit this particular board.
  useEffect(() => {
    setMode(canEdit ? initialMode : "view");
  }, [initialMode, canEdit]);

  // Keep a live ref to onBack so the loader effect can use it without
  // re-running when the parent re-renders (onBack identity changes each render).
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .getBoard(boardId)
      .then((b) => {
        if (!active) return;
        setBoard(b);
        setBoxes(b.boxes);
        setTitle(b.title);
        setAudience(audienceOf(b));
      })
      .catch(() => {
        if (!active) return;
        toast.error("That board no longer exists");
        onBackRef.current();
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [boardId]);

  const update = useCallback(
    (id: string, patch: Partial<Box>) =>
      setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b))),
    [],
  );

  const persist = useCallback(
    (id: string, patch: Partial<Box>) => {
      api
        .updateBox(id, patch)
        .then(() => {
          // Toggling tasks changes a board's open-task count shown on its card.
          if ("tasks" in patch) void refreshBoards();
        })
        .catch(() => toast.error("Could not save changes"));
    },
    [refreshBoards],
  );

  const addBox = async (x?: number, y?: number) => {
    // No coords = the "Add Box" button; place it where it won't overlap.
    const pos = x === undefined || y === undefined ? nextFreeSlot(boxes) : { x, y };
    try {
      const box = await api.addBox(boardId, { x: pos.x, y: pos.y, width: 280, height: 200 });
      setBoxes((prev) => [...prev, box]);
      void refreshBoards();
    } catch {
      toast.error("Could not add box");
    }
  };

  const remove = useCallback(
    async (id: string) => {
      setBoxes((prev) => prev.filter((b) => b.id !== id));
      try {
        await api.deleteBox(id);
        void refreshBoards();
      } catch {
        toast.error("Could not delete box");
      }
    },
    [refreshBoards],
  );

  const handlers: CardHandlers = useMemo(
    () => ({ update, persist, remove }),
    [update, persist, remove],
  );

  const applyTemplate = async (tpl: Template) => {
    if (!isBoardData(tpl)) return;
    const laid = layoutBoxes(tpl.data.boxes ?? []);
    // Drop the template's boxes below anything already on the board.
    const offsetY = boxes.length ? Math.max(...boxes.map((b) => b.y + b.height)) + 24 : 0;
    try {
      const created: Box[] = [];
      for (const b of laid) {
        const box = await api.addBox(boardId, {
          title: b.title,
          content: b.content,
          tasks: b.tasks ?? [],
          x: b.x,
          y: b.y + offsetY,
          width: b.width,
          height: b.height,
          color: b.color,
        });
        created.push(box);
      }
      setBoxes((prev) => [...prev, ...created]);
      setMode("editor");
      void refreshBoards();
      toast.success(`Applied “${tpl.name}”`);
    } catch {
      toast.error("Could not apply template");
    }
  };

  const saveTitle = () => {
    const t = title.trim() || "Untitled board";
    setTitle(t);
    if (board && t !== board.title) {
      api
        .renameBoard(boardId, t)
        .then(() => {
          setBoard({ ...board, title: t });
          void refreshBoards();
        })
        .catch(() => toast.error("Could not rename board"));
    }
  };

  const changeAudience = (next: Audience) => {
    setAudience(next);
    // Don't persist a half-finished choice (e.g. "Departments" with nothing
    // ticked). The picker shows a warning until at least one is selected; we
    // save once the audience is complete.
    if (!isAudienceComplete(next)) return;
    useStore
      .getState()
      .setBoardAudience(boardId, next)
      .catch(() => toast.error("Could not update visibility"));
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Boards
        </Button>
        <div className="min-w-0 flex-1">
          <input
            value={title}
            readOnly={readOnly}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            placeholder="Board title"
            className="w-full max-w-md truncate bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/50"
          />
          {board && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {format(parseISO(board.date), "EEEE, d MMMM yyyy")} · {boxes.length}{" "}
              {boxes.length === 1 ? "box" : "boxes"}
            </p>
          )}
        </div>

        {/* Templates - drop a saved board template onto this board. */}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <LayoutTemplate className="h-4 w-4" /> Templates
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Board templates</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {boardTemplates.length === 0 ? (
                <DropdownMenuItem asChild>
                  <Link to="/templates" className="text-muted-foreground">
                    No templates yet - create one
                  </Link>
                </DropdownMenuItem>
              ) : (
                boardTemplates.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onSelect={() => void applyTemplate(t)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {isBoardData(t) ? (t.data.boxes?.length ?? 0) : 0}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Audience - who can see this board on the shared calendar. The picker
            is shown only to editors; the chosen audience isn't displayed back. */}
        {canEdit && <AudiencePicker value={audience} onChange={changeAudience} align="end" />}

        {/* View / Editor mode toggle - only when the member can edit. */}
        {canEdit && (
          <div className="inline-flex items-center rounded-lg border border-border bg-secondary/50 p-0.5 text-sm">
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

        {!readOnly && (
          <Button
            onClick={() => addBox()}
            className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary-dark"
          >
            <Plus className="h-4 w-4" /> Add Box
          </Button>
        )}
      </div>

      <BoardCanvas
        boxes={boxes}
        handlers={handlers}
        readOnly={readOnly}
        loading={loading}
        onAddBoxAt={(x, y) => void addBox(x, y)}
        canToggleTasks={canEdit}
      />
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { CheckSquare, GripVertical, Plus, Square, Trash2, X } from "lucide-react";

import type { Box, BoxTask } from "@/lib/store";
import { uid } from "@/lib/template-utils";
import { cn } from "@/lib/utils";

type ResizeDir = "left" | "right" | "bottom" | "br" | "bl";

const MIN_W = 200;
const MAX_W = 900;
const MIN_H = 120;
const BORDER = 2; // box has 1px border on each side

export interface CardHandlers {
  update: (id: string, patch: Partial<Box>) => void;
  persist: (id: string, patch: Partial<Box>) => void;
  remove: (id: string) => void;
}

// Off-screen mirror used to measure the height the body text needs at a given
// width - so we can trade width for height (and vice-versa) and never scroll.
let mirror: HTMLDivElement | null = null;
function measureContentHeight(ta: HTMLTextAreaElement, text: string, widthPx: number): number {
  if (typeof document === "undefined") return 0;
  if (!mirror) {
    mirror = document.createElement("div");
    Object.assign(mirror.style, {
      position: "absolute",
      left: "-9999px",
      top: "0",
      visibility: "hidden",
      boxSizing: "border-box",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      wordBreak: "break-word",
    } as CSSStyleDeclaration);
    document.body.appendChild(mirror);
  }
  const cs = getComputedStyle(ta);
  const m = mirror;
  m.style.width = `${widthPx}px`;
  m.style.fontFamily = cs.fontFamily;
  m.style.fontSize = cs.fontSize;
  m.style.fontWeight = cs.fontWeight;
  m.style.lineHeight = cs.lineHeight;
  m.style.letterSpacing = cs.letterSpacing;
  m.style.paddingTop = cs.paddingTop;
  m.style.paddingBottom = cs.paddingBottom;
  m.style.paddingLeft = cs.paddingLeft;
  m.style.paddingRight = cs.paddingRight;
  m.textContent = `${text || ""}\n`; // trailing line so we slightly over- (never under-) estimate
  return m.scrollHeight;
}

export function BoardBoxCard({
  box,
  h,
  readOnly,
  canToggleTasks,
}: {
  box: Box;
  h: CardHandlers;
  readOnly: boolean;
  // Ticking a task off is allowed even in view mode (when the viewer can edit
  // the board), so it's a separate flag from the full read-only state.
  canToggleTasks: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const tasksRef = useRef<HTMLDivElement>(null);
  const tasks = box.tasks ?? [];

  // Debounced autosave: persist edits ~0.6s after typing stops, and on blur /
  // unmount, so nothing is lost on refresh or navigating away.
  const pending = useRef<Partial<Box>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (Object.keys(pending.current).length) {
      h.persist(box.id, pending.current);
      pending.current = {};
    }
  }, [h, box.id]);
  const scheduleSave = useCallback(
    (patch: Partial<Box>) => {
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );
  useEffect(() => () => flush(), [flush]); // flush on unmount

  // Grow the box so the notes + checklist always fit (never scroll). The notes'
  // natural height is measured at the current width; the task list adds its own
  // rendered height. Never shrinks - manual resize stays authoritative downward.
  useLayoutEffect(() => {
    const ta = taRef.current;
    const header = headerRef.current;
    if (!ta || !header) return;
    const contentH = measureContentHeight(ta, box.content, box.width - BORDER);
    const tasksH = tasksRef.current?.offsetHeight ?? 0;
    const needed = header.offsetHeight + contentH + tasksH + BORDER;
    if (needed > box.height + 1) h.update(box.id, { height: needed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.content, box.tasks, box.width, box.id, h]);

  // ---- checklist mutations (update state + debounced autosave) ----
  const setTasks = (next: BoxTask[]) => {
    h.update(box.id, { tasks: next });
    scheduleSave({ tasks: next });
  };
  const toggleTask = (id: string) =>
    setTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const editTask = (id: string, text: string) =>
    setTasks(tasks.map((t) => (t.id === id ? { ...t, text } : t)));
  const addTask = () => setTasks([...tasks, { id: uid(), text: "", done: false }]);
  const removeTask = (id: string) => setTasks(tasks.filter((t) => t.id !== id));

  // After a resize, keep the content fully visible by adjusting the OTHER axis:
  // shrink height → widen; shrink width → grow height.
  const fitAfterResize = (dir: ResizeDir, dims: { x: number; width: number; height: number }) => {
    const ta = taRef.current;
    const header = headerRef.current;
    let { width, height } = dims;
    const { x } = dims;
    if (ta && header) {
      const headerH = header.offsetHeight;
      const needHeightFor = (w: number) =>
        headerH + measureContentHeight(ta, box.content, w - BORDER) + BORDER;

      if (dir === "bottom") {
        // Height is fixed by the user → widen until the content fits that height.
        const avail = height - headerH - BORDER;
        let w = width;
        while (w < MAX_W && measureContentHeight(ta, box.content, w - BORDER) > avail) w += 16;
        width = Math.min(MAX_W, Math.max(width, w));
        // If even max width can't fit, the height must still cover the content.
        height = Math.max(height, needHeightFor(width));
      } else {
        // Width changed (left/right/corner) → height grows to fit at that width.
        height = Math.max(height, needHeightFor(width));
      }
    }
    const patch = { x: Math.round(x), width: Math.round(width), height: Math.round(height) };
    h.update(box.id, patch);
    h.persist(box.id, patch);
  };

  const onDragStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = box.x;
    const oy = box.y;
    const at = (cx: number, cy: number) => ({
      x: Math.max(0, ox + cx - sx),
      y: Math.max(0, oy + cy - sy),
    });
    const move = (ev: PointerEvent) => h.update(box.id, at(ev.clientX, ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const p = at(ev.clientX, ev.clientY);
      h.persist(box.id, { x: Math.round(p.x), y: Math.round(p.y) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onResizeStart = (e: React.PointerEvent, dir: ResizeDir) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = box.x;
    const ow = box.width;
    const oh = box.height;
    const calc = (cx: number, cy: number) => {
      const dx = cx - sx;
      const dy = cy - sy;
      let nx = ox;
      let nw = ow;
      let nh = oh;
      if (dir === "right" || dir === "br") nw = Math.max(MIN_W, Math.min(MAX_W, ow + dx));
      if (dir === "left" || dir === "bl") {
        nw = Math.max(MIN_W, Math.min(MAX_W, ow - dx));
        nx = ox + (ow - nw);
      }
      if (dir === "bottom" || dir === "br" || dir === "bl") nh = Math.max(MIN_H, oh + dy);
      return { x: Math.round(nx), width: Math.round(nw), height: Math.round(nh) };
    };
    const move = (ev: PointerEvent) => h.update(box.id, calc(ev.clientX, ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      fitAfterResize(dir, calc(ev.clientX, ev.clientY));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
      className="group absolute flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-shadow hover:shadow-elevated"
    >
      <div
        ref={headerRef}
        onPointerDown={readOnly ? undefined : onDragStart}
        className={cn(
          "flex items-center gap-2 border-b border-border bg-secondary/40 px-2.5 py-1.5",
          !readOnly && "cursor-move",
        )}
      >
        {!readOnly && <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <input
          value={box.title}
          placeholder={readOnly ? "Untitled" : "Title"}
          readOnly={readOnly}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            h.update(box.id, { title: e.target.value });
            scheduleSave({ title: e.target.value });
          }}
          onBlur={(e) => {
            scheduleSave({ title: e.target.value });
            flush();
          }}
          className="min-w-0 flex-1 bg-transparent text-sm font-bold tracking-tight outline-none placeholder:text-muted-foreground/50"
        />
        {!readOnly && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => h.remove(box.id)}
            title="Delete box"
            className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-primary group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <textarea
        ref={taRef}
        value={box.content}
        placeholder={readOnly ? "" : "Type here…"}
        readOnly={readOnly}
        onChange={(e) => {
          h.update(box.id, { content: e.target.value });
          scheduleSave({ content: e.target.value });
        }}
        onBlur={(e) => {
          scheduleSave({ content: e.target.value, height: box.height });
          flush();
        }}
        className="w-full flex-1 resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent p-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50"
      />

      {/* Checklist - tasks with a symbol (▢ / ☑) to mark done. */}
      {(tasks.length > 0 || !readOnly) && (
        <div ref={tasksRef} className="shrink-0 border-t border-border px-2.5 py-2">
          {tasks.map((task) => (
            <div key={task.id} className="group/task flex items-center gap-2 py-0.5">
              <button
                type="button"
                disabled={!canToggleTasks}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggleTask(task.id)}
                title={task.done ? "Mark not done" : "Mark done"}
                className="shrink-0 disabled:cursor-default"
              >
                {task.done ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {readOnly ? (
                <span
                  className={cn(
                    "flex-1 text-sm leading-snug",
                    task.done && "text-muted-foreground line-through",
                  )}
                >
                  {task.text}
                </span>
              ) : (
                <input
                  value={task.text}
                  placeholder="Task"
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => editTask(task.id, e.target.value)}
                  onBlur={flush}
                  className={cn(
                    "min-w-0 flex-1 bg-transparent text-sm leading-snug outline-none placeholder:text-muted-foreground/40",
                    task.done && "text-muted-foreground line-through",
                  )}
                />
              )}
              {!readOnly && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => removeTask(task.id)}
                  title="Remove task"
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-primary group-hover/task:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={addTask}
              className="mt-1 flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-primary hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" /> Add task
            </button>
          )}
        </div>
      )}

      {/* Resize edges + corners - only in editor mode. */}
      {!readOnly && (
        <>
          <div
            onPointerDown={(e) => onResizeStart(e, "left")}
            className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize"
          />
          <div
            onPointerDown={(e) => onResizeStart(e, "right")}
            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
          />
          <div
            onPointerDown={(e) => onResizeStart(e, "bottom")}
            className="absolute inset-x-0 bottom-0 z-10 h-2 cursor-ns-resize"
          />
          <div
            onPointerDown={(e) => onResizeStart(e, "bl")}
            className="absolute bottom-0 left-0 z-20 h-3.5 w-3.5 cursor-nesw-resize"
          />
          <div
            onPointerDown={(e) => onResizeStart(e, "br")}
            className="absolute bottom-0 right-0 z-20 h-3.5 w-3.5 cursor-nwse-resize"
          />
        </>
      )}
    </div>
  );
}

/**
 * The free-form, scrollable, dotted board canvas shared by the live board
 * editor and the board-template editor. Boxes are positioned absolutely and can
 * be dragged/resized (unless readOnly). Double-clicking empty canvas adds a box.
 */
export function BoardCanvas({
  boxes,
  handlers,
  readOnly,
  loading = false,
  emptyLabel = "Your board is empty",
  onAddBoxAt,
  canToggleTasks,
}: {
  boxes: Box[];
  handlers: CardHandlers;
  readOnly: boolean;
  loading?: boolean;
  emptyLabel?: string;
  onAddBoxAt: (x: number, y: number) => void;
  // Whether task checkboxes can be ticked. Defaults to editor mode; pass `true`
  // to allow ticking even in view mode (e.g. an owner reviewing their board).
  canToggleTasks?: boolean;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const tasksToggleable = canToggleTasks ?? !readOnly;

  const onCanvasDoubleClick = (e: React.MouseEvent) => {
    if (readOnly || e.target !== canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    onAddBoxAt(
      Math.round(e.clientX - rect.left + canvasRef.current.scrollLeft),
      Math.round(e.clientY - rect.top + canvasRef.current.scrollTop),
    );
  };

  // Size the scrollable canvas around each box (plus headroom).
  const content = useMemo(() => {
    const w = Math.max(1200, ...boxes.map((b) => b.x + b.width)) + 120;
    const hh = Math.max(700, ...boxes.map((b) => b.y + b.height)) + 200;
    return { w, h: hh };
  }, [boxes]);

  return (
    <div
      ref={canvasRef}
      onDoubleClick={onCanvasDoubleClick}
      className="relative h-[calc(100vh-220px)] min-h-[560px] overflow-auto rounded-2xl border border-border bg-secondary/30 shadow-soft"
    >
      <div
        className="relative"
        style={{
          width: content.w,
          height: content.h,
          backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        {!loading && boxes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {readOnly ? (
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-primary">
                <Plus className="h-6 w-6" />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onAddBoxAt(48, 48)}
                title="Add a box"
                className="pointer-events-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent text-primary shadow-soft transition-all hover:scale-105 hover:bg-primary hover:text-primary-foreground active:scale-95"
              >
                <Plus className="h-6 w-6" />
              </button>
            )}
            <p className="mt-4 text-sm font-medium">{emptyLabel}</p>
          </div>
        )}

        {boxes.map((box) => (
          <BoardBoxCard
            key={box.id}
            box={box}
            h={handlers}
            readOnly={readOnly}
            canToggleTasks={tasksToggleable}
          />
        ))}
      </div>
    </div>
  );
}

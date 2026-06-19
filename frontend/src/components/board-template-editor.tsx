import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import { useStore, type BoardTemplateData, type Box } from "@/lib/store";
import { isBoardData, nextFreeSlot, uid } from "@/lib/template-utils";
import { BoardCanvas, type CardHandlers } from "@/components/board-canvas";
import { Button } from "@/components/ui/button";

/**
 * Full-page board-template authoring - the same free-form canvas as a real
 * board, but everything lives in local state and is saved as a template (no
 * per-box API calls). `templateId` undefined means "new".
 */
export function BoardTemplateEditor({
  templateId,
  onBack,
}: {
  templateId?: string;
  onBack: () => void;
}) {
  const { templates, createTemplate, updateTemplate } = useStore();
  const existing = templateId ? templates.find((t) => t.id === templateId) : undefined;

  const [name, setName] = useState("");
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [saving, setSaving] = useState(false);
  const seeded = useRef(false);

  // Seed once from the existing template (or blank for new).
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (existing && isBoardData(existing)) {
      setName(existing.name);
      setBoxes((existing.data.boxes ?? []).map((b) => ({ ...b, id: b.id || uid() })));
    }
  }, [existing]);

  const update = useCallback(
    (id: string, patch: Partial<Box>) =>
      setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b))),
    [],
  );
  // Templates keep everything in local state - "persist" just merges the final
  // (rounded) drag/resize values back in. Real saving happens on "Save template".
  const persist = useCallback(
    (id: string, patch: Partial<Box>) =>
      setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b))),
    [],
  );
  const remove = useCallback(
    (id: string) => setBoxes((prev) => prev.filter((b) => b.id !== id)),
    [],
  );
  const handlers: CardHandlers = useMemo(
    () => ({ update, persist, remove }),
    [update, persist, remove],
  );

  // Explicit coords come from double-clicking the canvas; without them (the
  // "Add Box" button) drop the box in the first free slot so it never overlaps.
  const addBox = (x?: number, y?: number) =>
    setBoxes((prev) => {
      const pos = x === undefined || y === undefined ? nextFreeSlot(prev) : { x, y };
      return [
        ...prev,
        {
          id: uid(),
          title: "",
          content: "",
          tasks: [],
          x: pos.x,
          y: pos.y,
          width: 280,
          height: 200,
          color: "default",
        },
      ];
    });

  const save = async () => {
    const data: BoardTemplateData = { boxes };
    const finalName = name.trim() || "Untitled board template";
    setSaving(true);
    try {
      if (existing) {
        await updateTemplate(existing.id, { name: finalName, data });
        toast.success("Template updated");
      } else {
        await createTemplate({ kind: "board", name: finalName, data });
        toast.success("Board template created");
      }
      onBack();
    } catch {
      toast.error("Could not save template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Templates
        </Button>
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            className="w-full max-w-md truncate bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/50"
          />
          <p className="mt-0.5 text-xs text-muted-foreground">
            Board template · {boxes.length} {boxes.length === 1 ? "box" : "boxes"} · double-click
            the canvas to add a box
          </p>
        </div>

        <Button variant="outline" onClick={() => addBox()} className="gap-1.5">
          + Add Box
        </Button>
        <Button
          onClick={save}
          disabled={saving}
          className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary-dark"
        >
          <Save className="h-4 w-4" /> Save template
        </Button>
      </div>

      <BoardCanvas
        boxes={boxes}
        handlers={handlers}
        readOnly={false}
        emptyLabel="Your template is empty"
        onAddBoxAt={(x, y) => addBox(x, y)}
      />
    </div>
  );
}

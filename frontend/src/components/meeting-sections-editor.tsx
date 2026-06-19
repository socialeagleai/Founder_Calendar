import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";

import type { MeetingSection, SectionType } from "@/lib/store";
import { uid } from "@/lib/template-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SECTION_TYPES: { value: SectionType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "bulleted", label: "Bulleted" },
  { value: "numbered", label: "Numbered" },
];

interface DecoratedItem {
  item: MeetingSection["items"][number];
  marker: string;
  isHeader: boolean;
}

// Mirror of the marker logic in meeting-editor/meeting-content so the editing
// preview matches how the agenda eventually renders.
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
    if (item.level === 0) {
      const isHeader = section.items[i + 1]?.level === 1;
      return { item, marker: isHeader ? "" : "•", isHeader };
    }
    return { item, marker: "•", isHeader: false };
  });
}

/**
 * Controlled editor for a meeting's structured sections. Used by the My
 * Templates page to author/edit meeting templates.
 */
export function MeetingSectionsEditor({
  sections,
  onChange,
}: {
  sections: MeetingSection[];
  onChange: (sections: MeetingSection[]) => void;
}) {
  const patchSection = (id: string, patch: Partial<MeetingSection>) =>
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addSection = () =>
    onChange([...sections, { id: uid(), title: "", type: "bulleted", body: "", items: [] }]);

  const removeSection = (id: string) => onChange(sections.filter((s) => s.id !== id));

  const addItem = (sectionId: string) =>
    onChange(
      sections.map((s) =>
        s.id === sectionId ? { ...s, items: [...s.items, { id: uid(), text: "", level: 0 }] } : s,
      ),
    );

  const patchItem = (
    sectionId: string,
    itemId: string,
    patch: Partial<{ text: string; level: number }>,
  ) =>
    onChange(
      sections.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
          : s,
      ),
    );

  const removeItem = (sectionId: string, itemId: string) =>
    onChange(
      sections.map((s) =>
        s.id === sectionId ? { ...s, items: s.items.filter((it) => it.id !== itemId) } : s,
      ),
    );

  return (
    <div className="space-y-3">
      {sections.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-secondary/30 py-8 text-center text-sm text-muted-foreground">
          Add a section to start building this template’s agenda.
        </div>
      )}

      {sections.map((section) => (
        <div key={section.id} className="rounded-xl border border-border bg-secondary/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <input
              value={section.title}
              onChange={(e) => patchSection(section.id, { title: e.target.value })}
              placeholder="Section title"
              className="min-w-0 flex-1 bg-transparent text-sm font-bold tracking-tight outline-none placeholder:text-muted-foreground/50"
            />
            <Select
              value={section.type}
              onValueChange={(v) => patchSection(section.id, { type: v as SectionType })}
            >
              <SelectTrigger className="h-8 w-[110px] text-xs">
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
              type="button"
              onClick={() => removeSection(section.id)}
              title="Delete section"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {section.type === "text" ? (
            <Textarea
              value={section.body}
              onChange={(e) => patchSection(section.id, { body: e.target.value })}
              placeholder="Type here…"
              rows={2}
              className="resize-none bg-card text-sm"
            />
          ) : (
            <div className="space-y-1.5">
              {decorate(section).map(({ item, marker, isHeader }) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2"
                  style={{ paddingLeft: item.level * 24 }}
                >
                  <button
                    type="button"
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
                  <span className="w-5 shrink-0 text-right text-sm font-medium text-muted-foreground">
                    {marker}
                  </span>
                  <input
                    value={item.text}
                    onChange={(e) => patchItem(section.id, item.id, { text: e.target.value })}
                    placeholder={isHeader ? "Sub-header…" : "List item…"}
                    className={cn(
                      "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40",
                      isHeader && "font-semibold",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(section.id, item.id)}
                    title="Remove item"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addItem(section.id)}
                className="mt-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" /> Add item
              </button>
            </div>
          )}
        </div>
      ))}

      <Button type="button" onClick={addSection} variant="outline" className="w-full gap-1.5 border-dashed">
        <Plus className="h-4 w-4" /> Add Section
      </Button>
    </div>
  );
}

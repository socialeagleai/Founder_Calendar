import type { MeetingSection } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Decorated {
  item: MeetingSection["items"][number];
  marker: string;
  isHeader: boolean;
}

// Bulleted section: a top-level item followed by indented children renders as a
// bold sub-header (no bullet); standalone top-level items get "•". Numbered
// sections number their top-level items.
function decorate(section: MeetingSection): Decorated[] {
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

/** Read-only render of a meeting's full structured content (sections + items). */
export function MeetingContent({
  sections,
  compact = false,
}: {
  sections: MeetingSection[];
  compact?: boolean;
}) {
  const text = compact ? "text-[11px]" : "text-sm";
  const indentUnit = compact ? 12 : 20;
  return (
    <div className={compact ? "space-y-2.5" : "space-y-4"}>
      {sections.map((s) => (
        <div key={s.id}>
          <div className={cn("font-bold tracking-tight", compact ? "text-xs" : "text-base")}>
            {s.title || "Untitled"}
          </div>
          {s.type === "text" ? (
            <p className={cn("mt-0.5 whitespace-pre-wrap leading-relaxed text-foreground/90", text)}>
              {s.body}
            </p>
          ) : (
            <div className={cn("mt-1", compact ? "space-y-0.5" : "space-y-1")}>
              {decorate(s).map(({ item, marker, isHeader }) => (
                <div
                  key={item.id}
                  className="flex gap-1.5"
                  style={{ paddingLeft: item.level * indentUnit }}
                >
                  <span className={cn("w-3 shrink-0 text-right text-muted-foreground", text)}>
                    {marker}
                  </span>
                  <span className={cn(text, isHeader ? "font-semibold" : "text-foreground/90")}>
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

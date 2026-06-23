import { Building2, ChevronDown, Globe, Lock, Users } from "lucide-react";
import type { ComponentType } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useStore,
  type Audience,
  type Department,
  type TeamMember,
  type Visibility,
} from "@/lib/store";
import { cn } from "@/lib/utils";

const MODES: {
  key: Visibility;
  label: string;
  icon: ComponentType<{ className?: string }>;
  desc: string;
}[] = [
  { key: "everyone", label: "Everyone", icon: Globe, desc: "Everyone in the organization" },
  {
    key: "departments",
    label: "Departments",
    icon: Building2,
    desc: "Only the chosen departments",
  },
  { key: "members", label: "Specific people", icon: Users, desc: "Only the chosen teammates" },
  { key: "private", label: "Only me", icon: Lock, desc: "Kept private to you" },
];

const ICONS: Record<Visibility, ComponentType<{ className?: string }>> = {
  everyone: Globe,
  departments: Building2,
  members: Users,
  private: Lock,
};

/**
 * Whether an audience is ready to save. "Departments"/"Specific people" require
 * at least one selection; "Everyone"/"Only me" are always complete. Consumers
 * use this to block their OK/Save button until a choice is made.
 */
export function isAudienceComplete(a: Audience): boolean {
  if (a.visibility === "departments") return (a.visibleDepartments ?? []).length > 0;
  if (a.visibility === "members") return (a.visibleMembers ?? []).length > 0;
  return true;
}

/** A short human label for an audience, e.g. "Everyone", "HR", "3 people". */
export function audienceSummary(
  a: Audience,
  departments: Department[],
  team: TeamMember[],
): string {
  if (a.visibility === "everyone") return "Everyone";
  if (a.visibility === "private") return "Only me";
  if (a.visibility === "departments") {
    const ids = a.visibleDepartments ?? [];
    if (ids.length === 0) return "Choose departments";
    if (ids.length === 1) return departments.find((d) => d.id === ids[0])?.name ?? "1 department";
    return `${ids.length} departments`;
  }
  const ids = a.visibleMembers ?? [];
  if (ids.length === 0) return "Choose people";
  if (ids.length === 1) return team.find((m) => m.id === ids[0])?.name ?? "1 person";
  return `${ids.length} people`;
}

/** The small icon that represents an audience (for calendar cards etc.). */
export function AudienceIcon({
  visibility,
  className,
}: {
  visibility: Visibility;
  className?: string;
}) {
  const Icon = ICONS[visibility] ?? Globe;
  return <Icon className={className} />;
}

export function AudiencePicker({
  value,
  onChange,
  align = "start",
  className,
}: {
  value: Audience;
  onChange: (next: Audience) => void;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const departments = useStore((s) => s.departments);
  const team = useStore((s) => s.team);

  const setMode = (v: Visibility) => {
    if (v === "departments")
      onChange({
        visibility: v,
        visibleDepartments: value.visibleDepartments ?? [],
        visibleMembers: [],
      });
    else if (v === "members")
      onChange({
        visibility: v,
        visibleMembers: value.visibleMembers ?? [],
        visibleDepartments: [],
      });
    else onChange({ visibility: v, visibleDepartments: [], visibleMembers: [] });
  };

  const toggle = (key: "visibleDepartments" | "visibleMembers", id: string, on: boolean) => {
    const current = value[key] ?? [];
    const next = on ? [...current, id] : current.filter((x) => x !== id);
    onChange({ ...value, [key]: next });
  };

  const Icon = ICONS[value.visibility] ?? Globe;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent",
            className,
          )}
        >
          <Icon className="h-3.5 w-3.5 text-primary" />
          <span className="max-w-[140px] truncate">
            {audienceSummary(value, departments, team)}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Who can see this?
          </p>
        </div>
        <div className="p-1.5">
          {MODES.map((m) => {
            const active = value.visibility === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                  active ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <m.icon
                  className={cn(
                    "mt-0.5 h-4 w-4",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="text-[11px] text-muted-foreground">{m.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {value.visibility === "departments" && (
          <div className="max-h-48 overflow-y-auto border-t border-border p-2">
            {departments.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                No departments yet. Create them on the Team page.
              </p>
            ) : (
              departments.map((d) => (
                <label
                  key={d.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent/50"
                >
                  <Checkbox
                    checked={(value.visibleDepartments ?? []).includes(d.id)}
                    onCheckedChange={(c) => toggle("visibleDepartments", d.id, c === true)}
                  />
                  <span className="truncate">{d.name}</span>
                </label>
              ))
            )}
          </div>
        )}

        {value.visibility === "members" && (
          <div className="max-h-48 overflow-y-auto border-t border-border p-2">
            {team.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">No teammates yet.</p>
            ) : (
              team.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent/50"
                >
                  <Checkbox
                    checked={(value.visibleMembers ?? []).includes(m.id)}
                    onCheckedChange={(c) => toggle("visibleMembers", m.id, c === true)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {m.name}
                    {m.role === "Owner" ? " (Owner)" : ""}
                  </span>
                </label>
              ))
            )}
          </div>
        )}

        {!isAudienceComplete(value) && (
          <div className="border-t border-border bg-destructive/5 px-3 py-2 text-[11px] font-medium text-destructive">
            {value.visibility === "departments"
              ? "Select at least one department to continue."
              : "Select at least one person to continue."}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

import { CalendarDays } from "lucide-react";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const text = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${dim} grid place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft`}>
        <CalendarDays className="h-5 w-5" strokeWidth={2.5} />
      </div>
      <div className="flex flex-col leading-none">
        <span className={`${text} font-bold tracking-tight`}>Founder Calendar</span>
        {size !== "sm" && (
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Plan · Align · Execute
          </span>
        )}
      </div>
    </div>
  );
}

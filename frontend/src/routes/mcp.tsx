import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Copy,
  Check,
  Link2,
  MessageSquare,
  ShieldCheck,
  CalendarClock,
  NotebookPen,
  LayoutGrid,
  Users,
  KeyRound,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useCurrentUser } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mcp")({
  component: McpPage,
});

// The public MCP endpoint. This is a fixed, deployed server — clients always
// connect to the hosted instance, never to a local dev build — so it's a
// constant rather than something derived from VITE_API_URL.
const MCP_URL = "https://mcp.fc.socialeagle.ai/mcp";

const rowsContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const rowItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

function McpPage() {
  const user = useCurrentUser();

  return (
    <AppShell>
      {/* Hero */}
      <div className="mb-8 flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-primary-foreground shadow-soft ring-2 ring-primary/20">
          <Sparkles className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Connect to AI</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Link Claude — or any MCP-compatible AI client — to your Founder Calendar account. Once
            connected, you can create meetings, add notes, manage boards and check your agenda just
            by asking in plain language.
          </p>
        </div>
      </div>

      {/* Endpoint URL + copy */}
      <div className="mb-8 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4 text-primary" />
          Your connection URL
        </div>
        <CopyRow value={MCP_URL} />
        <p className="mt-3 text-xs text-muted-foreground">
          Paste this into your AI client when it asks for the server or connector URL.
        </p>
      </div>

      {/* Steps */}
      <div className="mb-8 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 className="text-lg font-bold">How to connect (Claude)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Takes about a minute. You'll sign in with your Founder Calendar account — Google or email
          and password, whichever you use here.
        </p>

        <motion.ol
          variants={rowsContainer}
          initial="hidden"
          animate="show"
          className="mt-5 space-y-4"
        >
          {STEPS.map((s, i) => (
            <motion.li key={i} variants={rowItem} className="flex gap-4">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-primary">
                {i + 1}
              </div>
              <div className="pt-0.5">
                <p className="text-sm font-semibold">{s.title}</p>
                {s.detail && (
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{s.detail}</p>
                )}
              </div>
            </motion.li>
          ))}
        </motion.ol>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed">
            When the sign-in window opens, sign in as{" "}
            <span className="font-semibold">{user?.email ?? "your Founder Calendar account"}</span>{" "}
            — the same way you sign in here. If you created your account with Google, use the{" "}
            <span className="font-semibold">Sign in with Google</span> button; otherwise use your
            email and password. The AI never sees your password or your Google account; it only
            receives a token that lets it act on your behalf.
          </p>
        </div>
      </div>

      {/* What it can do */}
      <div className="mb-8 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 className="text-lg font-bold">What you can ask it to do</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          It works across your calendar, meetings, notes and boards.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="flex gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                <c.icon className="h-[18px] w-[18px]" />
              </div>
              <div>
                <p className="text-sm font-semibold">{c.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Example prompts */}
      <div className="mb-8 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-bold">Try saying</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {PROMPTS.map((p) => (
            <span
              key={p}
              className="rounded-full border border-border bg-secondary px-3.5 py-1.5 text-sm text-foreground/80"
            >
              &ldquo;{p}&rdquo;
            </span>
          ))}
        </div>
      </div>

      {/* Privacy */}
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold">It only ever sees your view</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            The connection acts as you. It can see and change exactly what you can see and change in
            the app — nothing more. Private items belonging to teammates stay private, and you can
            disconnect it any time from your AI client's connector settings.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

const STEPS: { title: string; detail?: string }[] = [
  {
    title: "Open your AI client's connector settings",
    detail: "In Claude: Settings → Connectors → Add custom connector.",
  },
  {
    title: "Paste the connection URL",
    detail: "Use the URL above. Give it a name like “Founder Calendar” if asked.",
  },
  {
    title: "Click Connect",
    detail: "A secure sign-in window opens in your browser automatically.",
  },
  {
    title: "Sign in and approve",
    detail:
      "Use “Sign in with Google” if that's how you created your account — otherwise enter your Founder Calendar email and password.",
  },
  {
    title: "Start asking",
    detail: "You're connected. Ask it about your day, or have it create a meeting for you.",
  },
];

const CAPABILITIES = [
  {
    icon: CalendarClock,
    title: "Meetings & agenda",
    desc: "Schedule recurring meetings, add attendees, and check what's coming up.",
  },
  {
    icon: NotebookPen,
    title: "Notes",
    desc: "Jot notes onto any date and pull up what you wrote.",
  },
  {
    icon: LayoutGrid,
    title: "Boards",
    desc: "Create date boards, add boxes and checklists, tick tasks off.",
  },
  {
    icon: Users,
    title: "Team lookups",
    desc: "Find teammates by name to add them as attendees (read-only).",
  },
] as const;

const PROMPTS = [
  "What's on my agenda tomorrow?",
  "Schedule a weekly standup at 10am with Priya",
  "Add a note for Friday: prep the launch deck",
  "What meetings do I have this week?",
  "Create a board for Monday with a to-do box",
];

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (insecure context / permissions); the URL is
      // still visible for manual copy, so fail quietly.
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary p-2 pl-4">
      <code className="min-w-0 flex-1 truncate font-mono text-sm">{value}</code>
      <button
        onClick={() => void copy()}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
          copied
            ? "bg-primary/10 text-primary"
            : "bg-primary text-primary-foreground hover:bg-primary-dark",
        )}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

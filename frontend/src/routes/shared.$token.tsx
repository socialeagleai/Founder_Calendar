import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Lock, LayoutGrid } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { useStore, type BoardDetail } from "@/lib/store";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/shared/$token")({
  head: () => ({ meta: [{ title: "Shared board — Founder Calendar" }] }),
  component: SharedBoardPage,
});

type LoadState = "loading" | "ok" | "forbidden" | "notfound" | "error";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md text-center">{children}</div>
    </div>
  );
}

function SharedBoardPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const status = useStore((s) => s.status);
  const currentUser = useStore((s) => s.currentUser);

  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    if (status !== "ready" || !currentUser) return;
    let active = true;
    setState("loading");
    api
      .getSharedBoard(token)
      .then((b) => {
        if (!active) return;
        setBoard(b);
        setState("ok");
      })
      .catch((e) => {
        if (!active) return;
        if (e instanceof ApiError && e.status === 403) setState("forbidden");
        else if (e instanceof ApiError && e.status === 404) setState("notfound");
        else setState("error");
      });
    return () => {
      active = false;
    };
  }, [status, currentUser, token]);

  const canvas = useMemo(() => {
    const boxes = board?.boxes ?? [];
    const w = Math.max(1200, ...boxes.map((b) => b.x + b.width)) + 120;
    const h = Math.max(700, ...boxes.map((b) => b.y + b.height)) + 200;
    return { w, h };
  }, [board]);

  // Still hydrating the session.
  if (status !== "ready") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Not signed in → ask them to create an account / sign in (then return here).
  if (!currentUser) {
    const redirect = `/shared/${token}`;
    return (
      <Centered>
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-primary mx-auto">
          <LayoutGrid className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-xl font-bold">A board was shared with you</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in or create an account to view it. You'll only have access if you're a member of the
          owner's organization.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild className="bg-primary text-primary-foreground hover:bg-primary-dark">
            <Link to="/signup" search={{ redirect }}>
              Create account
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/login" search={{ redirect }}>
              Log in
            </Link>
          </Button>
        </div>
      </Centered>
    );
  }

  if (state === "forbidden") {
    return (
      <Centered>
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-primary mx-auto">
          <Lock className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-xl font-bold">You don't have access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This board is only visible to members of the owner's organization. Ask them to add{" "}
          <span className="font-semibold">{currentUser.email}</span> to their team.
        </p>
        <Button onClick={() => navigate({ to: "/" })} variant="outline" className="mt-6">
          Go to my workspace
        </Button>
      </Centered>
    );
  }

  if (state === "notfound") {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Board not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This shared link is invalid or the board was deleted.
        </p>
        <Button onClick={() => navigate({ to: "/" })} variant="outline" className="mt-6">
          Go to my workspace
        </Button>
      </Centered>
    );
  }

  if (state === "error") {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Couldn't load the board</h1>
        <Button onClick={() => navigate({ to: "/" })} variant="outline" className="mt-6">
          Go to my workspace
        </Button>
      </Centered>
    );
  }

  if (state === "loading" || !board) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Read-only board view.
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl lg:px-8">
        <Button onClick={() => navigate({ to: "/" })} variant="outline" size="sm" className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Workspace
        </Button>
        <Logo size="sm" />
        <span className="ml-auto rounded-full bg-accent px-3 py-1 text-xs font-semibold text-primary">
          Shared · read-only
        </span>
      </header>

      <main className="px-4 py-6 lg:px-8">
        <h1 className="text-2xl font-bold tracking-tight">{board.title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {format(parseISO(board.date), "EEEE, d MMMM yyyy")} · {board.boxes.length}{" "}
          {board.boxes.length === 1 ? "box" : "boxes"}
        </p>

        <div className="mt-4 h-[calc(100vh-200px)] min-h-[520px] overflow-auto rounded-2xl border border-border bg-secondary/30 shadow-soft">
          <div
            className="relative"
            style={{
              width: canvas.w,
              height: canvas.h,
              backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          >
            {board.boxes.map((box) => (
              <div
                key={box.id}
                style={{ left: box.x, top: box.y, width: box.width, minHeight: box.height }}
                className="absolute flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft"
              >
                <div className="border-b border-border bg-secondary/40 px-3 py-1.5 text-sm font-bold tracking-tight">
                  {box.title || "Untitled"}
                </div>
                <div className="flex-1 whitespace-pre-wrap break-words p-3 text-sm leading-relaxed">
                  {box.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const { status, currentUser, organization } = useStore();

  useEffect(() => {
    if (status !== "ready") return;
    if (!currentUser) navigate({ to: "/login" });
    else if (!organization) navigate({ to: "/onboarding" });
    else navigate({ to: "/calendar" });
  }, [status, currentUser, organization, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

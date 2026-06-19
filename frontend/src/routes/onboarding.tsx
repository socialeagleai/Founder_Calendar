import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Logo } from "@/components/logo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Create Organization — Founder Calendar" }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const { status, currentUser, organization, createOrg } = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (status !== "ready") return;
    if (!currentUser) navigate({ to: "/login" });
    else if (organization) navigate({ to: "/calendar" });
  }, [status, currentUser, organization, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Organization name is required");
    try {
      await createOrg(name.trim(), description.trim());
      toast.success("Organization created");
      navigate({ to: "/calendar" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create organization");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-secondary/40 px-6 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-2xl border border-border bg-card p-8 shadow-elevated">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Create your organization</h1>
              <p className="text-sm text-muted-foreground">Your team's planning home.</p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Organization Name</Label>
              <Input
                id="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Organization Description</Label>
              <Textarea
                id="desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does your team do?"
              />
            </div>
            <Button type="submit" className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary-dark">
              Create Organization
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

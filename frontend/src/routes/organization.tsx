import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useStore, usePageAccess } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format, parseISO } from "date-fns";
import { Building2, Calendar, Users, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/organization")({
  head: () => ({ meta: [{ title: "Organization — Founder Calendar" }] }),
  component: OrgPage,
});

function OrgPage() {
  const navigate = useNavigate();
  const { organization, team, updateOrg, deleteOrg } = useStore();
  const canEdit = usePageAccess("organization") === "edit";
  const isOwner = useStore((s) => s.access?.isOwner ?? true);
  const [name, setName] = useState(organization?.name ?? "");
  const [desc, setDesc] = useState(organization?.description ?? "");

  // Org loads asynchronously after mount — sync the form once it arrives.
  useEffect(() => {
    if (organization) {
      setName(organization.name);
      setDesc(organization.description);
    }
  }, [organization]);

  if (!organization) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateOrg(name.trim(), desc.trim());
      toast.success("Organization updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Organization</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Manage your workspace identity and details.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient text-primary-foreground shadow-soft ring-2 ring-primary/20">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold">{organization.name}</h2>
                <p className="text-xs text-muted-foreground">
                  Created {format(parseISO(organization.createdAt), "d MMMM yyyy")}
                </p>
              </div>
            </div>

            <form onSubmit={save} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="orgname">Organization Name</Label>
                <Input
                  id="orgname"
                  value={name}
                  readOnly={!canEdit}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgdesc">Description</Label>
                <Textarea
                  id="orgdesc"
                  rows={4}
                  value={desc}
                  readOnly={!canEdit}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
              {canEdit && (
                <div className="flex justify-end gap-2">
                  <Button
                    type="submit"
                    className="bg-primary text-primary-foreground hover:bg-primary-dark"
                  >
                    Save Changes
                  </Button>
                </div>
              )}
            </form>
          </div>

          {isOwner && (
            <div className="rounded-2xl border border-destructive/20 bg-card p-6 shadow-soft">
              <h3 className="text-sm font-bold uppercase tracking-widest text-primary">
                Danger Zone
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Deleting your organization will remove all notes, plans, and members. This action
                cannot be undone.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="mt-4 border-destructive/30 text-primary hover:bg-destructive/5 hover:text-primary"
                  >
                    <Trash2 className="h-4 w-4" /> Delete Organization
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete organization?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes {organization.name}, all notes, and team data.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        try {
                          await deleteOrg();
                          toast.success("Organization deleted");
                          navigate({ to: "/onboarding" });
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Delete failed");
                        }
                      }}
                      className="bg-primary text-primary-foreground hover:bg-primary-dark"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <MetaCard icon={Users} label="Members" value={team.length} />
          <MetaCard
            icon={Calendar}
            label="Created"
            value={format(parseISO(organization.createdAt), "d MMM yyyy")}
          />
          <div className="hover-lift rounded-2xl border border-border bg-card p-5 shadow-soft">
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              About
            </h4>
            <p className="mt-2 text-sm leading-relaxed">
              {organization.description || "No description yet."}
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function MetaCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
}) {
  return (
    <div className="hover-lift flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-lg font-bold">{value}</p>
      </div>
    </div>
  );
}

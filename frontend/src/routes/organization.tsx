import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useStore, usePageAccess } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { Building2, Calendar, Users, Trash2, Check, Plus, LogOut } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/organization")({
  component: OrgPage,
});

function OrgPage() {
  const navigate = useNavigate();
  const { organization, team, updateOrg, deleteOrg, leaveOrg } = useStore();
  const currentUser = useStore((s) => s.currentUser);
  const canEdit = usePageAccess("organization") === "edit";
  const isOwner = useStore((s) => s.access?.isOwner ?? true);
  const [name, setName] = useState(organization?.name ?? "");
  const [desc, setDesc] = useState(organization?.description ?? "");
  const [leaveRequested, setLeaveRequested] = useState(false);

  // Whether this member already has a pending leave request in this org.
  const myMembership = team.find((m) => m.email === currentUser?.email);
  const pendingLeave = leaveRequested || myMembership?.status === "LeaveRequested";

  const handleLeave = async () => {
    try {
      await leaveOrg();
      setLeaveRequested(true);
      toast.success("Leave request sent to the owner");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send leave request");
    }
  };

  // Org loads asynchronously after mount - sync the form once it arrives.
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
                          // Land on the dashboard; the app shell sends the user
                          // to onboarding only if no organizations remain.
                          navigate({ to: "/dashboard" });
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

          {/* Members (non-owners) can request to leave the organization. */}
          {!isOwner && (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                Membership
              </h3>
              {pendingLeave ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Your request to leave <span className="font-medium">{organization.name}</span> is
                  pending the owner's approval.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Leaving sends a request to the organization owner. You'll be removed once they
                    approve it.
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="mt-4">
                        <LogOut className="h-4 w-4" /> Leave Company
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Leave {organization.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This sends a request to the owner. Once they approve it, you'll lose
                          access to this organization.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleLeave}
                          className="bg-primary text-primary-foreground hover:bg-primary-dark"
                        >
                          Send leave request
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <OrganizationsPanel />
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

/** Lists every org the user belongs to, lets them switch, and create a new one. */
function OrganizationsPanel() {
  const myOrgs = useStore((s) => s.myOrgs);
  const organization = useStore((s) => s.organization);
  const switchOrg = useStore((s) => s.switchOrg);

  const pick = async (id: string) => {
    if (id === organization?.id) return;
    try {
      await switchOrg(id);
      toast.success("Switched organization");
    } catch {
      toast.error("Could not switch organization");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Your Organizations
        </h4>
        <NewOrgDialog />
      </div>
      <div className="space-y-1.5">
        {myOrgs.map((o) => {
          const active = o.id === organization?.id;
          return (
            <button
              key={o.id}
              onClick={() => void pick(o.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
                active ? "border-primary/30 bg-accent" : "border-transparent hover:bg-accent/50",
              )}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-xs font-bold text-primary">
                {o.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{o.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {o.isOwner ? "Owner" : o.role}
                </div>
              </div>
              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NewOrgDialog() {
  const createOrg = useStore((s) => s.createOrg);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createOrg(name.trim(), desc.trim());
      toast.success(`Created ${name.trim()}`);
      setOpen(false);
      setName("");
      setDesc("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create organization");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            You'll own this organization and switch to it right away.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="neworgname">Name</Label>
            <Input
              id="neworgname"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Inc."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="neworgdesc">Description</Label>
            <Textarea
              id="neworgdesc"
              rows={3}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary-dark"
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

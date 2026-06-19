import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { AppShell } from "@/components/app-shell";
import {
  useStore,
  usePageAccess,
  type PageAccess,
  type Permissions,
  type Role,
  type TeamMember,
} from "@/lib/store";
import { ASSIGNABLE_PAGES } from "@/lib/pages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/team")({
  component: TeamPage,
});

const rowsContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const rowItem = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

// Per-page access editor: a checkbox to grant access to each page, plus a
// view/edit selector for the granted ones. Shared by the invite + edit dialogs.
function PageAccessGrid({
  value,
  onChange,
}: {
  value: Permissions;
  onChange: (next: Permissions) => void;
}) {
  const toggle = (key: string, on: boolean) => {
    const next = { ...value };
    if (on) next[key] = next[key] ?? "view";
    else delete next[key];
    onChange(next);
  };
  const setLevel = (key: string, level: PageAccess) => onChange({ ...value, [key]: level });

  return (
    <div className="space-y-2">
      <Label>Page access</Label>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {ASSIGNABLE_PAGES.map((p) => {
          const granted = p.key in value;
          return (
            <div key={p.key} className="flex items-center gap-3 px-3 py-2.5">
              <Checkbox
                id={`pa-${p.key}`}
                checked={granted}
                onCheckedChange={(c) => toggle(p.key, c === true)}
              />
              <label htmlFor={`pa-${p.key}`} className="flex-1 cursor-pointer text-sm font-medium">
                {p.label}
              </label>
              <Select
                value={granted ? value[p.key] : "view"}
                onValueChange={(v) => setLevel(p.key, v as PageAccess)}
                disabled={!granted}
              >
                <SelectTrigger className="h-8 w-[100px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">View</SelectItem>
                  <SelectItem value="edit">Edit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Unticked pages are hidden for this member. “View” is read-only; “Edit” allows changes.
        Organization &amp; Settings are always available to everyone.
      </p>
    </div>
  );
}

function InviteDialog() {
  const inviteMember = useStore((s) => s.inviteMember);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Member");
  const [perms, setPerms] = useState<Permissions>({});

  const reset = () => {
    setName("");
    setEmail("");
    setRole("Member");
    setPerms({});
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return toast.error("Name and email required");
    try {
      await inviteMember(name.trim(), email.trim(), role, perms);
      toast.success(`Invited ${name}`);
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not invite member");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="bg-primary text-primary-foreground hover:bg-primary-dark">
          <UserPlus className="h-4 w-4" /> Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            Pick exactly which pages they can open and whether they can view or edit each. When they
            sign in with this email, they’ll see only what you grant.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="mname">Name</Label>
              <Input id="mname" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memail">Email</Label>
              <Input
                id="memail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Admin">Admin</SelectItem>
                <SelectItem value="Member">Member</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <PageAccessGrid value={perms} onChange={setPerms} />
          <DialogFooter>
            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary-dark"
            >
              Send Invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAccessDialog({ member }: { member: TeamMember }) {
  const updateMemberPermissions = useStore((s) => s.updateMemberPermissions);
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<Permissions>(member.permissions ?? {});

  const save = async () => {
    try {
      await updateMemberPermissions(member.id, perms);
      toast.success("Access updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update access");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setPerms(member.permissions ?? {});
      }}
    >
      <DialogTrigger asChild>
        <button
          title="Edit page access"
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-primary"
        >
          <ShieldCheck className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Page access - {member.name}</DialogTitle>
          <DialogDescription>Control which pages {member.name} can open.</DialogDescription>
        </DialogHeader>
        <PageAccessGrid value={perms} onChange={setPerms} />
        <DialogFooter>
          <Button
            onClick={save}
            className="bg-primary text-primary-foreground hover:bg-primary-dark"
          >
            Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamPage() {
  const { team, updateMemberRole, removeMember } = useStore();
  const canEdit = usePageAccess("team") === "edit";

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Invite teammates and control which pages each can access.
          </p>
        </div>
        {canEdit && <InviteDialog />}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full">
          <thead className="bg-secondary/60">
            <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              <th className="px-6 py-3.5">Member</th>
              <th className="px-6 py-3.5">Role</th>
              <th className="px-6 py-3.5">Access</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <motion.tbody variants={rowsContainer} initial="hidden" animate="show">
            {team.map((m, i) => {
              const pageCount = Object.keys(m.permissions ?? {}).length;
              return (
                <motion.tr
                  key={m.id}
                  variants={rowItem}
                  className={`text-sm transition-colors hover:bg-accent/30 ${i !== team.length - 1 ? "border-b border-border" : ""}`}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-sm font-semibold text-primary-foreground shadow-soft ring-2 ring-primary/15">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{m.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {m.role === "Owner" || !canEdit ? (
                      <Badge variant="outline" className="border-primary/30 bg-accent text-primary">
                        {m.role}
                      </Badge>
                    ) : (
                      <Select
                        value={m.role}
                        onValueChange={(v) => {
                          void updateMemberRole(m.id, v as Role).catch((err) =>
                            toast.error(
                              err instanceof Error ? err.message : "Could not update role",
                            ),
                          );
                        }}
                      >
                        <SelectTrigger className="h-8 w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Admin">Admin</SelectItem>
                          <SelectItem value="Member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {m.role === "Owner" ? (
                      <span className="text-xs text-muted-foreground">All pages</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {pageCount} {pageCount === 1 ? "page" : "pages"}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <Badge
                      variant="outline"
                      className={
                        m.status === "Active"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : m.status === "LeaveRequested"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                      }
                    >
                      {m.status === "LeaveRequested" ? "Leaving" : m.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    {m.role !== "Owner" && canEdit && (
                      <div className="flex items-center justify-end gap-1">
                        <EditAccessDialog member={m} />
                        <button
                          onClick={async () => {
                            try {
                              await removeMember(m.id);
                              toast.success("Member removed");
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "Could not remove member",
                              );
                            }
                          }}
                          title="Remove member"
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-primary"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </motion.tr>
              );
            })}
          </motion.tbody>
        </table>
      </div>
    </AppShell>
  );
}

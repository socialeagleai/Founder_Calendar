import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { AppShell } from "@/components/app-shell";
import {
  useStore,
  usePageAccess,
  type Department,
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
import { Building2, Plus, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// Sentinel used by the department <Select> for "no department" (shadcn Select
// items cannot hold an empty-string value).
const NO_DEPT = "__none__";

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
  const departments = useStore((s) => s.departments);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Member");
  const [dept, setDept] = useState<string>(NO_DEPT);
  const [perms, setPerms] = useState<Permissions>({});

  const reset = () => {
    setName("");
    setEmail("");
    setRole("Member");
    setDept(NO_DEPT);
    setPerms({});
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return toast.error("Name and email required");
    try {
      await inviteMember(
        name.trim(),
        email.trim(),
        role,
        perms,
        dept === NO_DEPT ? null : dept,
      );
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
          <div className="grid grid-cols-2 gap-3">
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
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPT}>Unassigned</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

// Owner/admin tool to create and remove departments (HR, Operations, ...). The
// list feeds the department selectors used when inviting or editing members.
function DepartmentsCard() {
  const departments = useStore((s) => s.departments);
  const team = useStore((s) => s.team);
  const createDepartment = useStore((s) => s.createDepartment);
  const deleteDepartment = useStore((s) => s.deleteDepartment);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await createDepartment(trimmed);
      setName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add department");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: Department) => {
    const count = team.filter((m) => m.departmentId === d.id).length;
    if (count > 0 && !confirm(`Delete "${d.name}"? ${count} member${count === 1 ? "" : "s"} will become unassigned.`))
      return;
    try {
      await deleteDepartment(d.id);
      toast.success(`Removed ${d.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove department");
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="mb-3 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          Departments
        </h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Create groups like HR or Operations, then assign each teammate to one when you invite them.
      </p>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New department name"
          className="max-w-xs"
        />
        <Button
          type="submit"
          disabled={saving || !name.trim()}
          className="bg-primary text-primary-foreground hover:bg-primary-dark"
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>
      {departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No departments yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {departments.map((d) => {
            const count = team.filter((m) => m.departmentId === d.id).length;
            return (
              <span
                key={d.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-1 pl-3 pr-1.5 text-sm font-medium"
              >
                {d.name}
                <span className="text-xs text-muted-foreground">({count})</span>
                <button
                  onClick={() => remove(d)}
                  title={`Delete ${d.name}`}
                  className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The department cell in the member table: an inline selector for editors, or a
// plain label for view-only members.
function DepartmentCell({ member, canEdit }: { member: TeamMember; canEdit: boolean }) {
  const departments = useStore((s) => s.departments);
  const updateMemberDepartment = useStore((s) => s.updateMemberDepartment);
  const current = departments.find((d) => d.id === member.departmentId);

  if (member.role === "Owner") return <span className="text-xs text-muted-foreground">-</span>;
  if (!canEdit)
    return (
      <span className="text-xs text-muted-foreground">{current ? current.name : "Unassigned"}</span>
    );

  return (
    <Select
      value={member.departmentId ?? NO_DEPT}
      onValueChange={(v) => {
        void updateMemberDepartment(member.id, v === NO_DEPT ? null : v).catch((err) =>
          toast.error(err instanceof Error ? err.message : "Could not update department"),
        );
      }}
    >
      <SelectTrigger className="h-8 w-[150px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_DEPT}>Unassigned</SelectItem>
        {departments.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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

      {canEdit && <DepartmentsCard />}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full">
          <thead className="bg-secondary/60">
            <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              <th className="px-6 py-3.5">Member</th>
              <th className="px-6 py-3.5">Role</th>
              <th className="px-6 py-3.5">Department</th>
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
                    <DepartmentCell member={m} canEdit={canEdit} />
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

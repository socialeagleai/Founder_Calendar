import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useStore, useCurrentUser, usePageAccess } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Founder Calendar" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const user = useCurrentUser();
  const { organization, updateOrg, updateProfile } = useStore();
  const canEditOrg = usePageAccess("organization") === "edit";

  const [pName, setPName] = useState(user?.name ?? "");
  const [pEmail, setPEmail] = useState(user?.email ?? "");
  const [pPass, setPPass] = useState("");

  const [oName, setOName] = useState(organization?.name ?? "");
  const [oDesc, setODesc] = useState(organization?.description ?? "");

  // Profile and org data hydrate asynchronously — sync the forms when they load.
  useEffect(() => {
    if (user) {
      setPName(user.name);
      setPEmail(user.email);
    }
  }, [user]);

  useEffect(() => {
    if (organization) {
      setOName(organization.name);
      setODesc(organization.description);
    }
  }, [organization]);

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Manage your profile, organization, and preferences.
        </p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="bg-secondary">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <Card title="Profile Settings" desc="Update your personal information.">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await updateProfile(pName, pEmail, pPass || undefined);
                  setPPass("");
                  toast.success("Profile updated");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Update failed");
                }
              }}
              className="space-y-5"
            >
              <Field label="Name">
                <Input value={pName} onChange={(e) => setPName(e.target.value)} />
              </Field>
              <Field label="Email">
                <Input type="email" value={pEmail} onChange={(e) => setPEmail(e.target.value)} />
              </Field>
              <Field label="New Password">
                <Input
                  type="password"
                  value={pPass}
                  onChange={(e) => setPPass(e.target.value)}
                  placeholder="Leave blank to keep current"
                />
              </Field>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  className="bg-primary text-primary-foreground hover:bg-primary-dark"
                >
                  Save Changes
                </Button>
              </div>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="organization" className="mt-6">
          <Card title="Organization Settings" desc="Manage your workspace details.">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await updateOrg(oName, oDesc);
                  toast.success("Organization updated");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Update failed");
                }
              }}
              className="space-y-5"
            >
              <Field label="Organization Name">
                <Input
                  value={oName}
                  readOnly={!canEditOrg}
                  onChange={(e) => setOName(e.target.value)}
                />
              </Field>
              <Field label="Description">
                <Textarea
                  rows={4}
                  value={oDesc}
                  readOnly={!canEditOrg}
                  onChange={(e) => setODesc(e.target.value)}
                />
              </Field>
              {canEditOrg && (
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    className="bg-primary text-primary-foreground hover:bg-primary-dark"
                  >
                    Update Organization
                  </Button>
                </div>
              )}
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="preferences" className="mt-6 space-y-4">
          <Card title="Notifications" desc="Choose what you want to be notified about.">
            <PrefRow label="Email notifications" desc="Get updates about your team and plans." />
            <PrefRow label="Weekly digest" desc="A summary of your upcoming week, every Monday." />
            <PrefRow label="Mentions" desc="When teammates mention you on a plan." defaultOn />
          </Card>
          <Card title="Theme" desc="Customize the appearance of your workspace.">
            <DarkModeRow />
            <PrefRow label="Reduce motion" desc="Minimize animations across the app." />
            <PrefRow label="Compact density" desc="Reduce spacing for power users." />
          </Card>
          <Card title="Calendar Preferences" desc="Tune your monthly planning surface.">
            <PrefRow label="Start week on Monday" desc="Switch the calendar week start." />
            <PrefRow
              label="Show note count badges"
              desc="Display number of notes on each date."
              defaultOn
            />
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function Card({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft transition-shadow hover:shadow-elevated">
      <div className="mb-5 border-b border-border pb-5">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function DarkModeRow() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Dark mode</p>
        <p className="text-xs text-muted-foreground">Switch between light and dark appearance.</p>
      </div>
      <Switch checked={theme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
    </div>
  );
}

function PrefRow({ label, desc, defaultOn }: { label: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(!!defaultOn);
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-0 last:pb-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={on} onCheckedChange={setOn} />
    </div>
  );
}

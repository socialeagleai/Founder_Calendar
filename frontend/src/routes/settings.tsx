import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStore, useCurrentUser, type NotificationPrefs } from "@/lib/store";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const user = useCurrentUser();
  const { updateProfile } = useStore();

  const [pName, setPName] = useState(user?.name ?? "");
  const [pEmail, setPEmail] = useState(user?.email ?? "");
  const [pPass, setPPass] = useState("");

  // Profile data hydrates asynchronously - sync the form when it loads.
  useEffect(() => {
    if (user) {
      setPName(user.name);
      setPEmail(user.email);
    }
  }, [user]);

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Manage your profile and preferences.</p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="bg-secondary">
          <TabsTrigger value="profile">Profile</TabsTrigger>
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

        <TabsContent value="preferences" className="mt-6 space-y-4">
          <NotificationSettings />
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

function NotificationSettings() {
  const prefs = useStore((s) => s.prefs);
  const refreshPrefs = useStore((s) => s.refreshPrefs);
  const updatePrefs = useStore((s) => s.updatePrefs);
  const [zones, setZones] = useState<string[]>([]);

  useEffect(() => {
    void refreshPrefs().catch(() => toast.error("Could not load notification settings"));
  }, [refreshPrefs]);

  // Intl.supportedValuesOf isn't available during SSR (and not in every engine),
  // so resolve the timezone list in an effect rather than during render.
  useEffect(() => {
    try {
      setZones(Intl.supportedValuesOf("timeZone") as string[]);
    } catch {
      setZones([]);
    }
  }, []);

  const save = (patch: Partial<NotificationPrefs>) =>
    void updatePrefs(patch).catch(() => toast.error("Could not save that setting"));

  if (!prefs) {
    return (
      <Card title="Notifications" desc="Choose what you want to be notified about.">
        <p className="py-4 text-sm text-muted-foreground">Loading your settings...</p>
      </Card>
    );
  }

  // If the browser reports a zone we don't have in the list, still show it as
  // selected rather than render an empty box.
  const zoneOptions = zones.includes(prefs.timezone) ? zones : [prefs.timezone, ...zones];

  return (
    <>
      <Card title="Notifications" desc="Choose what you want to be notified about.">
        <PrefRow
          label="Shared with me"
          desc="When someone adds a note, board or meeting you can see."
          checked={prefs.sharedWithMe}
          onChange={(v) => save({ sharedWithMe: v })}
        />
        <PrefRow
          label="Activity on my items"
          desc="When someone edits a board or meeting you created."
          checked={prefs.activity}
          onChange={(v) => save({ activity: v })}
        />
        <PrefRow
          label="Mentions"
          desc="When teammates mention your @handle on a plan."
          checked={prefs.mentions}
          onChange={(v) => save({ mentions: v })}
        />
        <PrefRow
          label="Daily agenda"
          desc="A morning summary of what's on your plate today."
          checked={prefs.dailyAgenda}
          onChange={(v) => save({ dailyAgenda: v })}
        />
        {prefs.dailyAgenda && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Send at</Label>
              <Select
                value={String(prefs.digestHour)}
                onValueChange={(v) => save({ digestHour: Number(v) })}
              >
                <SelectTrigger className="h-9 w-[104px] font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-2">
              <Label className="text-xs text-muted-foreground">Timezone</Label>
              <Select value={prefs.timezone} onValueChange={(v) => save({ timezone: v })}>
                <SelectTrigger className="h-9 w-[220px] font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {zoneOptions.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </Card>

      <Card title="Email" desc="The bell always works - this is about your inbox.">
        <PrefRow
          label="Email notifications"
          desc="Send the things above to your email too."
          checked={prefs.emailEnabled}
          onChange={(v) => save({ emailEnabled: v })}
        />
      </Card>
    </>
  );
}

function PrefRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-0 last:pb-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { GoogleButton, GOOGLE_SIGNIN_ENABLED } from "@/components/google-button";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const { login } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const goAfterAuth = () => {
    if (redirect) window.location.href = redirect;
    else navigate({ to: "/" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await login(email, password);
    if (!r.ok) return toast.error(r.error);
    toast.success("Welcome back");
    goAfterAuth();
  };

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your founder workspace.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="founder@company.com"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button
          type="submit"
          className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary-dark"
        >
          Login
        </Button>
      </form>

      {GOOGLE_SIGNIN_ENABLED && (
        <>
          <Divider />
          <GoogleButton text="signin_with" redirectTo={redirect} />
        </>
      )}

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link
          to="/signup"
          search={redirect ? { redirect } : undefined}
          className="font-semibold text-primary hover:underline"
        >
          Sign up
        </Link>
      </p>
    </AuthLayout>
  );
}

function LogoBadge({ className = "" }: { className?: string }) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-2xl bg-white p-3 shadow-elevated ring-1 ring-black/5 ${className}`}
    >
      <img
        src="/social-eagle-logo.png"
        alt="Social Eagle - learn. build. operate"
        className="h-full w-full object-contain"
      />
    </div>
  );
}

const features = [
  "Monthly calendar with smart note indicators",
  "Organization & team collaboration",
  "Premium, distraction-free workspace",
];

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-stat-gradient lg:flex lg:flex-col lg:justify-center lg:py-14 lg:pl-20 lg:pr-12 lg:text-primary-foreground">
        {/* decorative glows */}
        <div className="pointer-events-none absolute -left-20 -top-20 h-80 w-80 rounded-full bg-white/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-96 w-96 rounded-full bg-black/25 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:36px_36px]" />

        {/* Logo + content grouped and vertically centered on the left */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative max-w-md"
        >
          <LogoBadge className="h-[120px] w-[120px]" />
          <h2 className="mt-12 text-4xl font-bold leading-tight tracking-tight">
            Plan. Align. Execute.
          </h2>
          <p className="mt-4 text-base text-primary-foreground/85">
            The monthly planning workspace built for founders, teams, and operators who ship.
          </p>
          <div className="mt-10 space-y-3.5 text-sm text-primary-foreground/95">
            {features.map((f) => (
              <div key={f} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-primary-foreground/90" />
                {f}
              </div>
            ))}
          </div>
        </motion.div>

        <div className="absolute bottom-10 left-20 text-xs text-primary-foreground/70">
          © {new Date().getFullYear()} Social Eagle - learn. build. operate
        </div>
      </div>

      {/* Form panel */}
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-sm"
        >
          <div className="mb-8 flex justify-center lg:hidden">
            <LogoBadge className="h-24 w-24" />
          </div>
          {children}
        </motion.div>
      </div>
    </div>
  );
}

export function Divider() {
  return (
    <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      or
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

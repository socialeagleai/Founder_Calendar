import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "./login";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      {sent ? (
        <div className="text-center">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-primary">
            <MailCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            If an account exists for <span className="font-medium">{email}</span>, we've sent a link
            to reset your password. The link expires in 60 minutes.
          </p>
          <Link
            to="/login"
            className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to login
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold">Forgot your password?</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Enter your email and we'll send you a link to reset it.
            </p>
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
            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary-dark"
            >
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Remembered it?{" "}
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Back to login
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}

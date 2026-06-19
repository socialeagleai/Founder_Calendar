import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const GSI_SRC = "https://accounts.google.com/gsi/client";

/**
 * Whether to render the real "Sign in with Google" button. Requires BOTH a
 * client ID and the explicit `VITE_GOOGLE_SIGNIN=true` opt-in — otherwise the
 * Google Identity Services button is hidden so it can't spam the console with
 * "origin not allowed" errors before the OAuth client is configured. Once you've
 * added your origin to the OAuth client's Authorized JavaScript origins, set
 * VITE_GOOGLE_SIGNIN=true in frontend/.env and restart the dev server.
 */
export const GOOGLE_SIGNIN_ENABLED = !!CLIENT_ID && import.meta.env.VITE_GOOGLE_SIGNIN === "true";

// Minimal typing for the Google Identity Services global.
interface GsiCredentialResponse {
  credential: string;
}
interface GsiIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GsiCredentialResponse) => void;
    auto_select?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "small" | "medium" | "large";
      type?: "standard" | "icon";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      shape?: "rectangular" | "pill" | "circle" | "square";
      logo_alignment?: "left" | "center";
      width?: number;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GsiIdApi } };
  }
}

function loadGsi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gsi load failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gsi load failed"));
    document.head.appendChild(script);
  });
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/**
 * "Sign in with Google" button.
 *
 * When VITE_GOOGLE_CLIENT_ID is set, renders the official Google Identity
 * Services button, obtains an ID token (credential), and passes it to the
 * backend for verification. Without a client ID it falls back to the demo
 * Google login so local dev still works.
 */
export function GoogleButton({
  text = "continue_with",
  redirectTo,
}: {
  text?: "continue_with" | "signin_with" | "signup_with";
  redirectTo?: string;
}) {
  const navigate = useNavigate();
  const loginWithGoogle = useStore((s) => s.loginWithGoogle);
  const containerRef = useRef<HTMLDivElement>(null);

  const goAfterAuth = () => {
    if (redirectTo) window.location.href = redirectTo;
    else navigate({ to: "/" });
  };

  useEffect(() => {
    if (!GOOGLE_SIGNIN_ENABLED || !CLIENT_ID) return;
    let cancelled = false;

    loadGsi()
      .then(() => {
        const el = containerRef.current;
        if (cancelled || !el || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async (response) => {
            const r = await loginWithGoogle(response.credential);
            if (!r.ok) return toast.error(r.error);
            goAfterAuth();
          },
        });

        // Clear first to avoid a duplicate button under React StrictMode.
        el.innerHTML = "";
        const width = Math.min(400, Math.max(200, el.offsetWidth || 360));
        window.google.accounts.id.renderButton(el, {
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          logo_alignment: "center",
          width,
        });
      })
      .catch(() => toast.error("Could not load Google sign-in"));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginWithGoogle, navigate, text, redirectTo]);

  // Fallback: demo Google login when no client ID is configured.
  if (!CLIENT_ID) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full"
        onClick={async () => {
          const r = await loginWithGoogle();
          if (!r.ok) return toast.error(r.error);
          goAfterAuth();
        }}
      >
        <GoogleGlyph /> Continue with Google
      </Button>
    );
  }

  return <div ref={containerRef} className="flex w-full justify-center" />;
}

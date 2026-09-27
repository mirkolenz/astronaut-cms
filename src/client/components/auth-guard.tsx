import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import config from "virtual:astronaut-cms/config";
import { useAuthStore } from "@client/stores/auth-store";
import { isExpired } from "@client/lib/oauth/session";
import {
  getDeviceLogin,
  getRedirectLogin,
  type DeviceLogin,
  type RedirectLogin,
} from "@client/lib/oauth";
import { takePendingCallback } from "@client/lib/oauth/redirect-flow";
import { Button } from "@client/components/ui/button";
import { Alert, AlertDescription } from "@client/components/ui/alert";

// Static for the lifetime of the bundle: which login the configured backend uses
// is decided at build time.
const redirectLogin = getRedirectLogin();
const deviceLogin = getDeviceLogin();

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);

  // Sign out when the access token lapses so a stale token doesn't linger in
  // an open tab (otherwise every action would just fail with a 401).
  useEffect(() => {
    if (session?.expiresAt == null) return;

    const delay = session.expiresAt - Date.now();
    if (delay <= 0) {
      clearSession();
      return;
    }

    const timer = setTimeout(clearSession, delay);

    return () => clearTimeout(timer);
  }, [session, clearSession]);

  useEffect(() => {
    const callback = redirectLogin && takePendingCallback();

    if (!callback) return;

    if (callback.error) {
      setOauthError(callback.error);
      return;
    }

    // Not cleared on success: the valid session takes over the render below, so
    // the pending flag is never read again.
    setOauthPending(true);
    redirectLogin.complete(callback.url).then(setSession, (err: unknown) => {
      setOauthError(err instanceof Error ? err.message : "Authentication failed");
      setOauthPending(false);
    });
  }, [setSession]);

  const hasValidSession = session != null && !isExpired(session);

  if (config.storageType === "local" || hasValidSession) {
    return children;
  }

  if (oauthPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">{t(($) => $.auth.completingAuth)}</p>
      </div>
    );
  }

  if (redirectLogin) {
    return <RedirectLoginForm login={redirectLogin} error={oauthError} onError={setOauthError} />;
  }

  if (deviceLogin) {
    return <GitHubDeviceLogin login={deviceLogin} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">
        {t(($) => $.auth.unsupportedStorage, { type: config.storageType })}
      </p>
    </div>
  );
}

function GitHubDeviceLogin({ login }: { login: DeviceLogin }) {
  const { t } = useTranslation();
  const setSession = useAuthStore((s) => s.setSession);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const startLogin = useCallback(async () => {
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const prompt = await login.start();
      setUserCode(prompt.userCode);
      setVerificationUri(prompt.verificationUri);
      setIsPolling(true);

      setSession(await prompt.complete(controller.signal));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Authentication failed");
      setIsPolling(false);
    }
  }, [login, setSession]);

  const title = t(($) => $.auth.signInGitHub);

  return (
    <LoginShell title={title} error={error}>
      {userCode && verificationUri ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t(($) => $.auth.enterCodeAt)}{" "}
            <a
              href={verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline hover:text-primary/80"
            >
              github.com/login/device
            </a>
          </p>
          <div className="rounded-md bg-muted p-3 text-center font-mono text-2xl font-bold tracking-widest">
            {userCode}
          </div>
          {isPolling && (
            <p className="text-center text-xs text-muted-foreground">
              {t(($) => $.auth.waitingAuth)}
            </p>
          )}
        </div>
      ) : (
        <Button className="w-full" onClick={() => void startLogin()} disabled={isPolling}>
          {title}
        </Button>
      )}
    </LoginShell>
  );
}

function RedirectLoginForm({
  login,
  error,
  onError,
}: {
  login: RedirectLogin;
  error: string | null;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const title =
    login.provider === "github" ? t(($) => $.auth.signInGitHub) : t(($) => $.auth.signInGitLab);

  // The error is the guard's, not this form's: the provider can report a refused
  // consent on the callback URL, and that arrives after this form has mounted.
  const handleLogin = useCallback(async () => {
    onError(null);
    try {
      await login.start();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Login failed");
    }
  }, [login, onError]);

  return (
    <LoginShell title={title} error={error}>
      <Button className="w-full" onClick={() => void handleLogin()}>
        {title}
      </Button>
    </LoginShell>
  );
}

function LoginShell({
  title,
  error,
  children,
}: {
  title: string;
  error: string | null;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold">{t(($) => $.layout.appName)}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{title}</p>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {children}
      </div>
    </div>
  );
}

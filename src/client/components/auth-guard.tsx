import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import config from "virtual:astronaut-cms/config";
import { useAuthStore } from "@client/stores/auth-store";
import { toSession, isExpired } from "@client/lib/oauth/session";
import { initiateDeviceAuthorization, verifyRepoWriteAccess } from "@client/lib/oauth/github";
import {
  startGitLabLogin,
  handleGitLabCallback,
  verifyProjectWriteAccess,
} from "@client/lib/oauth/gitlab";
import { Button } from "@client/components/ui/button";
import { Alert, AlertDescription } from "@client/components/ui/alert";

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
    if (config.storageType !== "gitlab") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const errorParam = params.get("error");
    const cleanUrl = () =>
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);

    if (errorParam) {
      setOauthError(params.get("error_description") ?? errorParam);
      cleanUrl();
      return;
    }

    if (!code) return;

    setOauthPending(true);
    handleGitLabCallback(
      config.gitlab!.clientId,
      config.gitlab!.instanceUrl,
      new URL(window.location.href),
    )
      .then(async (tokens) => {
        await verifyProjectWriteAccess(
          tokens.access_token,
          config.gitlab!.project,
          config.gitlab!.instanceUrl,
        );
        setSession(toSession("gitlab", tokens));
        cleanUrl();
      })
      .catch((err) => {
        setOauthError(err instanceof Error ? err.message : "Authentication failed");
      })
      .finally(() => setOauthPending(false));
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

  if (config.storageType === "github" && config.github) {
    return (
      <GitHubLogin
        clientId={config.github.clientId}
        repo={config.github.repo}
        // GitHub Apps derive permissions from the installation and ignore scopes.
        scopes={config.github.authMode === "github-app" ? undefined : config.github.scopes}
      />
    );
  }

  if (config.storageType === "gitlab" && config.gitlab) {
    return (
      <GitLabLogin
        clientId={config.gitlab.clientId}
        instanceUrl={config.gitlab.instanceUrl}
        scopes={config.gitlab.scopes}
        oauthError={oauthError}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">
        {t(($) => $.auth.unsupportedStorage, { type: config.storageType })}
      </p>
    </div>
  );
}

function GitHubLogin({
  clientId,
  repo,
  scopes,
}: {
  clientId: string;
  repo: string;
  scopes?: string[];
}) {
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
      const auth = await initiateDeviceAuthorization(clientId, scopes);
      setUserCode(auth.userCode);
      setVerificationUri(auth.verificationUri);
      setIsPolling(true);

      const tokens = await auth.poll(controller.signal);
      await verifyRepoWriteAccess(tokens.access_token, repo);
      setSession(toSession("github", tokens));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Authentication failed");
      setIsPolling(false);
    }
  }, [clientId, repo, scopes, setSession]);

  return (
    <LoginShell title={t(($) => $.auth.signInGitHub)} error={error}>
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
          {t(($) => $.auth.signInGitHub)}
        </Button>
      )}
    </LoginShell>
  );
}

function GitLabLogin({
  clientId,
  instanceUrl,
  scopes,
  oauthError,
}: {
  clientId: string;
  instanceUrl: string;
  scopes: string[];
  oauthError: string | null;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(oauthError);

  const handleLogin = useCallback(async () => {
    setError(null);
    try {
      const redirectUri = `${window.location.origin}${config.mountPoint}`;
      await startGitLabLogin(clientId, instanceUrl, redirectUri, scopes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }, [clientId, instanceUrl, scopes]);

  return (
    <LoginShell title={t(($) => $.auth.signInGitLab)} error={error}>
      <Button className="w-full" onClick={() => void handleLogin()}>
        {t(($) => $.auth.signInGitLab)}
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

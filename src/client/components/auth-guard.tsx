import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import config from "virtual:astronaut-cms/config";
import { useAuthStore } from "@/client/stores/auth-store";
import { initiateDeviceAuthorization } from "@/client/lib/oauth/github";
import { startGitLabLogin, handleGitLabCallback } from "@/client/lib/oauth/gitlab";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);

  // Handle GitLab OAuth callback params on the main page URL
  useEffect(() => {
    if (config.storageType !== "gitlab") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const errorParam = params.get("error");

    if (errorParam) {
      setOauthError(params.get("error_description") ?? errorParam);
      // Clean query params from URL
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
      return;
    }

    if (!code) return;

    setOauthPending(true);
    handleGitLabCallback(
      config.gitlab!.clientId,
      config.gitlab!.instanceUrl,
      new URL(window.location.href),
    )
      .then((accessToken) => {
        setToken(accessToken, "gitlab");
        // Clean query params from URL
        window.history.replaceState({}, "", window.location.pathname + window.location.hash);
      })
      .catch((err) => {
        setOauthError(err instanceof Error ? err.message : "Authentication failed");
      })
      .finally(() => setOauthPending(false));
  }, [setToken]);

  if (config.storageType === "local") {
    return children;
  }

  if (oauthPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">{t($ => $.auth.completingAuth)}</p>
      </div>
    );
  }

  if (token !== null) {
    return children;
  }

  if (config.storageType === "github" && config.github) {
    return <GitHubLogin clientId={config.github.clientId} />;
  }

  if (config.storageType === "gitlab" && config.gitlab) {
    return (
      <GitLabLogin
        clientId={config.gitlab.clientId}
        instanceUrl={config.gitlab.instanceUrl}
        oauthError={oauthError}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500">{t($ => $.auth.unsupportedStorage, { type: config.storageType })}</p>
    </div>
  );
}

function GitHubLogin({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const setToken = useAuthStore((s) => s.setToken);
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
      const auth = await initiateDeviceAuthorization(clientId);
      setUserCode(auth.userCode);
      setVerificationUri(auth.verificationUri);
      setIsPolling(true);

      const token = await auth.poll(controller.signal);
      setToken(token, "github");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Authentication failed");
      setIsPolling(false);
    }
  }, [clientId, setToken]);

  return (
    <LoginShell title={t($ => $.auth.signInGitHub)} error={error}>
      {userCode && verificationUri ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t($ => $.auth.enterCodeAt)}{" "}
            <a
              href={verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 underline hover:text-blue-700"
            >
              github.com/login/device
            </a>
          </p>
          <div className="rounded-md bg-gray-100 p-3 text-center font-mono text-2xl font-bold tracking-widest dark:bg-gray-800">
            {userCode}
          </div>
          {isPolling && (
            <p className="text-center text-xs text-gray-400">{t($ => $.auth.waitingAuth)}</p>
          )}
        </div>
      ) : (
        <button
          onClick={() => void startLogin()}
          disabled={isPolling}
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
        >
          {t($ => $.auth.signInGitHub)}
        </button>
      )}
    </LoginShell>
  );
}

function GitLabLogin({
  clientId,
  instanceUrl,
  oauthError,
}: {
  clientId: string;
  instanceUrl: string;
  oauthError: string | null;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(oauthError);

  const handleLogin = useCallback(async () => {
    setError(null);
    try {
      const redirectUri = `${window.location.origin}${config.mountPoint}`;
      await startGitLabLogin(clientId, instanceUrl, redirectUri);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }, []);

  return (
    <LoginShell title={t($ => $.auth.signInGitLab)} error={error}>
      <button
        onClick={() => void handleLogin()}
        className="w-full rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700"
      >
        {t($ => $.auth.signInGitLab)}
      </button>
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <h1 className="mb-1 text-lg font-semibold">{t($ => $.layout.appName)}</h1>
        <p className="mb-4 text-sm text-gray-500">{title}</p>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

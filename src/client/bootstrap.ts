/**
 * What the admin page actually loads.
 *
 * The page itself is a static shell that reads no session, so this is where the
 * admin finds out who it belongs to. It asks the server, and only then imports
 * the admin: an anonymous visitor fetches this file and stops, rather than
 * pulling down the whole admin bundle and the deployment's configuration with
 * it.
 *
 * Keep this module small and keep its static imports trivial. Anything imported
 * at the top lands in the shell's chunk and is served to anyone who asks.
 */
import { ADMIN_ROOT_ID, API_SESSION, type SessionState } from "@/shared/auth";
import { setConfig } from "@/client/lib/config";
import { apiFetch, apiUrl } from "@/client/lib/routes";
import { errorMessage } from "@/shared/errors";

const root = document.getElementById(ADMIN_ROOT_ID);
const panel = document.getElementById("astronaut-cms-signin");

/** Reveals the shell's own sign-in panel, which is why nothing here builds markup. */
function signIn(loginUrl: string, error?: string): void {
  const link = panel?.querySelector("a");
  const message = panel?.querySelector("p");

  if (link) link.href = loginUrl;

  if (message && error) {
    message.textContent = error;
    message.hidden = false;
  }

  if (panel) panel.hidden = false;
}

async function start(): Promise<void> {
  if (!root) return;

  const response = await apiFetch(apiUrl(API_SESSION), { headers: { accept: "application/json" } });

  if (!response.ok) throw new Error(`The CMS did not answer (${response.status}).`);

  const state = (await response.json()) as SessionState;
  // Whatever the provider put on the callback. It reaches the page through the
  // query string rather than the probe, since it is the browser's own URL.
  const error = state.error ?? new URLSearchParams(window.location.search).get("error");

  if (!state.config) {
    // An edge-authenticated editor never sees the button, unless something has
    // already gone wrong and showing it again would only loop.
    if (state.autoLogin && !error) {
      window.location.replace(state.loginUrl);

      return;
    }

    signIn(state.loginUrl, error ?? undefined);

    return;
  }

  // Before the import, so a module that reads the config as it loads sees it.
  setConfig(state.config);
  document.documentElement.lang = state.config.locale;

  const { mount } = await import("@/client/index");

  mount(root);
}

void start().catch((err: unknown) => {
  signIn("", errorMessage(err, "The CMS failed to load."));
});

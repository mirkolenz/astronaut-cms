import { create } from "zustand";

export type Provider = "github" | "gitlab";

export interface AuthSession {
  provider: Provider;
  accessToken: string;
  /** Epoch milliseconds when the access token expires, or null if it never does. */
  expiresAt: number | null;
}

interface AuthState {
  session: AuthSession | null;
  setSession: (session: AuthSession) => void;
  clearSession: () => void;
}

const SESSION_KEY = "astronaut-cms:auth";

function loadFromSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      typeof parsed.accessToken === "string" &&
      (parsed.provider === "github" || parsed.provider === "gitlab")
    ) {
      return {
        provider: parsed.provider,
        accessToken: parsed.accessToken,
        expiresAt: parsed.expiresAt ?? null,
      };
    }
  } catch {
    // ignore
  }

  return null;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: loadFromSession(),
  setSession: (session) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    set({ session });
  },
  clearSession: () => {
    sessionStorage.removeItem(SESSION_KEY);
    set({ session: null });
  },
}));

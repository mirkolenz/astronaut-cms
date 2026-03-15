import { create } from "zustand";

interface AuthState {
  token: string | null;
  provider: "github" | "gitlab" | null;
  setToken: (token: string, provider: "github" | "gitlab") => void;
  clearToken: () => void;
}

const SESSION_KEY = "astronaut-cms:auth";

function loadFromSession(): { token: string; provider: "github" | "gitlab" } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; provider: string };
    if (parsed.token && (parsed.provider === "github" || parsed.provider === "gitlab")) {
      return { token: parsed.token, provider: parsed.provider };
    }
  } catch {
    // ignore
  }
  return null;
}

export const useAuthStore = create<AuthState>((set) => {
  const saved = loadFromSession();
  return {
    token: saved?.token ?? null,
    provider: saved?.provider ?? null,
    setToken: (token, provider) => {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, provider }));
      set({ token, provider });
    },
    clearToken: () => {
      sessionStorage.removeItem(SESSION_KEY);
      set({ token: null, provider: null });
    },
  };
});

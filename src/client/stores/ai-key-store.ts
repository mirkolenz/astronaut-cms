import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface AiKeyState {
  key: string;
  setKey: (key: string) => void;
  clearKey: () => void;
}

/**
 * The editor's own gateway key, when the deployment asks each editor to bring
 * one rather than holding a shared credential of its own.
 *
 * It belongs to the editor, is spent against their account, and is theirs to
 * rotate, which is the whole reason this mode exists. It is never sent to the
 * CMS server: the only place it goes is the gateway named in the config, and the
 * admin's `connect-src` names that origin and nothing else.
 *
 * `sessionStorage` rather than `localStorage`, because it is a credential and
 * the tab closing is a reasonable place for it to stop existing.
 */
export const useAiKeyStore = create<AiKeyState>()(
  persist(
    (set) => ({
      key: "",
      setKey: (key) => set({ key: key.trim() }),
      clearKey: () => set({ key: "" }),
    }),
    {
      name: "astronaut-cms:ai-key",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

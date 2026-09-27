import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { aiConfig } from "@client/lib/ai/config";

interface AiPanelState {
  open: boolean;
  model: string;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setModel: (model: string) => void;
}

// Persisted to sessionStorage so the panel's open state and model selection
// survive the full page reloads that content edits trigger in dev.
export const useAiPanelStore = create<AiPanelState>()(
  persist(
    (set) => ({
      open: false,
      model: aiConfig?.models[0] ?? "",
      setOpen: (open) => set({ open }),
      toggle: () => set((state) => ({ open: !state.open })),
      setModel: (model) => set({ model }),
    }),
    {
      name: "astronaut-cms:ai-panel",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ open: state.open, model: state.model }),
    },
  ),
);

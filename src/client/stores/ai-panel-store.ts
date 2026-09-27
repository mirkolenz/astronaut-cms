import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { aiConfig } from "@client/lib/ai/config";
import type { ReasoningEffort } from "@client/lib/ai/reasoning";

interface AiPanelState {
  open: boolean;
  model: string;
  effort: ReasoningEffort;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setModel: (model: string) => void;
  setEffort: (effort: ReasoningEffort) => void;
}

// Persisted to sessionStorage so the panel's open state, model, and reasoning
// effort survive the full page reloads that content edits trigger in dev.
export const useAiPanelStore = create<AiPanelState>()(
  persist(
    (set) => ({
      open: false,
      model: aiConfig?.models[0] ?? "",
      effort: "provider-default",
      setOpen: (open) => set({ open }),
      toggle: () => set((state) => ({ open: !state.open })),
      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
    }),
    {
      name: "astronaut-cms:ai-panel",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ open: state.open, model: state.model, effort: state.effort }),
    },
  ),
);

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { aiConfig } from "@/client/lib/ai/config";
import type { ReasoningEffort } from "@/client/lib/ai/reasoning";

interface AiSettingsState {
  model: string;
  effort: ReasoningEffort;
  setModel: (model: string) => void;
  setEffort: (effort: ReasoningEffort) => void;
}

// The composer writes these and the agent reads them per call. Persisted so the
// selection is not lost when the dev server reloads the page after a content edit.
export const useAiSettingsStore = create<AiSettingsState>()(
  persist(
    (set) => ({
      model: aiConfig?.models[0] ?? "",
      effort: "provider-default",
      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
    }),
    {
      name: "astronaut-cms:ai-settings",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ model: state.model, effort: state.effort }),
    },
  ),
);

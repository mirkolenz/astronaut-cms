import { create } from "zustand";
import { aiConfig } from "@client/lib/ai/config";

interface AiPanelState {
  open: boolean;
  model: string;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setModel: (model: string) => void;
}

export const useAiPanelStore = create<AiPanelState>((set) => ({
  open: false,
  model: aiConfig?.models[0] ?? "",
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setModel: (model) => set({ model }),
}));

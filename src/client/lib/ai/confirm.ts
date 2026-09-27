import { create } from "zustand";

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  pending: PendingConfirm | null;
  request: (req: ConfirmRequest) => Promise<boolean>;
  resolve: (ok: boolean) => void;
}

// Bridges tool execution (which runs in the browser agent loop) to a React
// confirmation dialog: a destructive tool awaits `request`, and the dialog host
// resolves the promise when the user responds.
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  request: (req) =>
    new Promise<boolean>((resolve) => {
      set({ pending: { ...req, resolve } });
    }),
  resolve: (ok) => {
    const { pending } = get();

    if (pending) {
      pending.resolve(ok);
      set({ pending: null });
    }
  },
}));

export function requestConfirmation(req: ConfirmRequest): Promise<boolean> {
  return useConfirmStore.getState().request(req);
}

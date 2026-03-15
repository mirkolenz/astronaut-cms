import { create } from "zustand";

export interface PendingChange {
  id: string;
  collection: string;
  entryId: string;
  action: "create" | "update" | "delete";
  content?: string;
  format: string;
  message: string;
  timestamp: number;
}

interface ChangesState {
  changes: PendingChange[];
  isPublishing: boolean;
  publishError: string | null;
  addChange: (change: Omit<PendingChange, "id" | "timestamp">) => void;
  removeChange: (id: string) => void;
  clearChanges: () => void;
  setPublishing: (isPublishing: boolean) => void;
  setPublishError: (error: string | null) => void;
}

const SESSION_KEY = "astronaut-cms:changes";

function loadChanges(): PendingChange[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PendingChange[];
  } catch {
    return [];
  }
}

function saveChanges(changes: PendingChange[]) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(changes));
}

export const useChangesStore = create<ChangesState>((set, get) => ({
  changes: loadChanges(),
  isPublishing: false,
  publishError: null,

  addChange: (change) => {
    const existing = get().changes;
    const id = `${change.collection}/${change.entryId}`;
    // Replace existing change for same entry
    const filtered = existing.filter(
      (c) => !(c.collection === change.collection && c.entryId === change.entryId),
    );
    const updated = [...filtered, { ...change, id, timestamp: Date.now() }];
    saveChanges(updated);
    set({ changes: updated });
  },

  removeChange: (id) => {
    const updated = get().changes.filter((c) => c.id !== id);
    saveChanges(updated);
    set({ changes: updated });
  },

  clearChanges: () => {
    saveChanges([]);
    set({ changes: [], publishError: null });
  },

  setPublishing: (isPublishing) => set({ isPublishing }),
  setPublishError: (publishError) => set({ publishError }),
}));

import { useState, useEffect, useCallback } from "react";
import { create } from "zustand";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, type: Toast["type"]) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (message, type) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, message, type }] });
    setTimeout(() => get().removeToast(id), 4000);
  },
  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export function toast(message: string, type: Toast["type"] = "info") {
  useToastStore.getState().addToast(message, type);
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setTimeout(onDismiss, 150);
  }, [onDismiss]);

  const colors = {
    success:
      "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
    error:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
    info: "border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200",
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm shadow-md transition-all duration-150 ${colors[toast.type]} ${
        visible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      }`}
    >
      <span className="flex-1">{toast.message}</span>
      <button onClick={handleDismiss} className="shrink-0 text-xs opacity-50 hover:opacity-100">
        &times;
      </button>
    </div>
  );
}

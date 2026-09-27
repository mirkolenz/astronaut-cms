import { ConfirmDialog } from "@client/components/confirm-dialog";
import { useConfirmStore } from "@client/lib/ai/confirm";

// Renders confirmation dialogs requested by destructive agent tools.
export function AiConfirmationHost() {
  const pending = useConfirmStore((state) => state.pending);
  const resolve = useConfirmStore((state) => state.resolve);

  return (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ""}
      message={pending?.message ?? ""}
      confirmLabel={pending?.confirmLabel}
      variant={pending?.variant}
      onConfirm={() => resolve(true)}
      onCancel={() => resolve(false)}
    />
  );
}

import { useTranslation } from "react-i18next";
import { useBlocker } from "@tanstack/react-router";
import { ConfirmDialog } from "@/client/components/confirm-dialog";

export function useUnsavedChangesBlocker(isDirty: boolean) {
  return useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  });
}

export function UnsavedChangesDialog({
  blocker,
}: {
  blocker: ReturnType<typeof useUnsavedChangesBlocker>;
}) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      open={blocker.status === "blocked"}
      title={t(($) => $.entry.unsavedChanges)}
      description={t(($) => $.entry.unsavedChangesMessage)}
      confirmLabel={t(($) => $.common.discard)}
      variant="destructive"
      onConfirm={() => blocker.status === "blocked" && blocker.proceed()}
      onCancel={() => blocker.status === "blocked" && blocker.reset()}
    />
  );
}

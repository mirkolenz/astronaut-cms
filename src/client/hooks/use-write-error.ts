import { useTranslation } from "react-i18next";
import { isMergeConflict, isStaleWrite } from "@/client/lib/api";
import { errorMessage } from "@/shared/errors";

/**
 * How a failed write reads to the editor.
 *
 * Stale reads and merge conflicts are the failures they can act on directly,
 * so they get the admin's own words in their own language.
 * Everything else keeps the server's, which is already specific.
 */
export function useWriteError(): (error: unknown) => string {
  const { t } = useTranslation();

  return (error) => {
    if (isMergeConflict(error)) return t(($) => $.publish.mergeConflict);
    if (isStaleWrite(error)) return t(($) => $.entry.staleWrite);

    return errorMessage(error);
  };
}

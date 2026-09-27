import { useTranslation } from "react-i18next";
import { isStaleWrite } from "@client/lib/api";

/**
 * How a failed write reads to the editor.
 *
 * A stale read is the one failure they can act on directly — reload, then apply
 * the edit again — so it gets the admin's own words in their own language.
 * Everything else keeps the server's, which is already specific.
 */
export function useWriteError(): (error: Error) => string {
  const { t } = useTranslation();

  return (error) => (isStaleWrite(error) ? t(($) => $.entry.staleWrite) : error.message);
}

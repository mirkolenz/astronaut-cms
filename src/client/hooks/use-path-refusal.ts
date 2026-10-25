import { useTranslation } from "react-i18next";
import { idIssue, mediaPathIssue, type PathIssue } from "@/shared/validation";

/** Whether a name is already in use. */
type Taken = (value: string) => boolean;

/** Why a typed path is refused, in the editor's language, or null when it is accepted. */
export function usePathRefusal() {
  const { t } = useTranslation();

  const message = (issue: PathIssue | null, value: string, taken?: Taken): string | null => {
    switch (issue) {
      case "empty":
        return t(($) => $.validation.empty);
      case "characters":
        return t(($) => $.validation.characters);
      case "nestedCharacters":
        return t(($) => $.validation.nestedCharacters);
      case "absolute":
        return t(($) => $.validation.absolute);
      case "segments":
        return t(($) => $.validation.segments);
      case null:
        return taken?.(value) ? t(($) => $.validation.exists, { name: value }) : null;
    }
  };

  return {
    /** An entry id, which may nest folders when `nested`. */
    id: (value: string, nested: boolean, taken?: Taken) =>
      message(idIssue(value, nested), value, taken),
    /** A media library path, which may nest folders ("2026/summer"). */
    media: (value: string, taken?: Taken) => message(mediaPathIssue(value), value, taken),
  };
}

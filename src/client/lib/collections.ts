import { BarChart3, FileText, NotebookPen } from "lucide-react";
import i18n from "i18next";
import { collectionIcons } from "virtual:astronaut-cms/user-config";
import config from "@/client/lib/config";
import type { ComponentIcon } from "@/config";
import { collectionLabel as labelOf } from "@/shared/labels";
import { singletonEntry, type SingletonEntry } from "@/shared/types";

/** What the admin calls a collection, as agents are told it too. */
export function collectionLabel(name: string): string {
  return labelOf(config.collections[name] ?? { name });
}

/** What a collection is for, or else what kind of collection it is. */
export function collectionDescription(name: string): string {
  const col = config.collections[name];

  return (
    col?.description ??
    i18n.t(($) =>
      col?.loaderType === "file"
        ? $.collection.fileCollection
        : col?.type === "content"
          ? $.collection.contentCollection
          : $.collection.dataCollection,
    )
  );
}

/** A collection's own icon, or one for the kind of collection it is. */
export function collectionIcon(name: string): ComponentIcon {
  const col = config.collections[name];

  return (
    collectionIcons[name] ??
    (col?.loaderType === "file" ? FileText : col?.type === "content" ? NotebookPen : BarChart3)
  );
}

/** The one entry of a singleton collection, which the admin edits in its place, or null. */
export function collectionSingleton(name: string): SingletonEntry | null {
  const col = config.collections[name];

  return col ? singletonEntry(col) : null;
}

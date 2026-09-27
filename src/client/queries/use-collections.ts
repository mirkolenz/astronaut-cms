import { useQuery } from "@tanstack/react-query";
import collectionData from "virtual:astronaut-cms/collections";
import { initializeStorage } from "@client/lib/storage";
import type { CollectionInfo } from "@shared/types";

// Eagerly initialize storage with collection type info so that
// entry/media queries can use getStorage() immediately.
const collectionInfo: Record<string, CollectionInfo> = {};
for (const [name, col] of Object.entries(collectionData)) {
  collectionInfo[name] = {
    name,
    type: col.type,
    loaderType: col.loaderType,
    loaderFileName: col.loaderFileName,
  };
}
initializeStorage(collectionInfo);

export function useCollections() {
  return useQuery({
    queryKey: ["cms", "collections"],
    queryFn: () => collectionData,
    staleTime: Infinity,
  });
}

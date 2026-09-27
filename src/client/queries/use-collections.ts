import { useQuery } from "@tanstack/react-query";
import collectionData from "virtual:astronaut-cms/collections";
import { cmsKeys } from "@/client/lib/query-keys";

export function useCollections() {
  return useQuery({
    queryKey: cmsKeys.collections,
    queryFn: () => collectionData,
    staleTime: Infinity,
  });
}

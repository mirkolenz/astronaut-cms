import { useQuery } from "@tanstack/react-query";
import collectionData from "virtual:astronaut-cms/collections";

export function useCollections() {
  return useQuery({
    queryKey: ["cms", "collections"],
    queryFn: () => collectionData,
    staleTime: Infinity,
  });
}

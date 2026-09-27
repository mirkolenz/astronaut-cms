import type { CollectionSort } from "@/shared/types";

// Stand-in for the build-time `virtual:astronaut-cms/order` module.
export const sorts: Record<string, CollectionSort> = { events: "file", pages: "natural" };
export const fileOrder: Record<string, string[]> = { events: ["b", "c", "a"] };

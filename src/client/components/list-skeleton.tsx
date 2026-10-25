import { Skeleton } from "@/client/components/ui/skeleton";

/** A list page while its data loads. */
export function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-12 rounded-lg" />
      ))}
    </div>
  );
}

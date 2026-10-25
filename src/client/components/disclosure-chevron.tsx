import { ChevronRight } from "lucide-react";
import { cn } from "cn";

/** Points right while closed and down while open, inside a `group/disclosure` element carrying `data-state`, such as a collapsible trigger. */
export function DisclosureChevron({ className }: { className?: string }) {
  return (
    <ChevronRight
      className={cn("transition-transform group-data-[state=open]/disclosure:rotate-90", className)}
    />
  );
}

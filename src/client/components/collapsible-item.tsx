import type { ComponentProps, ReactNode } from "react";
import { DisclosureChevron } from "@/client/components/disclosure-chevron";
import { Collapsible, CollapsibleTrigger } from "@/client/components/ui/collapsible";
import { Item, ItemContent, ItemMedia } from "@/client/components/ui/item";

interface CollapsibleItemProps extends Omit<ComponentProps<typeof Item>, "asChild"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown before the trigger, such as a drag handle. */
  handle?: ReactNode;
  /** Shown next to the chevron. */
  icon?: ReactNode;
  /** What the trigger names the row by. */
  label: ReactNode;
  /** What follows the trigger: its actions and the collapsible content. */
  children: ReactNode;
}

/** A row of a list that opens to show more below it, by a trigger with a chevron. */
export function CollapsibleItem({
  open,
  onOpenChange,
  handle,
  icon,
  label,
  children,
  ...props
}: CollapsibleItemProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <Item variant="outline" size="sm" {...props}>
        {handle}
        <CollapsibleTrigger className="group/disclosure flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ItemMedia variant="icon" className="text-muted-foreground">
            <DisclosureChevron />
            {icon}
          </ItemMedia>
          <ItemContent className="min-w-0">{label}</ItemContent>
        </CollapsibleTrigger>
        {children}
      </Item>
    </Collapsible>
  );
}

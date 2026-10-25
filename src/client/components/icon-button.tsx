import type { ComponentProps, ReactNode } from "react";
import { Shortcut } from "@/client/components/shortcut";
import { Button } from "@/client/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";

interface LabelTooltipProps {
  label: string;
  /** Keys that trigger the same action. */
  shortcut?: readonly string[];
  /** The trigger, which must forward its props and ref. */
  children: ReactNode;
}

/** Explains a control on hover with its label and shortcut. */
export function LabelTooltip({ label, shortcut, children }: LabelTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <Shortcut keys={shortcut} />}
      </TooltipContent>
    </Tooltip>
  );
}

interface IconButtonProps extends Omit<ComponentProps<typeof Button>, "aria-label" | "title"> {
  /** Names the button for assistive technology and shows as its tooltip. */
  label: string;
  /** Keys that trigger the same action, shown in the tooltip. */
  shortcut?: readonly string[];
}

/** An icon-only button, always named and always explained on hover. */
export function IconButton({
  label,
  shortcut,
  asChild,
  type = asChild ? undefined : "button",
  variant = "ghost",
  size = "icon-xs",
  ...props
}: IconButtonProps) {
  return (
    <LabelTooltip label={label} shortcut={shortcut}>
      <Button
        asChild={asChild}
        type={type}
        variant={variant}
        size={size}
        aria-label={label}
        {...props}
      />
    </LabelTooltip>
  );
}

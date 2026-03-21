import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ConfirmDialog } from "@/client/components/confirm-dialog";
import { Button } from "@/client/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/client/components/ui/tooltip";
import { Collapsible, CollapsibleContent } from "@/client/components/ui/collapsible";

interface BlockFrameProps {
  icon?: LucideIcon | null;
  label: string;
  detail?: React.ReactNode;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  children: React.ReactNode;
}

export function BlockFrame({
  icon: Icon,
  label,
  detail,
  onRemove,
  onMoveUp,
  onMoveDown,
  children,
}: BlockFrameProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <div className="rounded-md border border-gray-300 dark:border-gray-600">
        <div className="flex items-center justify-between rounded-t-md border-b border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-2">
            {Icon && <Icon className="size-4" />}
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</span>
            {detail}
          </div>
          <div className="flex items-center gap-1">
            {onMoveUp && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-xs" onClick={onMoveUp}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t($ => $.editors.moveUp)}</TooltipContent>
              </Tooltip>
            )}
            {onMoveDown && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-xs" onClick={onMoveDown}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t($ => $.editors.moveDown)}</TooltipContent>
              </Tooltip>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? t($ => $.editors.expand) : t($ => $.editors.collapse)}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t($ => $.editors.deleteBlock)}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <CollapsibleContent>{children}</CollapsibleContent>
        <ConfirmDialog
          open={showDeleteConfirm}
          title={t($ => $.editors.deleteBlock)}
          message={t($ => $.editors.deleteBlockMessage, { label })}
          confirmLabel={t($ => $.common.delete)}
          variant="danger"
          onConfirm={() => {
            setShowDeleteConfirm(false);
            onRemove();
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      </div>
    </Collapsible>
  );
}

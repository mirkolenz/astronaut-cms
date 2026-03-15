import { useState } from "react";
import { ConfirmDialog } from "@/client/components/confirm-dialog";

interface BlockFrameProps {
  icon?: string | null;
  label: string;
  detail?: React.ReactNode;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  children: React.ReactNode;
}

export function BlockFrame({
  icon,
  label,
  detail,
  onRemove,
  onMoveUp,
  onMoveDown,
  children,
}: BlockFrameProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div className="rounded-md border border-gray-300 dark:border-gray-600">
      <div className="flex items-center justify-between rounded-t-md border-b border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          {icon && <span className="text-sm">{icon}</span>}
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</span>
          {detail}
        </div>
        <div className="flex items-center gap-1">
          {onMoveUp && (
            <button
              type="button"
              onClick={onMoveUp}
              className="rounded px-1 py-0.5 text-xs text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              title="Move up"
            >
              &uarr;
            </button>
          )}
          {onMoveDown && (
            <button
              type="button"
              onClick={onMoveDown}
              className="rounded px-1 py-0.5 text-xs text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              title="Move down"
            >
              &darr;
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="rounded px-1 py-0.5 text-xs text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded px-1 py-0.5 text-xs text-red-500 hover:bg-red-100 dark:hover:bg-red-950"
          >
            Delete
          </button>
        </div>
      </div>
      {!collapsed && children}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete block"
        message={`Are you sure you want to delete this ${label} block?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          setShowDeleteConfirm(false);
          onRemove();
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

/**
 * The props of the selected component, next to the body on a wide screen and
 * as a sheet over it otherwise. Its structured children are listed to reorder
 * and to drill into, with breadcrumbs leading back out. Without a selection,
 * the panel shows the outline of the body.
 */
import { Fragment, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, X } from "lucide-react";
import { rootEditor$ } from "@mdxeditor/editor";
import { components } from "virtual:astronaut-cms/user-config";
import type { ClientComponentDef } from "@/internal/user-config";
import type { MdxJsxElement } from "@/shared/jsx-editor";
import { findComponent } from "@/shared/component-lookup";
import { isRequired, objectShape } from "@/shared/field-schema";
import {
  childKey,
  defAt,
  findAt,
  jsxChildren,
  labelOf,
  missingProps,
  moveChild,
  readProps,
  summaryOf,
  updateAt,
  withProp,
} from "@/client/lib/component-tree";
import { blockActions, releaseEditors, updateBlock, useBlockElement } from "@/client/lib/block-editing";
import { useMediaQuery } from "@/client/lib/use-media-query";
import { selectBlock, useBodyRealm, useSelection, type BlockSelection } from "@/client/stores/inspector-store";
import { Button } from "@/client/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/client/components/ui/breadcrumb";
import { FieldList } from "./field-renderer";
import { BlockList, BlockMenu, ChildListControls, MissingProps } from "./block-controls";
import { BlockOutline } from "./block-outline";

// Wide enough for the body and the docked inspector side by side.
const DOCKED = "(min-width: 80rem)";

export function InspectorPanel() {
  const selection = useSelection();
  const bodyEditor = useBodyRealm()?.getValue(rootEditor$);
  const docked = useMediaQuery(DOCKED);

  const inspector = (onClose?: () => void) =>
    selection && (
      <ComponentInspector
        key={`${selection.nodeKey}/${selection.path.join("/")}`}
        selection={selection}
        onClose={onClose}
      />
    );

  if (docked) {
    return (
      <aside
        className="w-80 shrink-0 overflow-y-auto border-l border-border pl-6"
        onFocusCapture={() => selection && releaseEditors(selection)}
      >
        {inspector() ?? (bodyEditor && <BlockOutline editor={bodyEditor} />)}
      </aside>
    );
  }

  return (
    selection && (
      <div
        className="fixed inset-x-0 bottom-0 z-40 max-h-[55dvh] overflow-y-auto border-t border-border bg-background p-4 shadow-lg"
        onFocusCapture={() => releaseEditors(selection)}
      >
        {inspector(() => selectBlock(null))}
      </div>
    )
  );
}

function ComponentInspector({ selection, onClose }: { selection: BlockSelection; onClose?: () => void }) {
  const { t } = useTranslation();
  const root = useBlockElement(selection);
  const element = root && findAt(root, selection.path);

  // The block was deleted, or its editor has gone.
  useEffect(() => {
    if (!element) selectBlock(null);
  }, [element]);

  if (!root || !element) return null;

  const { path } = selection;
  const rootDef = root.name ? findComponent(root.name, components) : undefined;
  const def = defAt(rootDef, root, path);
  const label = labelOf(def, element);
  const Icon = def?.icon;
  const shape = objectShape(def?.props) ?? {};
  const childDefs = typeof def?.children === "object" ? def.children : undefined;

  // The enclosing components: those outside this Lexical node, then those inside it.
  const crumbs = [
    ...selection.trail,
    ...path.map((_, index) => {
      const ancestorPath = path.slice(0, index);
      const ancestor = findAt(root, ancestorPath);
      const ancestorDef = defAt(rootDef, root, ancestorPath);

      return {
        label: ancestor ? (summaryOf(ancestorDef, ancestor) ?? labelOf(ancestorDef, ancestor)) : "",
        selection: { ...selection, path: ancestorPath },
      };
    }),
  ];

  const setProp = (key: string, value: unknown) => {
    const field = shape[key];
    // An optional prop left empty is not written at all.
    const next = value === "" && field && !isRequired(field) ? undefined : value;

    updateBlock(
      selection,
      (target) => updateAt(target, path, (current) => withProp(current, key, next)),
      `${selection.nodeKey}/${path.join("/")}/${key}`,
    );
  };

  return (
    <div className="space-y-4">
      {crumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            {crumbs.map((crumb, index) => (
              <Fragment key={index}>
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbLink asChild>
                    <button type="button" className="max-w-40 truncate" onClick={() => selectBlock(crumb.selection, { reveal: true })}>
                      {crumb.label}
                    </button>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </Fragment>
            ))}
            <BreadcrumbItem>
              <BreadcrumbPage>{label}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )}

      <div className="flex items-start gap-2">
        {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{label}</h2>
          {def?.description && <p className="text-xs text-muted-foreground">{def.description}</p>}
        </div>
        <BlockMenu actions={blockActions(selection)} />
        {onClose && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t(($) => $.common.close)} onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>

      {Object.keys(shape).length > 0 ? (
        <FieldList shape={shape} values={readProps(element)} onChange={setProp} />
      ) : (
        !childDefs && <p className="text-xs text-muted-foreground">{t(($) => $.editors.noProps)}</p>
      )}

      {childDefs && <ChildList selection={selection} element={element} childDefs={childDefs} />}
    </div>
  );
}

/** The structured children of the selected block, to reorder, add and drill into. */
function ChildList({
  selection,
  element,
  childDefs,
}: {
  selection: BlockSelection;
  element: MdxJsxElement;
  childDefs: Record<string, ClientComponentDef>;
}) {
  const { t } = useTranslation();
  const children = jsxChildren(element);
  const { path } = selection;

  return (
    <BlockList
      title={t(($) => $.editors.contents)}
      items={children}
      getKey={childKey}
      onMove={(from, to) => {
        const child = children[from];

        if (child) updateBlock(selection, (root) => moveChild(root, path, childKey(child), to - from));
      }}
      row={(child) => {
        const def = child.name ? childDefs[child.name] : undefined;

        return {
          icon: def?.icon,
          label: labelOf(def, child),
          summary: summaryOf(def, child),
          onOpen: () => selectBlock({ ...selection, path: [...path, childKey(child)] }, { reveal: true }),
          trailing: (
            <>
              <MissingProps labels={missingProps(def, child)} />
              <ChevronRight className="size-4 text-muted-foreground" />
            </>
          ),
        };
      }}
    >
      <ChildListControls parent={selection} childDefs={childDefs} />
    </BlockList>
  );
}

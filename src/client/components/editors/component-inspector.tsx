/**
 * The props of the selected component, next to the body on a wide screen and
 * as a sheet over it otherwise. Its structured children are listed to reorder
 * and to drill into, with breadcrumbs leading back out, and so are the values
 * of a form that open here, such as a list of items. Without a selection, the
 * panel shows the outline of the body.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { rootEditor$ } from "@mdxeditor/editor";
import { components } from "virtual:astronaut-cms/user-config";
import type { ClientComponentDef } from "@/internal/user-config";
import type { MdxJsxElement } from "@/shared/jsx-editor";
import { findComponent } from "@/shared/component-lookup";
import { objectShape } from "@/shared/field-schema";
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
import { updateBlock, useBlockActions, useBlockElement } from "@/client/lib/block-editing";
import type { ValuePath } from "@/client/lib/field-values";
import { useMediaQuery } from "@/client/lib/use-media-query";
import { collectionIcon, collectionLabel } from "@/client/lib/collections";
import {
  isBlockSelection,
  select,
  useBodyRealm,
  useSelectedField,
  useSelection,
  type BlockSelection,
} from "@/client/stores/inspector-store";
import { FieldList, FieldNavContext } from "@/client/components/editors/field-renderer";
import { FieldInspector, FormInspector } from "@/client/components/editors/field-inspector";
import { BlockList, ChildListControls, DOCKED, InspectorView } from "@/client/components/editors/block-controls";
import { BlockOutline } from "@/client/components/editors/block-outline";
import { Button } from "@/client/components/ui/button";

export function InspectorPanel() {
  const selection = useSelection();
  const field = useSelectedField();
  const bodyEditor = useBodyRealm()?.getValue(rootEditor$);
  const docked = useMediaQuery(DOCKED);
  const content = !selection ? null : isBlockSelection(selection) ? (
    <ComponentInspector key={`${selection.nodeKey}/${selection.path.join("/")}`} selection={selection} field={field} />
  ) : (
    <FormInspector key={selection.form} form={selection.form} field={field} />
  );

  if (docked) {
    const shown = content || (bodyEditor && <BlockOutline editor={bodyEditor} />);

    return (
      shown && (
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-border pl-6">
          {shown}
        </aside>
      )
    );
  }

  return (
    content && (
      <div
        className="fixed inset-x-0 bottom-0 z-40 max-h-[55dvh] overflow-y-auto border-t border-border bg-background p-4 shadow-lg"
      >
        {content}
      </div>
    )
  );
}

function ComponentInspector({ selection, field }: { selection: BlockSelection; field: ValuePath }) {
  const { t } = useTranslation();
  const root = useBlockElement(selection);
  const element = root && findAt(root, selection.path);
  const actions = useBlockActions(selection);

  // The block was deleted, or its editor has gone.
  useEffect(() => {
    if (!element) select(null);
  }, [element]);

  if (!root || !element) return null;

  const { path } = selection;
  const rootDef = root.name ? findComponent(root.name, components) : undefined;
  const def = defAt(rootDef, root, path);
  const label = labelOf(def, element);
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
  ].map((crumb) => ({ label: crumb.label, onSelect: () => select(crumb.selection, { reveal: true }) }));

  const setProp = (key: string, value: unknown) =>
    updateBlock(
      selection,
      (target) => updateAt(target, path, (current) => withProp(current, key, value)),
      `${selection.nodeKey}/${path.join("/")}/${key}`,
    );
  const open = (next: ValuePath) => select(selection, { field: next });
  const values = readProps(element);

  return (
    <FieldNavContext.Provider value={{ selected: field, open }}>
      {field.length > 0 ? (
        <FieldInspector crumbs={crumbs} label={label} shape={shape} values={values} onChange={setProp} />
      ) : (
        <InspectorView
          crumbs={crumbs}
          icon={def?.icon}
          title={label}
          description={def?.description}
          actions={actions}
        >
          {Object.keys(shape).length > 0 ? (
            <FieldList shape={shape} values={values} onChange={setProp} />
          ) : (
            !childDefs && <p className="text-xs text-muted-foreground">{t(($) => $.editors.noProps)}</p>
          )}

          {childDefs && <ChildList selection={selection} element={element} childDefs={childDefs} />}

          {def?.collections.map((name) => <CollectionLink key={name} name={name} />)}
        </InspectorView>
      )}
    </FieldNavContext.Provider>
  );
}

/** A collection the selected block renders, whose entries are its content. */
function CollectionLink({ name }: { name: string }) {
  const { t } = useTranslation();
  const Icon = collectionIcon(name);

  return (
    <Button asChild variant="outline" size="sm" className="w-full justify-start">
      <Link to="/collections/$collection" params={{ collection: name }}>
        <Icon />
        {t(($) => $.editors.editCollection, { collection: collectionLabel(name) })}
      </Link>
    </Button>
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

        if (child) updateBlock(selection, (root) => moveChild(root, path, childKey(child), to));
      }}
      row={(child) => {
        const def = child.name ? childDefs[child.name] : undefined;

        return {
          icon: def?.icon,
          label: labelOf(def, child),
          summary: summaryOf(def, child),
          missing: missingProps(def, child),
          onOpen: () => select({ ...selection, path: [...path, childKey(child)] }, { reveal: true }),
          inspects: true,
        };
      }}
    >
      <ChildListControls parent={selection} childDefs={childDefs} />
    </BlockList>
  );
}

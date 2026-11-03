import type { ComponentSchema } from "@/shared/field-schema";

/** A component as far as its nesting goes. */
interface ComponentNode<T> {
  children?: "markdown" | Record<string, T>;
}

/**
 * Every component in the tree with its name, nested child sets included. Generic
 * over the definition so the admin gets its full `ClientComponentDef` back, the
 * build the structural shape it walks with, and the site its live definitions.
 */
export function* componentEntries<T extends ComponentNode<T>>(
  tree: Record<string, T>,
): Generator<[string, T]> {
  for (const [name, def] of Object.entries(tree)) {
    yield [name, def];

    if (typeof def.children === "object") yield* componentEntries(def.children);
  }
}

/** Finds a component by name anywhere in the tree, including nested child sets. */
export function findComponent<T extends ComponentSchema>(
  name: string,
  tree: Record<string, T>,
): T | undefined {
  return componentEntries(tree).find(([key]) => key === name)?.[1];
}

/**
 * The components written directly inside one: its declared children, the
 * top-level ones inside markdown children, and none inside a leaf.
 */
export function childComponents<T extends ComponentSchema>(
  def: T,
  topLevel: Record<string, T>,
): Record<string, T> {
  if (def.children === undefined) return {};

  return def.children === "markdown" ? topLevel : def.children;
}

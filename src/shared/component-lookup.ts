import type { ComponentSchema } from "./field-schema.ts";

/**
 * Finds a component by name anywhere in the tree, including nested child sets.
 * Generic over the definition so the admin gets its full `ClientComponentDef`
 * back while the build gets the structural shape it walks with.
 */
export function findComponent<T extends ComponentSchema>(
  name: string,
  tree: Record<string, T>,
): T | undefined {
  for (const [key, def] of Object.entries(tree)) {
    if (key === name) return def;

    if (typeof def.children === "object") {
      const found = findComponent(name, def.children);

      if (found) return found;
    }
  }

  return undefined;
}

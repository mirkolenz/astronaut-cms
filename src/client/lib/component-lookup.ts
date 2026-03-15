import type { ClientComponentDef } from "virtual:astronaut-cms/user-config";

type ComponentTree = Record<string, ClientComponentDef>;

export function findComponent(name: string, tree: ComponentTree): ClientComponentDef | undefined {
  for (const [key, def] of Object.entries(tree)) {
    if (key === name) return def;
    if (typeof def.children === "object") {
      const found = findComponent(name, def.children);
      if (found) return found;
    }
  }
  return undefined;
}

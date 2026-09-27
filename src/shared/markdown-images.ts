import type { Nodes } from "mdast";

/**
 * The URLs a parsed body embeds as markdown images, inline (`![alt](url)`) or
 * through a definition (`![alt][id]`). Read off the tree rather than matched, so
 * an image in a code block is not one.
 */
export function imageUrls(tree: Nodes): string[] {
  const urls: string[] = [];
  const referenced = new Set<string>();
  const definitions = new Map<string, string>();

  const visit = (node: Nodes): void => {
    if (node.type === "image") urls.push(node.url);
    if (node.type === "imageReference") referenced.add(node.identifier);
    if (node.type === "definition") definitions.set(node.identifier, node.url);
    if ("children" in node) node.children.forEach(visit);
  };

  visit(tree);

  return [...urls, ...referenced.values().flatMap((id) => definitions.get(id) ?? [])];
}

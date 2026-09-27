import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

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

  for (const id of referenced) {
    const url = definitions.get(id);

    if (url) urls.push(url);
  }

  return urls;
}

/**
 * The images of a Markdown body. An MDX body is parsed by `validateMdx`, which
 * reports its images from the same tree, so it is never parsed twice.
 */
export function markdownImages(body: string, format: string): string[] {
  return format === "md" ? imageUrls(fromMarkdown(body)) : [];
}

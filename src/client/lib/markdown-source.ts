/**
 * Writes the body so that an edit changes the file only where it changed the
 * content. The editor serializes every block in one canonical style, but a
 * block that reads the same as one in the source keeps its source text, and two
 * such blocks that followed each other keep the lines between them.
 */
import type { Root, RootContent } from "mdast";

type ParseMarkdown = (markdown: string) => Root;

interface Block {
  /** The content without positions, to compare blocks written differently. */
  key: string;
  start: number;
  end: number;
  index: number;
}

const contentKey = (node: RootContent): string =>
  JSON.stringify(node, (key, value: unknown) =>
    key === "position" || key === "data" ? undefined : value,
  );

function blocksOf(markdown: string, parse: ParseMarkdown): Block[] | undefined {
  try {
    return parse(markdown).children.map((node, index) => ({
      key: contentKey(node),
      start: node.position?.start.offset ?? 0,
      end: node.position?.end.offset ?? 0,
      index,
    }));
  } catch {
    return undefined;
  }
}

/** Writes canonical markdown with the source text of its unedited blocks, parsing each source once. */
export function createSourcePreserver(
  parse: ParseMarkdown,
): (source: string, canonical: string) => string {
  let parsed: { source: string; blocks: Block[] | undefined } | undefined;

  return (source, canonical) => {
    if (parsed?.source !== source) parsed = { source, blocks: blocksOf(source, parse) };

    const original = parsed.blocks;
    const next = blocksOf(canonical, parse);

    if (!original || !next) return canonical;

    // Each block takes the first unused source block that reads the same, so a moved block keeps its text too.
    const unused = Map.groupBy(original, (block) => block.key);
    const matches = next.map((block) => unused.get(block.key)?.shift());
    const texts = next.map((block, index) => {
      const match = matches[index];

      return match ? source.slice(match.start, match.end) : canonical.slice(block.start, block.end);
    });
    let result = texts[0] ?? "";

    for (let index = 1; index < next.length; index++) {
      const [before, block] = [next[index - 1]!, next[index]!];
      const [previous, match] = [matches[index - 1], matches[index]];
      const kept = previous && match && match.index === previous.index + 1;
      const gap = kept
        ? source.slice(previous.end, match.start)
        : canonical.slice(before.end, block.start);
      const text = texts[index]!;

      // New neighbors in source form can read as one, such as two lists with the same marker.
      if (!kept && (previous || match)) {
        const pair = blocksOf(texts[index - 1] + gap + text, parse);

        if (pair?.length !== 2 || pair[0]!.key !== before.key || pair[1]!.key !== block.key)
          return canonical;
      }

      result += gap + text;
    }

    return result;
  };
}

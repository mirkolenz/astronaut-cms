import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { PluggableList, Processor } from "unified";
import { remarkPlugins, rehypePlugins } from "virtual:astronaut-cms/user-config";

function buildProcessor(
  userRemarkPlugins: PluggableList,
  userRehypePlugins: PluggableList,
): Processor {
  const pipeline: PluggableList = [
    remarkParse,
    remarkGfm,
    ...userRemarkPlugins,
    remarkRehype,
    ...userRehypePlugins,
    rehypeStringify,
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processor = unified() as any;
  for (const plugin of pipeline) {
    if (Array.isArray(plugin)) {
      processor = processor.use(plugin[0], ...plugin.slice(1));
    } else {
      processor = processor.use(plugin);
    }
  }

  return processor.freeze() as Processor;
}

const markdownProcessor = buildProcessor(remarkPlugins, rehypePlugins);

export async function renderMarkdown(body: string): Promise<string> {
  const result = await markdownProcessor.process(body);
  return String(result);
}

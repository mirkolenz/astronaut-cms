/**
 * The MDX components a body may use, as an agent learns them.
 *
 * The overview (what each component is for and where it may be written) is
 * small, so it is part of the content model and reaches the assistant's prompt
 * and `getContentModel` alike. Prop schemas are not, so `getComponents` hands
 * them out on demand, reconstructed exactly as a collection's write tool is.
 */
import { z } from "zod";
import { componentEntries } from "@/shared/component-lookup";
import type { DescribedComponent } from "@/shared/field-schema";
import { fieldSchemaToZod } from "@/shared/field-to-zod";

export interface ComponentOverview {
  label: string;
  description?: string;
  /** `block` stands on lines of its own, `inline` sits within a line of text. */
  kind: "block" | "inline";
  /**
   * What goes between its tags: markdown with top-level components, only the
   * listed child components, or nothing when absent, so the tag closes itself.
   */
  children?: "markdown" | Record<string, ComponentOverview>;
  /** The collections whose entries it renders, so what it shows is changed by editing those entries. */
  collections?: string[];
}

export interface ComponentDetails {
  /** JSON Schema of its props. */
  props: z.core.JSONSchema.BaseSchema;
  /** The prop that names an instance, such as its title. */
  summary?: string;
}

export function componentOverview(
  components: Record<string, DescribedComponent>,
): Record<string, ComponentOverview> {
  return Object.fromEntries(
    Object.entries(components).map(([name, def]) => [
      name,
      {
        label: def.label,
        description: def.description ?? undefined,
        kind: def.kind === "text" ? "inline" : "block",
        children: typeof def.children === "object" ? componentOverview(def.children) : def.children,
        collections: def.collections.length ? def.collections : undefined,
      },
    ]),
  );
}

/** The named components, nested ones included, with their full prop schemas. */
export function componentDetails(
  components: Record<string, DescribedComponent>,
  names: readonly string[],
): Record<string, ComponentDetails> {
  return Object.fromEntries(
    componentEntries(components)
      .filter(([name]) => names.includes(name))
      .map(([name, def]) => [
        name,
        {
          props: z.toJSONSchema(fieldSchemaToZod(def.props), {
            target: "draft-2020-12",
            io: "input",
          }),
          summary: def.summary ?? undefined,
        },
      ]),
  );
}

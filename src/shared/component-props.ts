import { z } from "zod";
import type { ComponentDefinition, SchemaHelpers } from "../config.ts";
import { type ImageResolver, schemaHelpers } from "./cms-markers.ts";
import { componentEntries } from "./component-lookup.ts";

// The admin and the build only lower a schema, which never runs its transforms.
const loweringHelpers: SchemaHelpers = schemaHelpers(() => {
  throw new Error("astronaut-cms: an image() prop is resolved on the site alone.");
});

/**
 * A component's props schema, built from the schema helpers when it is declared
 * as a function, and an empty object for a component that declares none.
 */
export function componentSchema(
  { props }: ComponentDefinition,
  helpers = loweringHelpers,
): z.ZodType<object> {
  if (props === undefined) return z.object({});

  return typeof props === "function" ? props(helpers) : props;
}

/**
 * Parses a component's attributes by its name, so every `.default()` and
 * transform applies, and keeps any attribute the schema does not declare, such
 * as `class`. Every `image()` prop is resolved with `resolveImage` on the way,
 * so a component receives its images as a collection's `image()` field arrives:
 * as `ImageMetadata`, or an object-store URL. MDX hands a component its
 * attributes verbatim, which is why the generated wrappers run this before
 * rendering it. Every schema is built once.
 */
export function propsResolver(
  components: Record<string, ComponentDefinition>,
  resolveImage: ImageResolver,
) {
  const helpers = schemaHelpers(resolveImage);
  const schemas = new Map(
    componentEntries(components).map(([name, def]) => [name, componentSchema(def, helpers)]),
  );

  return async (name: string, props: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const schema = schemas.get(name);

    if (!schema) throw new Error(`No component "${name}" in cms.config.`);

    const result = await schema.safeParseAsync(props);

    if (!result.success)
      throw new Error(`Invalid props for ${name}:\n${z.prettifyError(result.error)}`);

    return { ...props, ...result.data };
  };
}

// `unknown` for no members, since the intersection of nothing constrains nothing.
type UnionToIntersection<U> = [U] extends [never]
  ? unknown
  : (U extends unknown ? (union: U) => void : never) extends (intersection: infer I) => void
    ? I
    : never;

/** Which side of the schema to read: as MDX writes the props, or as the component renders them. */
type PropsSide = "input" | "output";

// The props of one definition's child components, or `never` for a leaf or
// markdown children, which drops out of the union rather than absorbing it.
type ChildProps<Definition, Side extends PropsSide> =
  Definition extends ComponentDefinition<z.ZodType<object>, infer C>
    ? [C] extends [never]
      ? never
      : [C] extends [Record<string, ComponentDefinition>]
        ? InferComponentProps<C, Side>
        : never
    : never;

type SideOf<T extends z.ZodType, Side extends PropsSide> = Side extends "input"
  ? z.input<T>
  : z.output<T>;

// Zod infers an empty object as `Record<string, never>`, which absorbs every
// prop a site adds to the type, so a component without props has none instead.
type SchemaProps<T extends z.ZodType<object>, Side extends PropsSide> =
  T extends z.ZodObject<infer Shape>
    ? [keyof Shape] extends [never]
      ? Record<never, never>
      : SideOf<T, Side>
    : SideOf<T, Side>;

/**
 * The props of every component by name, the children of each included. The
 * output is what a component renders with, every default applied, and the
 * input what MDX writes, where a prop with a `.default()` is optional.
 */
export type InferComponentProps<
  Components extends Record<string, ComponentDefinition>,
  Side extends PropsSide = "output",
> = {
  [Name in string & keyof Components]: Components[Name] extends ComponentDefinition<infer T>
    ? SchemaProps<T, Side>
    : never;
} & UnionToIntersection<
  { [Name in keyof Components]: ChildProps<Components[Name], Side> }[keyof Components]
>;

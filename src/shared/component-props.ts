import { z } from "zod";
import type { ChildrenConfig, ComponentDefinition } from "../config.ts";
import { schemaHelpers } from "./cms-markers.ts";
import { componentEntries } from "./component-lookup.ts";

/** A component's props schema, built from the schema helpers when it is declared as a function. */
export function componentSchema<T extends z.ZodType<object>>({
  props,
}: ComponentDefinition<T, ChildrenConfig>): T {
  return typeof props === "function" ? props(schemaHelpers) : props;
}

/**
 * Parses a component's attributes by its name, so every `.default()` and
 * transform applies, and keeps any attribute the schema does not declare, such
 * as `class`. MDX hands a component its attributes verbatim, which is why the
 * generated wrappers run this before rendering it. Every schema is built once.
 */
export function propsResolver(components: Record<string, ComponentDefinition>) {
  const schemas = new Map(componentEntries(components).map(([name, def]) => [name, componentSchema(def)]));

  return (name: string, props: Record<string, unknown>): Record<string, unknown> => {
    const result = schemas.get(name)?.safeParse(props);

    if (!result) throw new Error(`No component "${name}" in cms.config.`);

    if (!result.success) throw new Error(`Invalid props for ${name}:\n${z.prettifyError(result.error)}`);

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
    ? Side extends "input"
      ? z.input<T>
      : z.output<T>
    : never;
} & UnionToIntersection<{ [Name in keyof Components]: ChildProps<Components[Name], Side> }[keyof Components]>;

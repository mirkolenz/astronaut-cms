import type { ClientComponentDef, ComponentManifest } from "../../src/internal/user-config.ts";

// Stand-in for the build-time `virtual:astronaut-cms/user-config` module, which
// the admin bundle types as the full `ComponentManifest`. One component with an
// asset prop is enough to exercise MDX body validation; anything that only walks
// prop schemas takes the structural `ComponentSchemaMap`, which this satisfies.
export type { ClientComponentDef };

export const components: ComponentManifest = {
  Figure: {
    props: {
      type: "object",
      shape: { src: { type: "image" }, alt: { type: "string" } },
    },
    kind: "flow",
    source: "@/components/Figure.astro",
    defaultExport: false,
    label: "Figure",
    icon: null,
    editor: null,
  },
};

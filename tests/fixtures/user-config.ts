import type { ClientComponentDef, ComponentManifest } from "../../src/internal/user-config.ts";

// Stand-in for the build-time `virtual:astronaut-cms/user-config` module, which
// the admin bundle types as the full `ComponentManifest`. A component with an
// asset prop, and one declaring it as a child, are enough to exercise MDX body
// validation; anything that only walks prop schemas takes the structural
// `ComponentSchemaMap`, which this satisfies.
export type { ClientComponentDef };

const figure: ClientComponentDef = {
  props: {
    type: "object",
    shape: { src: { type: "image" }, alt: { type: "string" } },
  },
  kind: "flow",
  source: "@/components/Figure.astro",
  defaultExport: false,
  label: "Figure",
  description: null,
  summary: null,
  icon: null,
  editor: null,
};

export const components: ComponentManifest = {
  Figure: figure,
  Gallery: {
    ...figure,
    props: null,
    children: { Tile: { ...figure, label: "Tile", source: "@/components/Tile.astro" } },
    label: "Gallery",
    source: "@/components/Gallery.astro",
  },
};

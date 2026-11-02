import type { ClientComponentDef, ComponentManifest } from "../../src/internal/user-config.ts";
import type { ComponentIcon } from "../../src/config.ts";

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
  label: "Figure",
  description: null,
  summary: null,
  icon: null,
  editor: null,
  collections: [],
};

export const components: ComponentManifest = {
  Figure: figure,
  Gallery: {
    ...figure,
    props: { type: "object", shape: {} },
    children: { Tile: { ...figure, label: "Tile" } },
    label: "Gallery",
  },
};

export const collectionIcons: Record<string, ComponentIcon> = {};

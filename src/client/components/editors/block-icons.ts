import {
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  List,
  ListOrdered,
  Pilcrow,
  SeparatorHorizontal,
  SquareCode,
  Table,
  TextQuote,
} from "lucide-react";
import type { ComponentIcon } from "@/config";

/** The icons of the text blocks, by their names in `editors.blocks`. */
export const BLOCK_ICONS = {
  paragraph: Pilcrow,
  bulletList: List,
  numberedList: ListOrdered,
  quote: TextQuote,
  code: SquareCode,
  table: Table,
  image: Image,
  divider: SeparatorHorizontal,
} satisfies Record<string, ComponentIcon>;

/** The icon of a heading, by its depth less one. */
export const HEADING_ICONS: readonly ComponentIcon[] = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6];

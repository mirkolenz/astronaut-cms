import { titleCase } from "scule";

export const toLabel = (slug: string): string => titleCase(slug);

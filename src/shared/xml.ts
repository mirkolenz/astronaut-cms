/**
 * XML read into plain values, then checked against the shape the caller
 * expects rather than trusted.
 */
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

const parser = new XMLParser({
  // Text stays text, so a key such as `007` or ` a` arrives as written.
  parseTagValue: false,
  trimValues: false,
  htmlEntities: true,
  removeNSPrefix: true,
  ignoreDeclaration: true,
});

/** An element that may repeat, which reads as a lone value when it occurs once. */
export const xmlList = <T extends z.ZodType>(item: T) =>
  z.preprocess((value) => (value === undefined ? [] : [value].flat()), z.array(item));

/** Parse an XML document, rejecting one that is malformed or of another shape. */
export function parseXml<T extends z.ZodType>(xml: string, schema: T): z.output<T> {
  return schema.parse(parser.parse(xml, true));
}

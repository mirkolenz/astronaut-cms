import { DOMParser } from "@xmldom/xmldom";

/** Parse an XML response and reject malformed documents. */
export function parseXml(xml: string): Document {
  const document = new DOMParser({
    errorHandler: (_level, message) => {
      throw new Error(`Invalid XML: ${String(message)}`);
    },
  }).parseFromString(xml, "application/xml");

  if (!document.documentElement) throw new Error("Invalid XML: missing root element.");

  return document;
}

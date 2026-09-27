import { extractText, getDocumentProxy } from "unpdf";
import { serveExtraction } from "@/client/lib/ai/workers/extraction";

serveExtraction(async (bytes) => {
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });

  return text;
});

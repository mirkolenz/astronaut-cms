import { extractText } from "unpdf";
import { serveExtraction } from "@/client/lib/ai/workers/extraction";

serveExtraction(async (bytes) => (await extractText(bytes, { mergePages: true })).text);

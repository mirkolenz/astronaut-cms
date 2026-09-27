import mammoth from "mammoth";
import { serveExtraction } from "@/client/lib/ai/workers/extraction";

serveExtraction(async (bytes) => {
  const { value } = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });

  return value;
});

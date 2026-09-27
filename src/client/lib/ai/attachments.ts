import type { FileUIPart } from "ai";
import config from "@/client/lib/config";
import { hasAllowedExtension, mediaRef, uniqueMediaPath } from "@/shared/media";
import { uploadMedia } from "@/client/lib/media";
import { call } from "@/client/lib/api";
import { optimizeImage } from "@/client/lib/image-utils";

const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// The composer accepts images (kept as visual parts, optionally saved to the
// media library) and documents (converted to plain text in the browser so any
// model, multimodal or not, can read them). `.doc` (legacy binary) is not
// supported by mammoth, only the modern `.docx`.
export const ATTACHMENT_ACCEPT = [
  "image/*",
  "text/*",
  ".txt",
  ".md",
  "application/pdf",
  WORD_MIME,
  ".docx",
].join(",");

export interface ComposerAttachment {
  id: string;
  file: File;
  // Images only: also store the file in the media library so the assistant can
  // reference it in content. Documents are always turned into text.
  save: boolean;
}

export interface PreparedMessage {
  text: string;
  files: FileUIPart[];
}

export function isImageAttachment(file: File): boolean {
  return file.type.startsWith("image/");
}

// Extracts readable text from a document entirely client-side: PDFs via pdf.js
// (bundled by unpdf, no worker setup), Word `.docx` via mammoth, everything else
// as UTF-8 text.
async function extractDocumentText(file: File): Promise<string> {
  if (file.type === "application/pdf" || hasAllowedExtension(file.name, [".pdf"])) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });

    return text;
  }

  if (file.type === WORD_MIME || hasAllowedExtension(file.name, [".docx"])) {
    const { default: mammoth } = await import("mammoth");
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });

    return value;
  }

  return file.text();
}

// A data URL (not a blob URL), because the part is serialized into the model request.
const fileToDataUrl = async (file: File): Promise<string> =>
  `data:${file.type || "application/octet-stream"};base64,${(await file.bytes()).toBase64()}`;

async function imageToFilePart(file: File): Promise<FileUIPart> {
  return {
    type: "file",
    filename: file.name,
    mediaType: file.type,
    url: await fileToDataUrl(file),
  };
}

// Turns the composed text and attachments into a message: images become visual
// parts (and, when flagged, are uploaded to the media library), documents are
// extracted to text and folded into the prompt alongside any saved media paths.
export async function prepareMessage(
  text: string,
  attachments: ComposerAttachment[],
): Promise<PreparedMessage> {
  const files: FileUIPart[] = [];
  const savedPaths: string[] = [];
  const documents: string[] = [];

  // Nobody is asked whether to overwrite here, so every saved attachment gets a
  // free name instead. Listed once and grown as uploads land, so two attachments
  // in one message cannot replace each other either.
  const taken = new Set<string>(
    attachments.some((a) => a.save && isImageAttachment(a.file))
      ? (await call("listMedia", {})).map((file) => file.path)
      : [],
  );

  for (const { file, save } of attachments) {
    if (isImageAttachment(file)) {
      if (save) {
        const optimized = await optimizeImage(file);
        const path = uniqueMediaPath(optimized.name, taken);

        taken.add(path);
        await uploadMedia(path, optimized);
        // The model is handed the reference content stores, not the library path,
        // since the only thing it does with it is write it into a field.
        savedPaths.push(mediaRef(path, config));
        files.push(await imageToFilePart(optimized));
      } else {
        files.push(await imageToFilePart(file));
      }

      continue;
    }

    const extracted = (await extractDocumentText(file)).trim();
    documents.push(`### ${file.name}\n\n${extracted}`);
  }

  const sections = [text.trim()];

  if (savedPaths.length > 0) {
    const list = savedPaths.map((path) => `- ${path}`).join("\n");
    sections.push(
      `Attached media saved to the media library; reference these paths when using them in content:\n${list}`,
    );
  }

  if (documents.length > 0) {
    sections.push(`Attached documents:\n\n${documents.join("\n\n")}`);
  }

  return { text: sections.filter(Boolean).join("\n\n"), files };
}

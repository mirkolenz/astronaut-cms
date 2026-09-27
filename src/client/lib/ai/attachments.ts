import type { FileUIPart } from "ai";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { getStorage } from "@client/lib/storage";
import { optimizeImage } from "@client/lib/image-utils";

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
  savedPaths: string[];
}

export function isImageAttachment(file: File): boolean {
  return file.type.startsWith("image/");
}

function hasExtension(file: File, ext: string): boolean {
  return file.name.toLowerCase().endsWith(ext);
}

// Extracts readable text from a document entirely client-side: PDFs via pdf.js
// (bundled by unpdf, no worker setup), Word `.docx` via mammoth, everything else
// as UTF-8 text.
export async function extractDocumentText(file: File): Promise<string> {
  if (file.type === "application/pdf" || hasExtension(file, ".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });

    return text;
  }

  if (file.type === WORD_MIME || hasExtension(file, ".docx")) {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });

    return value;
  }

  return file.text();
}

// FileReader is callback-based, so wrap it once. A data URL (not a blob URL) is
// required because the part is serialized into the model request.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

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

  for (const { file, save } of attachments) {
    if (isImageAttachment(file)) {
      if (save) {
        const optimized = await optimizeImage(file);
        const media = await getStorage().uploadMedia(optimized.name, optimized);
        savedPaths.push(media.path);
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

  return { text: sections.filter(Boolean).join("\n\n"), files, savedPaths };
}

import { extname } from "pathe";
import type { AstroImageFormat } from "@shared/image-formats";

const MAX_DIMENSION = 2048;
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

// Single source of truth coupling each Canvas-optimizable extension to its MIME type.
// Keys are constrained to astro's accepted formats; Canvas handles a strict subset.
const MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
} as const satisfies Partial<Record<AstroImageFormat, string>>;

type OptimizableExtension = keyof typeof MIME_TYPES;

function getExtension(fileName: string): string {
  return extname(fileName).slice(1).toLowerCase();
}

function isOptimizableExtension(ext: string): ext is OptimizableExtension {
  return Object.hasOwn(MIME_TYPES, ext);
}

/**
 * Optimize an image file by resizing and/or compressing it.
 *
 * - Non-optimizable files (SVG, GIF, non-images) are returned as-is.
 * - Images already within dimension and size limits are returned as-is.
 * - JPEG/WebP/AVIF are compressed with decreasing quality until under 8 MB.
 * - PNG is resized but not quality-compressed (Canvas API doesn't support lossy PNG).
 * - If AVIF canvas export is unsupported by the browser, the original is returned.
 */
export async function optimizeImage(file: File): Promise<File> {
  const ext = getExtension(file.name);
  if (!isOptimizableExtension(ext)) return file;

  const img = await loadImage(file);
  const needsResize = img.naturalWidth > MAX_DIMENSION || img.naturalHeight > MAX_DIMENSION;
  const needsCompress = file.size > MAX_FILE_SIZE;

  if (!needsResize && !needsCompress) return file;

  const { width, height } = scaledDimensions(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);

  const mimeType = MIME_TYPES[ext];

  if (mimeType === "image/png") {
    const blob = await canvasToBlob(canvas, mimeType);
    if (!blob) return file;
    return new File([blob], file.name, {
      type: mimeType,
      lastModified: file.lastModified,
    });
  }

  const qualities = [0.92, 0.85, 0.7, 0.5];
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, mimeType, quality);
    if (!blob) return file; // browser doesn't support this format (e.g. AVIF)
    if (blob.size <= MAX_FILE_SIZE) {
      return new File([blob], file.name, {
        type: mimeType,
        lastModified: file.lastModified,
      });
    }
  }

  // Even at lowest quality it's over 8 MB — return the last attempt anyway
  // as it's still likely smaller than the original.
  const blob = await canvasToBlob(canvas, mimeType, qualities[qualities.length - 1]);
  if (!blob) return file;
  return new File([blob], file.name, {
    type: mimeType,
    lastModified: file.lastModified,
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function scaledDimensions(width: number, height: number): { width: number; height: number } {
  if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    return { width, height };
  }
  const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

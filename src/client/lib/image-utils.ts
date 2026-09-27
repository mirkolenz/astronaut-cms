import { extname } from "pathe";
import config from "@client/lib/config";
import { mediaContentType } from "@shared/media";
import type { ImageOutputFormat, ResolvedImageOptimization } from "@integration/types";
import type { AstroImageFormat } from "@shared/image-formats";

/** How many quality attempts the `maxFileSize` ladder makes, endpoints included. */
const QUALITY_STEPS = 4;

// The Canvas-encodable subset of astro's accepted input formats, which is also what
// an `ImageOutputFormat` may name. Content types come from the library's own table
// rather than a second one here, so the two can never disagree.
const OPTIMIZABLE_FORMATS = {
  jpg: true,
  jpeg: true,
  png: true,
  webp: true,
  avif: true,
} as const satisfies Partial<Record<AstroImageFormat, true>>;

type OptimizableExtension = keyof typeof OPTIMIZABLE_FORMATS;

const mimeType = (ext: OptimizableExtension): string => mediaContentType(`.${ext}`);

function getExtension(fileName: string): string {
  return extname(fileName).slice(1).toLowerCase();
}

function isOptimizableExtension(ext: string): ext is OptimizableExtension {
  return Object.hasOwn(OPTIMIZABLE_FORMATS, ext);
}

/**
 * Optimize an image file by resizing, converting and/or compressing it, as
 * `media.optimizeImages` configures.
 *
 * - With optimization disabled, every file is returned as-is.
 * - Non-optimizable files (SVG, GIF, non-images) are returned as-is.
 * - Images already within every limit, in the target format, are returned as-is.
 * - Lossy output is encoded at decreasing quality until it fits `maxFileSize`.
 * - PNG output is resized but not quality-compressed (Canvas has no lossy PNG).
 * - If the target format is unsupported by the browser (AVIF, typically), the
 *   original is returned.
 */
export async function optimizeImage(file: File): Promise<File> {
  const settings = config.imageOptimization;

  if (!settings) return file;

  const ext = getExtension(file.name);

  if (!isOptimizableExtension(ext)) return file;

  const target = mimeType(settings.format ?? ext);
  const img = await loadImage(file);
  const { width, height } = scaledDimensions(img.naturalWidth, img.naturalHeight, settings);
  const unchanged =
    width === img.naturalWidth &&
    height === img.naturalHeight &&
    target === mimeType(ext) &&
    file.size <= settings.maxFileSize;

  if (unchanged) return file;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);

  const name = settings.format ? withExtension(file.name, settings.format) : file.name;

  const encode = async (quality?: number): Promise<File | null> => {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, target, quality);
    });

    return blob && new File([blob], name, { type: target, lastModified: file.lastModified });
  };

  // Canvas ignores `quality` for PNG, so the ladder would encode the same bytes
  // four times over.
  if (target === "image/png") return (await encode()) ?? file;

  let encoded: File | null = null;

  for (const quality of qualityLadder(settings)) {
    encoded = await encode(quality);

    if (!encoded) return file; // browser doesn't support this format (e.g. AVIF)
    if (encoded.size <= settings.maxFileSize) return encoded;
  }

  // Even at the lowest quality it is over the limit — keep that attempt anyway,
  // as it's still likely smaller than the original.
  return encoded ?? file;
}

/** Quality attempts from `quality` down to `minQuality`, evenly spaced. */
function qualityLadder({ quality, minQuality }: ResolvedImageOptimization): number[] {
  if (minQuality >= quality) return [quality];

  const step = (quality - minQuality) / (QUALITY_STEPS - 1);

  return Array.from({ length: QUALITY_STEPS }, (_, i) => quality - i * step);
}

function withExtension(fileName: string, format: ImageOutputFormat): string {
  const stem = fileName.slice(0, fileName.length - extname(fileName).length);

  return `${stem}.${format === "jpeg" ? "jpg" : format}`;
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

function scaledDimensions(
  width: number,
  height: number,
  { maxWidth, maxHeight }: ResolvedImageOptimization,
): { width: number; height: number } {
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);

  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

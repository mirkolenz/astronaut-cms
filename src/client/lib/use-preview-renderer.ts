import { useState, useEffect, useRef } from "react";
import morphdom from "morphdom";
import { renderMarkdown } from "./preview-renderer";
import { resolvePreviewAssetPaths } from "./asset-utils";

/**
 * Renders markdown to HTML. Callers are expected to debounce the `body`
 * input themselves — this hook renders immediately when `body` changes.
 */
export function usePreviewRenderer(body: string, contentFilePath?: string) {
  const [html, setHtml] = useState("");
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    setIsRendering(true);

    renderMarkdown(body)
      .then((result) => {
        if (generation !== generationRef.current) return;
        const resolved = contentFilePath
          ? resolvePreviewAssetPaths(result, contentFilePath)
          : result;
        setHtml(resolved);
        setError(null);
      })
      .catch((err) => {
        if (generation !== generationRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (generation === generationRef.current) {
          setIsRendering(false);
        }
      });
  }, [body, contentFilePath]);

  return { html, isRendering, error };
}

/**
 * Incrementally patches a DOM element to match the given HTML using morphdom.
 * Unchanged elements (images, iframes, etc.) are preserved in-place,
 * preventing unnecessary network reloads and visual flashes.
 */
export function useMorphedHtml(html: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!html) {
      el.innerHTML = "";
      return;
    }

    // Build a target element with the new HTML, then let morphdom
    // diff only the children — the container element itself is untouched.
    const target = el.cloneNode(false) as HTMLElement;
    target.innerHTML = html;
    morphdom(el, target, { childrenOnly: true });
  }, [html]);

  return ref;
}

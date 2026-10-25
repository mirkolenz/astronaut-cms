/**
 * Text extraction from attached documents, run in a worker per file. The parsers
 * read bytes anyone may have crafted, so they get no DOM, no admin state and no
 * lifetime beyond the one file.
 */

type ExtractionResult = { text: string } | { error: string };

const TIMEOUT_MS = 60_000;

/** Answers the one message a worker receives with the text `extract` reads from it. */
export function serveExtraction(
  extract: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>,
): void {
  globalThis.onmessage = async ({ data }: MessageEvent<Uint8Array<ArrayBuffer>>) => {
    const result: ExtractionResult = await extract(data).then(
      (text) => ({ text }),
      (error: unknown) => ({ error: String(error) }),
    );

    postMessage(result);
  };
}

/**
 * Extracts the text of `file` in a fresh worker built from `workerUrl`. A worker
 * loaded from a URL runs under the policy of its own response, and a site's
 * static assets carry none. One started from a blob inherits the admin's instead,
 * so a parser that is taken over can reach no host the admin could not.
 */
export async function extractInWorker(workerUrl: string, file: File): Promise<string> {
  const source = `import ${JSON.stringify(new URL(workerUrl, location.href).href)};`;
  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(blobUrl, { type: "module", name: file.name });
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const timeout = setTimeout(
    () => reject(new Error(`Reading ${file.name} timed out.`)),
    TIMEOUT_MS,
  );

  worker.onmessage = ({ data }: MessageEvent<ExtractionResult>) => {
    if ("text" in data) resolve(data.text);
    else reject(new Error(data.error));
  };

  worker.onerror = (event) => {
    event.preventDefault();
    reject(new Error(event.message || `Reading ${file.name} failed.`));
  };

  try {
    const bytes = await file.bytes();
    worker.postMessage(bytes, [bytes.buffer]);

    return await promise;
  } finally {
    clearTimeout(timeout);
    worker.terminate();
    URL.revokeObjectURL(blobUrl);
  }
}

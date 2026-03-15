export function glob(opts: { pattern?: string | string[]; base?: string }) {
  return {
    __cmsPattern: opts.pattern ?? null,
    __cmsBase: opts.base ?? null,
  };
}

export function file(fileName: string, _opts?: unknown) {
  return {
    __cmsFileName: fileName ?? null,
  };
}

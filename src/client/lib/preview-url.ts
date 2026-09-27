function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.join("-") ?? ""
  );
}

export function buildPreviewUrl(pattern: string, branch: string): string {
  // Replacer functions, so a `$` in a branch name is not read as a replacement pattern.
  return pattern.replaceAll("{branch}", () => branch).replaceAll("{slug}", () => slugify(branch));
}

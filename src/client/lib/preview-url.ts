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
  return pattern.replace(/\{branch\}/g, branch).replace(/\{slug\}/g, slugify(branch));
}

/**
 * Parsing an `owner/repo` pair, which both the build (resolving the config) and
 * the server (calling the API) need. It lives here rather than beside either of
 * them because an import in the other direction drags a runtime module into the
 * Astro config, where the CMS's virtual modules do not exist yet.
 */
export function parseRepo(repo: string): { owner: string; repo: string } {
  const parts = repo.split("/");
  const [owner, name] = parts;

  if (parts.length !== 2 || !owner || !name) {
    throw new Error(`Invalid GitHub repo: ${repo}`);
  }

  return { owner, repo: name };
}

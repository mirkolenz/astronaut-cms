// Write-access verification using only the Fetch API, so it runs unchanged in
// the browser and in any server/edge runtime (Workers, Deno, Node). Mirrors what
// the Octokit/Gitbeaker SDKs do for a single permission lookup.
//
// Every injected route gates on the same thing — the caller holds a token with
// write access to the configured repository — so the gate and its cache live
// here rather than once per route.

import { jsonError } from "./response.ts";
import { unreachable } from "./unreachable.ts";
import { joinUrl } from "./url.ts";

// GitLab access levels: 30 = Developer (can push to non-protected branches and open MRs).
const MIN_GITLAB_WRITE_ACCESS_LEVEL = 30;

export function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");

  if (!owner || !name) throw new Error(`Invalid GitHub repo: ${repo}`);

  return { owner, repo: name };
}

export async function verifyGitHubWriteAccess(token: string, repo: string): Promise<void> {
  const { owner, repo: name } = parseRepo(repo);

  // The User-Agent is required by the GitHub API; browsers ignore the override
  // and send their own, which is also accepted.
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "astronaut-cms",
    },
  });

  const data = res.ok ? ((await res.json()) as { permissions?: { push?: boolean } }) : null;

  if (!data?.permissions?.push) {
    throw new Error(`You need write access to ${repo} to use this CMS.`);
  }
}

export async function verifyGitLabWriteAccess(
  token: string,
  project: string,
  instanceUrl: string,
): Promise<void> {
  const res = await fetch(joinUrl(instanceUrl, `api/v4/projects/${encodeURIComponent(project)}`), {
    headers: { authorization: `Bearer ${token}` },
  });

  const data = res.ok
    ? ((await res.json()) as {
        permissions?: {
          project_access?: { access_level?: number } | null;
          group_access?: { access_level?: number } | null;
        };
      })
    : null;
  const projectAccess = data?.permissions?.project_access?.access_level ?? 0;
  const groupAccess = data?.permissions?.group_access?.access_level ?? 0;

  if (Math.max(projectAccess, groupAccess) < MIN_GITLAB_WRITE_ACCESS_LEVEL) {
    throw new Error(`You need write access to ${project} to use this CMS.`);
  }
}

/** The storage identity an injected route verifies its callers against. */
export interface AccessConfig {
  storageType: "local" | "github" | "gitlab";
  github?: { repo: string };
  gitlab?: { project: string; instanceUrl: string };
}

/** The gate's slice of the CMS config, so no route has to spell the three fields itself. */
export function accessConfig(config: AccessConfig): AccessConfig {
  return { storageType: config.storageType, github: config.github, gitlab: config.gitlab };
}

/**
 * How long a verified token is taken at its word. It is the window in which a
 * revoked collaborator can still spend the server-side capabilities this gate
 * guards — the AI gateway credential and the object store — so it is kept to
 * roughly one editing action rather than one editing session.
 */
const ACCESS_CACHE_TTL = 60 * 1000;

// Per-token results, so a streaming turn or a burst of media calls does not
// re-hit the Git API on every call. Bounded by token count and a short TTL.
const accessCache = new Map<string, number>();

/**
 * Throws unless the caller may write to the configured repository. This is the
 * only authorization an injected route has: it holds no session of its own, so
 * the editor's Git token is both the identity and the permission.
 *
 * Note what that conflates: write access to the repository also entitles the
 * caller to the shared AI gateway credential and to administering the object
 * store, neither of which the Git provider knows about. Anyone trusted to push
 * is trusted with both.
 */
export async function verifyWriteAccess(
  token: string | undefined,
  config: AccessConfig,
): Promise<void> {
  // Local storage is dev-only and carries no provider identity to verify against.
  if (config.storageType === "local") return;

  if (!token) throw new Error("Not authenticated");

  const now = Date.now();
  const cached = accessCache.get(token);

  if (cached != null && cached > now) return;

  // Exhaustive on purpose: a storage type with no verification of its own must
  // fail closed rather than fall through and cache the token as valid.
  switch (config.storageType) {
    case "github":
      if (!config.github) throw new Error("GitHub storage is not configured");

      await verifyGitHubWriteAccess(token, config.github.repo);
      break;

    case "gitlab":
      if (!config.gitlab) throw new Error("GitLab storage is not configured");

      await verifyGitLabWriteAccess(token, config.gitlab.project, config.gitlab.instanceUrl);
      break;

    default:
      unreachable(config.storageType, "Cannot verify access for storage type");
  }

  // Evict expired entries so the cache stays bounded by currently-valid tokens,
  // not every token the warm instance has ever seen.
  for (const [key, expiry] of accessCache) {
    if (expiry <= now) accessCache.delete(key);
  }

  accessCache.set(token, now + ACCESS_CACHE_TTL);
}

/**
 * The bearer token of a request, if it carries one. It is also the only caller
 * identity an injected route has, so a per-editor limit is keyed by it.
 */
export function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
}

/** The writing side of the convention {@link bearerToken} reads. */
export function bearer(token: string | undefined): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * The gate as a route uses it: null when the caller may write, otherwise the
 * 403 to return. Both injected routes open the same way, so they share the
 * answer as well as the check.
 */
export async function denyUnlessWritable(
  request: Request,
  config: AccessConfig,
): Promise<Response | null> {
  try {
    await verifyWriteAccess(bearerToken(request), config);

    return null;
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Forbidden", 403);
  }
}

// Write-access verification using only the Fetch API, so it runs unchanged in
// the browser and in any server/edge runtime (Workers, Deno, Node). Mirrors what
// the Octokit/Gitbeaker SDKs do for a single permission lookup.

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
  const base = instanceUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/v4/projects/${encodeURIComponent(project)}`, {
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

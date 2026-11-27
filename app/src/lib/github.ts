const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const USER_REPOS_URL =
  "https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member";
const CREATE_REPO_URL = "https://api.github.com/user/repos";
const MAX_REPO_PAGES = 5;

export type GitHubUserProfile = {
  githubId: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type GitHubRepoItem = {
  githubRepoId: number;
  fullName: string;
  name: string;
  owner: string;
  isPrivate: boolean;
  htmlUrl: string;
  cloneUrl: string | null;
  description: string | null;
  defaultBranch: string | null;
  language: string | null;
  pushedAt: string | null;
};

export function getOAuthConfig() {
  const clientId = (process.env.GITHUB_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GITHUB_CLIENT_SECRET || "").trim();
  const vercelOrigin = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "";
  const publicUrl = (
    process.env.APP_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    vercelOrigin ||
    "http://localhost:8787"
  )
    .trim()
    .replace(/\/+$/, "");
  return {
    configured: clientId !== "" && clientSecret !== "",
    clientId,
    clientSecret,
    publicUrl,
    redirectUri: `${publicUrl}/auth/github/callback`,
  };
}

function scrub(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function nextLinkOf(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="([^"]+)"/i.exec(part);
    if (match && match[2]?.toLowerCase() === "next" && match[1]) {
      return match[1];
    }
  }
  return undefined;
}

function parseRepo(raw: unknown): GitHubRepoItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const id = item.id;
  const fullName = item.full_name;
  const name = item.name;
  const ownerObj = item.owner as Record<string, unknown> | undefined;
  const owner = ownerObj?.login;
  const htmlUrl = item.html_url;
  const isPrivate = item.private;
  if (
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    typeof fullName !== "string" ||
    typeof name !== "string" ||
    typeof owner !== "string" ||
    typeof htmlUrl !== "string" ||
    typeof isPrivate !== "boolean"
  ) {
    return null;
  }
  return {
    githubRepoId: id,
    fullName,
    name,
    owner,
    isPrivate,
    htmlUrl,
    cloneUrl: strOrNull(item.clone_url),
    description: strOrNull(item.description),
    defaultBranch: strOrNull(item.default_branch),
    language: strOrNull(item.language),
    pushedAt: strOrNull(item.pushed_at),
  };
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = getOAuthConfig();
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "read:user user:email repo",
  }).toString();
  return url.toString();
}

export async function exchangeGitHubCode(code: string): Promise<string> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const response = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const token = data?.access_token;
  if (response.ok && typeof token === "string" && token !== "") {
    return token;
  }
  const reason =
    strOrNull(data?.error_description) ||
    strOrNull(data?.error) ||
    `HTTP ${response.status}`;
  throw new Error(scrub(`GitHub code exchange failed: ${reason}`, clientSecret));
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUserProfile> {
  const { clientSecret } = getOAuthConfig();
  const response = await fetch(USER_URL, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "software-factory",
    },
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !response.ok ||
    !data ||
    typeof data.id !== "number" ||
    typeof data.login !== "string" ||
    data.login === ""
  ) {
    throw new Error(scrub(`GitHub user lookup failed (HTTP ${response.status})`, clientSecret));
  }
  return {
    githubId: data.id,
    login: data.login,
    name: strOrNull(data.name),
    email: strOrNull(data.email),
    avatarUrl: strOrNull(data.avatar_url),
  };
}

export async function listGitHubRepos(accessToken: string): Promise<GitHubRepoItem[]> {
  const { clientSecret } = getOAuthConfig();
  const seen = new Map<number, GitHubRepoItem>();
  let nextUrl: string | undefined = USER_REPOS_URL;

  for (let page = 0; page < MAX_REPO_PAGES && nextUrl; page += 1) {
    const response = await fetch(nextUrl, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "software-factory",
      },
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) {
      throw new Error(scrub(`GitHub repo list failed (HTTP ${response.status})`, clientSecret));
    }

    for (const raw of data) {
      const parsed = parseRepo(raw);
      if (parsed && !seen.has(parsed.githubRepoId)) {
        seen.set(parsed.githubRepoId, parsed);
      }
    }
    nextUrl = nextLinkOf(response.headers.get("link"));
  }

  return [...seen.values()];
}

export async function createGitHubRepo(
  accessToken: string,
  input: { name: string; description?: string; isPrivate: boolean; autoInit?: boolean },
): Promise<GitHubRepoItem> {
  const { clientSecret } = getOAuthConfig();
  const response = await fetch(CREATE_REPO_URL, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "user-agent": "software-factory",
    },
    body: JSON.stringify({
      name: input.name,
      description: input.description || undefined,
      private: input.isPrivate,
      auto_init: input.autoInit ?? false,
    }),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const errors = Array.isArray(data?.errors)
      ? data.errors
          .map((e) => (typeof e === "object" && e && "message" in e ? String((e as { message?: unknown }).message) : ""))
          .filter(Boolean)
          .join("; ")
      : "";
    const msg = errors || strOrNull(data?.message) || `HTTP ${response.status}`;
    throw new Error(scrub(`Could not create GitHub repo: ${msg}`, clientSecret));
  }

  const parsed = parseRepo(data);
  if (!parsed) {
    throw new Error("GitHub returned an unexpected repository payload");
  }
  return parsed;
}

export type AddCollaboratorResult =
  | { kind: "already_collaborator" }
  | { kind: "invited"; invitationId: number | null };

export async function addRepoCollaborator(
  accessToken: string,
  input: { owner: string; repo: string; username: string; permission?: "pull" | "push" | "admin" },
): Promise<AddCollaboratorResult> {
  const { clientSecret } = getOAuthConfig();
  const url = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/collaborators/${encodeURIComponent(input.username)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "user-agent": "software-factory",
    },
    body: JSON.stringify({ permission: input.permission ?? "push" }),
    cache: "no-store",
  });

  if (response.status === 204) {
    return { kind: "already_collaborator" };
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.status === 201) {
    const invId = typeof data?.id === "number" && Number.isInteger(data.id) ? data.id : null;
    return { kind: "invited", invitationId: invId };
  }

  const msg = strOrNull(data?.message) || `HTTP ${response.status}`;
  throw new Error(scrub(`Could not add @${input.username} as collaborator: ${msg}`, clientSecret));
}

export async function acceptRepoInvitation(
  botAccessToken: string,
  invitationId: number,
): Promise<boolean> {
  const url = `https://api.github.com/user/repository_invitations/${encodeURIComponent(String(invitationId))}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${botAccessToken}`,
      "user-agent": "software-factory",
    },
    cache: "no-store",
  });
  return response.status === 204;
}

export async function findPendingRepoInvitationId(
  botAccessToken: string,
  fullName: string,
): Promise<number | null> {
  const response = await fetch("https://api.github.com/user/repository_invitations?per_page=100", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${botAccessToken}`,
      "user-agent": "software-factory",
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data)) return null;
  const target = fullName.toLowerCase();
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const repoObj = rec.repository as Record<string, unknown> | undefined;
    const repoFull = typeof repoObj?.full_name === "string" ? repoObj.full_name.toLowerCase() : "";
    if (repoFull === target && typeof rec.id === "number" && Number.isInteger(rec.id)) {
      return rec.id;
    }
  }
  return null;
}

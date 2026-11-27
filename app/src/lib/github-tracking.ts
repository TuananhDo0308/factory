// Tracks a project's GitHub repository: a full import when tracking starts (or on Re-sync),
// then a webhook keeps epics, tickets, staging merges and prototype branches current.
import { randomToken, sealToken, unsealToken } from "@/lib/crypto";
import { upsertEpicWithTickets } from "@/lib/epic-store";
import { emitFactoryEvent } from "@/lib/events";
import { getOAuthConfig } from "@/lib/github";
import {
  findIssueNumbers,
  findPrototypeFolder,
  findRepoInText,
  isUnreachableUrl,
  repoEventToDelivery,
  issuesClosedByPullRequest,
  linkedPullRequest,
  parseEpicPlan,
  parseFactoryComment,
  parseFactoryCommit,
  parseRepoLink,
  ticketsFromPlan,
  type GithubIssueLite,
  type RepoRef,
} from "@/lib/github-sync";
import { prisma } from "@/lib/prisma";
import { upsertProjectPrototype } from "@/lib/prototype-server";

// GitHub Enterprise (or a local stand-in) via GITHUB_API_URL.
const API = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
const STAGING = "staging";
const WEBHOOK_EVENTS = ["issues", "issue_comment", "push", "create", "pull_request"];

export class GithubTrackingError extends Error {}

type TrackedProject = {
  id: string;
  userId: string;
  githubFullName: string | null;
  githubSyncToken: string | null;
};

// ---------------------------------------------------------------- GitHub API

async function gh<T>(token: string, path: string, init?: RequestInit & { raw?: boolean }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: init?.raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GithubTrackingError(`GitHub ${res.status} on ${path}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return (init?.raw ? await res.text() : await res.json()) as T;
}

type RawIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  labels: Array<{ name?: string } | string>;
  pull_request?: unknown;
};

function toLite(i: RawIssue): GithubIssueLite {
  return {
    number: i.number,
    title: i.title,
    body: i.body || "",
    state: i.state,
    labels: i.labels.map((l) => (typeof l === "string" ? l : l.name || "")).filter(Boolean),
    url: i.html_url,
  };
}

async function listIssues(token: string, repo: string): Promise<GithubIssueLite[]> {
  const out: GithubIssueLite[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const rows = await gh<RawIssue[]>(token, `/repos/${repo}/issues?state=all&per_page=100&page=${page}`);
    out.push(...rows.filter((r) => !r.pull_request).map(toLite));
    if (rows.length < 100) break;
  }
  return out;
}

type RawCommit = { sha: string; commit: { message: string; committer?: { date?: string } } };

async function listStagingCommits(token: string, repo: string) {
  const out: Array<{ sha: string; message: string; at: Date }> = [];
  for (let page = 1; page <= 5; page += 1) {
    let rows: RawCommit[];
    try {
      rows = await gh<RawCommit[]>(token, `/repos/${repo}/commits?sha=${STAGING}&per_page=100&page=${page}`);
    } catch (e) {
      if (e instanceof GithubTrackingError && /GitHub (404|409)/.test(e.message)) return out; // no staging yet
      throw e;
    }
    out.push(
      ...rows.map((r) => ({ sha: r.sha, message: r.commit.message, at: new Date(r.commit.committer?.date || Date.now()) })),
    );
    if (rows.length < 100) break;
  }
  return out.reverse(); // oldest first
}

// ---------------------------------------------------------------- writes

/** Records new-factory's merges and reverts (oldest first); returns the epics they touch. */
async function applyStagingCommits(
  projectId: string,
  commits: Array<{ sha: string; message: string; at: Date }>,
): Promise<number[]> {
  const epics = new Set<number>();
  for (const c of commits) {
    const fc = parseFactoryCommit(c.message);
    if (!fc) continue;
    const row = await prisma.projectIssue.findFirst({
      where: { projectId, githubIssueNumber: fc.issue, NOT: { tier: "epic" } },
      select: { id: true, epicNumber: true },
    });
    if (!row) continue;
    await prisma.projectIssue.update({
      where: { id: row.id },
      // The status moves here too, so the board is right even if re-reading the epic fails.
      data:
        fc.type === "merge"
          ? { mergedSha: c.sha, mergedAt: c.at, revertedAt: null, status: "passed" }
          : { revertedAt: c.at, status: "ready" },
    });
    if (row.epicNumber) epics.add(row.epicNumber);
  }
  return [...epics];
}

/** Re-reads one epic and its tickets and writes them to the board. */
async function syncEpic(
  project: TrackedProject,
  token: string,
  epicNumber: number,
  known?: Map<number, GithubIssueLite>,
): Promise<boolean> {
  const repo = project.githubFullName!;
  const fetchIssue = async (n: number) =>
    known?.get(n) ?? toLite(await gh<RawIssue>(token, `/repos/${repo}/issues/${n}`));
  const epic = await fetchIssue(epicNumber);
  const plan = parseEpicPlan(epic.body);
  if (!plan) return false;

  const numbers = plan.waves.flatMap((w) => (w.tickets || []).map((t) => t.issue)).filter((n) => Number.isInteger(n));
  const issues = new Map<number, GithubIssueLite>();
  for (const n of numbers) issues.set(n, await fetchIssue(n));

  const rows = await prisma.projectIssue.findMany({
    where: { projectId: project.id, githubIssueNumber: { in: numbers } },
    select: { githubIssueNumber: true, status: true, mergedSha: true, revertedAt: true },
  });
  const merges = new Map<number, { merged: boolean; reverted: boolean }>();
  const current = new Map<number, string>();
  for (const r of rows) {
    if (!r.githubIssueNumber) continue;
    merges.set(r.githubIssueNumber, { merged: Boolean(r.mergedSha), reverted: Boolean(r.revertedAt) });
    current.set(r.githubIssueNumber, r.status);
  }

  await upsertEpicWithTickets({
    project,
    epic: { number: epicNumber, title: epic.title, url: epic.url },
    tickets: ticketsFromPlan(plan, issues, merges, current),
  });
  for (const [n, issue] of issues) {
    // The newest pull request that references the ticket (a person's, or one that "Closes #n").
    const timeline = await gh<Parameters<typeof linkedPullRequest>[0]>(
      token,
      `/repos/${repo}/issues/${n}/timeline?per_page=100`,
    ).catch(() => []);
    const pr = linkedPullRequest(timeline);
    await prisma.projectIssue.updateMany({
      where: { projectId: project.id, githubIssueNumber: n },
      data: {
        githubState: issue.state,
        githubLabelsJson: JSON.stringify(issue.labels),
        ...(pr ? { githubPrNumber: pr.number, githubPrUrl: pr.url, githubPrState: pr.state } : {}),
      },
    });
  }
  await prisma.projectIssue.updateMany({
    where: { projectId: project.id, githubIssueNumber: epicNumber },
    data: { githubState: epic.state, githubLabelsJson: JSON.stringify(epic.labels) },
  });
  return true;
}

/** Shows the prototype a prototype/<batch> branch holds. */
async function syncPrototypeBranch(project: TrackedProject, token: string, branch: string) {
  const repo = project.githubFullName!;
  const ref = encodeURIComponent(branch);
  const tree = await gh<{ sha: string; tree: Array<{ path: string; type: string }> }>(
    token,
    `/repos/${repo}/git/trees/${ref}?recursive=1`,
  );
  const folder = findPrototypeFolder(tree.tree.filter((t) => t.type === "blob").map((t) => t.path));
  if (folder === null) return;
  const [html, manifestText] = await Promise.all([
    gh<string>(token, `/repos/${repo}/contents/${folder}index.html?ref=${ref}`, { raw: true }),
    gh<string>(token, `/repos/${repo}/contents/${folder}prototype.json?ref=${ref}`, { raw: true }).catch(() => "{}"),
  ]);
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(manifestText) as Record<string, unknown>;
  } catch {
    manifest = {};
  }
  const batch = branch.replace(/^prototype\//, "");
  await upsertProjectPrototype({
    projectId: project.id,
    userId: project.userId,
    slug: `${batch}-prototype`,
    title: typeof manifest.title === "string" && manifest.title ? manifest.title : `${batch} prototype`,
    kind: "whole_flow",
    binding: manifest.binding === "look" ? "look" : "flow",
    htmlContent: html,
    manifest,
    localPath: `${folder}index.html`,
    branchName: branch,
    commitSha: tree.sha,
  });
}

function notifyBoard(project: TrackedProject, payload: Record<string, unknown>) {
  emitFactoryEvent({ type: "issue:updated", userId: project.userId, projectId: project.id, runId: null, payload });
}

// ---------------------------------------------------------------- public API

function tokenOf(project: TrackedProject): string {
  if (!project.githubSyncToken) throw new GithubTrackingError("Tracking has no GitHub token; turn it on again.");
  return unsealToken(project.githubSyncToken, getOAuthConfig().clientSecret);
}

/** Imports everything the factory left on the repository. */
export async function fullSync(project: TrackedProject, tokenOverride?: string) {
  const token = tokenOverride ?? tokenOf(project);
  const repo = project.githubFullName!;
  try {
    const issues = await listIssues(token, repo);
    const byNumber = new Map(issues.map((i) => [i.number, i]));
    const epics = issues.filter((i) => parseEpicPlan(i.body)).map((i) => i.number);
    for (const n of epics) await syncEpic(project, token, n, byNumber);
    await applyStagingCommits(project.id, await listStagingCommits(token, repo));
    for (const n of epics) await syncEpic(project, token, n, byNumber); // statuses follow the merges

    const refs = await gh<Array<{ ref: string }>>(token, `/repos/${repo}/git/matching-refs/heads/prototype/`);
    for (const r of refs) await syncPrototypeBranch(project, token, r.ref.replace(/^refs\/heads\//, ""));

    await prisma.project.update({
      where: { id: project.id },
      data: { githubSyncedAt: new Date(), githubSyncError: null },
    });
    notifyBoard(project, { github: "synced", epics: epics.length });
    return { epics: epics.length, prototypes: refs.length };
  } catch (e) {
    await prisma.project.update({
      where: { id: project.id },
      data: { githubSyncError: (e as Error).message.slice(0, 500) },
    });
    throw e;
  }
}

/** Turns tracking on: checks the repository, installs the webhook, imports everything. */
export async function trackRepository(params: { projectId: string; link: string; token: string }) {
  const repoRef = parseRepoLink(params.link);
  if (!repoRef) throw new GithubTrackingError("That is not a GitHub repository link.");

  const { publicUrl, clientSecret } = getOAuthConfig();
  // GitHub cannot call a local URL: import now, and keep it current with Re-sync instead of a webhook.
  const canReceiveWebhooks = !isUnreachableUrl(publicUrl);

  const repo = await gh<{ id: number; full_name: string; html_url: string; default_branch: string; owner: { login: string }; private: boolean }>(
    params.token,
    `/repos/${repoRef.fullName}`,
  );
  const existing = await prisma.project.findUniqueOrThrow({ where: { id: params.projectId } });
  if (existing.githubWebhookId && existing.githubFullName && existing.githubSyncToken) {
    await gh(tokenOf(existing), `/repos/${existing.githubFullName}/hooks/${existing.githubWebhookId}`, { method: "DELETE" }).catch(() => {});
  }

  const secret = randomToken(32);
  const hook = canReceiveWebhooks
    ? await gh<{ id: number }>(params.token, `/repos/${repo.full_name}/hooks`, {
        method: "POST",
        body: JSON.stringify({
          name: "web",
          active: true,
          events: WEBHOOK_EVENTS,
          config: {
            url: `${publicUrl}/api/github/webhook?project=${encodeURIComponent(params.projectId)}`,
            content_type: "json",
            secret,
            insecure_ssl: "0",
          },
        }),
      })
    : null;

  const project = await prisma.project.update({
    where: { id: params.projectId },
    data: {
      githubFullName: repo.full_name,
      githubUrl: repo.html_url,
      githubOwner: repo.owner.login,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      githubTrackedAt: new Date(),
      githubWebhookId: hook?.id ?? null,
      // Polling starts from now; the full import below covers everything before.
      githubEventsEtag: null,
      githubLastEventId: null,
      githubWebhookSecret: hook ? sealToken(secret, clientSecret) : null,
      githubSyncToken: sealToken(params.token, clientSecret),
      githubSyncError: null,
    },
  });
  return fullSync(project);
}

/** Turns tracking off and removes the webhook from the repository. */
export async function untrackRepository(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.githubWebhookId && project.githubFullName && project.githubSyncToken) {
    await gh(tokenOf(project), `/repos/${project.githubFullName}/hooks/${project.githubWebhookId}`, {
      method: "DELETE",
    }).catch(() => {});
  }
  await prisma.project.update({
    where: { id: projectId },
    data: {
      githubTrackedAt: null,
      githubWebhookId: null,
      githubWebhookSecret: null,
      githubSyncToken: null,
      githubSyncError: null,
    },
  });
}

/** The secret a delivery for this project must be signed with, or null when not tracked. */
export function webhookSecretOf(project: { githubWebhookSecret: string | null }): string | null {
  if (!project.githubWebhookSecret) return null;
  try {
    return unsealToken(project.githubWebhookSecret, getOAuthConfig().clientSecret);
  } catch {
    return null;
  }
}

type WebhookPayload = {
  pull_request?: { number: number; html_url: string; title?: string; body?: string | null; state: string; merged_at?: string | null };
  ref?: string;
  ref_type?: string;
  size?: number;
  commits?: Array<{ id: string; message: string; timestamp: string }>;
  issue?: RawIssue;
  comment?: { body?: string };
};

/** Applies one webhook delivery. */
export async function handleWebhookEvent(project: TrackedProject, event: string, payload: WebhookPayload) {
  const token = tokenOf(project);

  if (event === "push" && payload.ref === `refs/heads/${STAGING}`) {
    const commits = payload.commits ?? [];
    if ((payload.size ?? commits.length) > commits.length) return fullSync(project); // payload was truncated
    const epics = await applyStagingCommits(
      project.id,
      commits.map((c) => ({ sha: c.id, message: c.message, at: new Date(c.timestamp) })),
    );
    for (const n of epics) await syncEpic(project, token, n);
    notifyBoard(project, { github: "staging", epics });
    return;
  }

  const prototypeRef =
    event === "push" && payload.ref?.startsWith("refs/heads/prototype/")
      ? payload.ref.replace(/^refs\/heads\//, "")
      : event === "create" && payload.ref_type === "branch" && payload.ref?.startsWith("prototype/")
        ? payload.ref
        : null;
  if (prototypeRef) {
    await syncPrototypeBranch(project, token, prototypeRef);
    return;
  }

  if (event === "pull_request" && payload.pull_request) {
    const pr = payload.pull_request;
    const closes = issuesClosedByPullRequest(pr.title, pr.body);
    if (closes.length > 0) {
      await prisma.projectIssue.updateMany({
        where: { projectId: project.id, githubIssueNumber: { in: closes } },
        data: {
          githubPrNumber: pr.number,
          githubPrUrl: pr.html_url,
          githubPrState: pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "open",
        },
      });
      notifyBoard(project, { github: "pull_request", issues: closes });
    }
    return;
  }

  if ((event === "issues" || event === "issue_comment") && payload.issue && !payload.issue.pull_request) {
    const issue = toLite(payload.issue);
    const row = await prisma.projectIssue.findFirst({
      where: { projectId: project.id, githubIssueNumber: issue.number },
      select: { id: true, epicNumber: true },
    });
    const epicNumber = parseEpicPlan(issue.body) ? issue.number : row?.epicNumber ?? null;

    if (event === "issue_comment" && row) {
      const marker = parseFactoryComment(payload.comment?.body);
      if (marker) {
        const text = (payload.comment?.body || "").replace(/<!--[\s\S]*?-->/g, "").trim();
        await prisma.projectIssue.update({ where: { id: row.id }, data: { summary: text.slice(0, 4000) } });
      }
    }
    if (epicNumber) await syncEpic(project, token, epicNumber, new Map([[issue.number, issue]]));
    notifyBoard(project, { github: event, issue: issue.number });
  }
}


/** The GitHub token of a person's newest live session, or null. */
export async function githubTokenOfUser(userId: string): Promise<string | null> {
  const session = await prisma.session.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { githubAccessToken: true },
  });
  if (!session) return null;
  try {
    return unsealToken(session.githubAccessToken, getOAuthConfig().clientSecret) || null;
  } catch {
    return null;
  }
}

/** Records the repository a project works in, when it has none yet. Returns the project's repository. */
export async function linkProjectRepo(projectId: string, repo: RepoRef): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { githubFullName: true },
  });
  if (project.githubFullName) return project.githubFullName;
  await prisma.project.update({
    where: { id: projectId },
    data: { githubFullName: repo.fullName, githubUrl: `https://github.com/${repo.fullName}`, githubOwner: repo.owner },
  });
  return repo.fullName;
}

/**
 * A BA run's step may name the repository it publishes to (`--repo owner/name`) and link the
 * issues it created. Links the project to that repository and puts every new epic on the board.
 */
export async function learnFromBaStep(params: {
  project: { id: string; userId: string };
  text: string;
}) {
  const repo = findRepoInText(params.text);
  if (!repo) return;
  const fullName = await linkProjectRepo(params.project.id, repo);
  if (fullName.toLowerCase() !== repo.fullName.toLowerCase()) return;

  const numbers = findIssueNumbers(params.text, fullName).sort((a, b) => a - b);
  if (numbers.length === 0) return;
  const known = await prisma.projectIssue.findMany({
    where: { projectId: params.project.id, githubIssueNumber: { in: numbers } },
    select: { githubIssueNumber: true },
  });
  const seen = new Set(known.map((k) => k.githubIssueNumber));
  const token = await githubTokenOfUser(params.project.userId);
  if (!token) return;
  const project = { ...params.project, githubFullName: fullName, githubSyncToken: null };
  for (const n of numbers) {
    if (seen.has(n)) continue;
    // An epic brings its tickets; they are then known and skipped.
    if (await syncEpic(project, token, n).catch(() => false)) {
      const rows = await prisma.projectIssue.findMany({
        where: { projectId: params.project.id, githubIssueNumber: { not: null } },
        select: { githubIssueNumber: true },
      });
      for (const r of rows) seen.add(r.githubIssueNumber);
    }
  }
  await prisma.project.update({ where: { id: params.project.id }, data: { githubSyncedAt: new Date() } });
  notifyBoard(project, { github: "ba-published", repo: fullName });
}

/**
 * On opening a project: learn its repository from a BA run that published to one, then import
 * from GitHub once if it never was. Uses the viewer's GitHub token.
 */
export async function ensureProjectGithub(projectId: string, viewerToken: string | null) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, githubFullName: true, githubSyncToken: true, githubSyncedAt: true },
  });
  if (!project) return;
  let fullName = project.githubFullName;
  if (!fullName) {
    const step = await prisma.runStep.findFirst({
      // Labels are cut short; the tool input in dataJson keeps the whole command.
      where: { run: { projectId, mode: "ba" }, dataJson: { contains: "--repo" } },
      orderBy: { createdAt: "desc" },
      select: { label: true, dataJson: true },
    });
    const repo = findRepoInText(`${step?.dataJson ?? ""}\n${step?.label ?? ""}`);
    if (repo) fullName = await linkProjectRepo(projectId, repo);
  }
  if (fullName && !project.githubSyncedAt && viewerToken) {
    await fullSync({ ...project, githubFullName: fullName }, viewerToken).catch(() => {});
  }
}

const lastPollAt = new Map<string, number>();
const POLL_MIN_INTERVAL_MS = 20_000;

/**
 * Keeps a tracked repository current when GitHub cannot reach the app (localhost, a LAN IP):
 * reads the repository's events since the last poll and applies each one like the webhook
 * delivery it stands for. Cheap when nothing changed (ETag, 304). Removes a webhook that
 * points at an address GitHub cannot reach.
 */
export async function pollRepository(projectId: string): Promise<{ applied: number; skipped?: string }> {
  const now = Date.now();
  if (now - (lastPollAt.get(projectId) ?? 0) < POLL_MIN_INTERVAL_MS) return { applied: 0, skipped: "too soon" };
  lastPollAt.set(projectId, now);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      userId: true,
      githubFullName: true,
      githubSyncToken: true,
      githubTrackedAt: true,
      githubWebhookId: true,
      githubEventsEtag: true,
      githubLastEventId: true,
    },
  });
  if (!project?.githubFullName || !project.githubTrackedAt || !project.githubSyncToken) {
    return { applied: 0, skipped: "not tracked" };
  }
  const token = tokenOf(project);
  const unreachable = isUnreachableUrl(getOAuthConfig().publicUrl);
  if (project.githubWebhookId) {
    if (!unreachable) return { applied: 0, skipped: "webhook" };
    // Forget the webhook only once GitHub confirms it is gone (deleted now, or already 404).
    const removed = await gh(token, `/repos/${project.githubFullName}/hooks/${project.githubWebhookId}`, {
      method: "DELETE",
    })
      .then(() => true)
      .catch((e: unknown) => e instanceof GithubTrackingError && e.message.startsWith("GitHub 404"));
    if (removed) {
      await prisma.project.update({ where: { id: project.id }, data: { githubWebhookId: null, githubWebhookSecret: null } });
    }
  }

  const res = await fetch(`${API}/repos/${project.githubFullName}/events?per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(project.githubEventsEtag ? { "If-None-Match": project.githubEventsEtag } : {}),
    },
    cache: "no-store",
  });
  if (res.status === 304) return { applied: 0 };
  if (!res.ok) throw new GithubTrackingError(`GitHub ${res.status} on /repos/${project.githubFullName}/events`);
  const events = (await res.json()) as Array<Parameters<typeof repoEventToDelivery>[0] & { id: string }>;
  const etag = res.headers.get("etag");

  // Newest first: take everything after the last applied event, then apply oldest first.
  const fresh: typeof events = [];
  for (const e of events) {
    if (e.id === project.githubLastEventId) break;
    fresh.push(e);
  }
  // The first poll only records where to start: the import already covered the past.
  const toApply = project.githubLastEventId ? fresh.reverse() : [];
  let applied = 0;
  for (const e of toApply) {
    const delivery = repoEventToDelivery(e);
    if (!delivery) continue;
    await handleWebhookEvent(project, delivery.event, delivery.payload as Parameters<typeof handleWebhookEvent>[2]);
    applied += 1;
  }
  await prisma.project.update({
    where: { id: project.id },
    data: {
      githubEventsEtag: etag,
      githubLastEventId: events[0]?.id ?? project.githubLastEventId,
      ...(applied > 0 ? { githubSyncedAt: new Date(), githubSyncError: null } : {}),
    },
  });
  return { applied };
}

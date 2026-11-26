import { redirect } from "next/navigation";
import { AutomationsWorkspace } from "@/components/factory/automations-workspace";
import { getProjectAutoApproveMap } from "@/lib/auto-dispatch";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { isRunnerOnline, runStallWatchdog, safeJsonParse } from "@/lib/workspace-data";

export default async function AutomationsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  await runStallWatchdog(session.user.id).catch(() => {});

  const [projects, runners, commands, mergeQueue] = await Promise.all([
    prisma.project.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: {
            issues: { where: { status: "ready" } },
            runs: { where: { status: { in: ["running", "queued"] } } },
          },
        },
      },
    }),
    prisma.runnerMachine.findMany({
      where: { userId: session.user.id },
      orderBy: { lastHeartbeatAt: "desc" },
    }),
    prisma.runnerCommand.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        project: { select: { name: true } },
        run: { select: { runKey: true } },
      },
    }),
    prisma.pullRequest.findMany({
      where: {
        project: { userId: session.user.id },
        queueStatus: { in: ["queued", "rebasing", "verifying", "conflict"] },
      },
      orderBy: { updatedAt: "asc" },
      include: { project: { select: { name: true } } },
    }),
  ]);

  const autoApproveMap = await getProjectAutoApproveMap(projects.map((p) => p.id));

  return (
    <AutomationsWorkspace
      initialData={{
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          engine: p.engine,
          autoDispatch: p.autoDispatch,
          autoApprove: autoApproveMap.get(p.id) ?? false,
          maxConcurrency: p.maxConcurrency,
          stallTimeoutMinutes: p.stallTimeoutMinutes,
          readyIssues: p._count.issues,
          activeRuns: p._count.runs,
        })),
        runners: runners.map((r) => ({
          id: r.id,
          name: r.name,
          hostname: r.hostname,
          os: r.os,
          engines: safeJsonParse<string[]>(r.enginesJson, ["antigravity", "claude"]),
          status: isRunnerOnline(r.status, r.lastHeartbeatAt) ? "online" : "offline",
          maxConcurrency: r.maxConcurrency,
          activeRuns: r.activeRuns,
          lastHeartbeatAt: r.lastHeartbeatAt.toISOString(),
        })),
        commands: commands.map((c) => ({
          id: c.id,
          type: c.type,
          status: c.status,
          error: c.error,
          projectName: c.project?.name ?? null,
          runKey: c.run?.runKey ?? null,
          createdAt: c.createdAt.toISOString(),
        })),
        mergeQueue: mergeQueue.map((pr) => ({
          id: pr.id,
          number: pr.number,
          title: pr.title,
          headBranch: pr.headBranch,
          baseBranch: pr.baseBranch,
          ciStatus: pr.ciStatus,
          queueStatus: pr.queueStatus,
          projectName: pr.project.name,
          updatedAt: pr.updatedAt.toISOString(),
        })),
      }}
    />
  );
}

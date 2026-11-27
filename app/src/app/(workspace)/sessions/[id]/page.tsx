import { notFound, redirect } from "next/navigation";
import { MissionControl } from "@/components/factory/mission-control";
import { getCurrentSession } from "@/lib/session";
import { getRunDetail } from "@/lib/workspace-data";

export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ agent?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const run = await getRunDetail(session.user.id, id);
  if (!run) notFound();

  return <MissionControl initialRun={run} initialAgentId={sp.agent ?? null} />;
}

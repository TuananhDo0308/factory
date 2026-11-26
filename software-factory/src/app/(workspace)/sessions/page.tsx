import { redirect } from "next/navigation";
import { SessionLauncher } from "@/components/factory/session-launcher";
import { getCurrentSession } from "@/lib/session";
import { getSidebarData } from "@/lib/workspace-data";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string;
    mode?: string;
    skill?: string;
    prompt?: string;
  }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const [sidebar, sp] = await Promise.all([
    getSidebarData(session.user.id),
    searchParams,
  ]);

  return (
    <SessionLauncher
      projects={sidebar.projects}
      runners={sidebar.runners}
      initialProjectId={sp.project}
      initialSkill={sp.skill || sp.mode}
      initialPrompt={sp.prompt}
    />
  );
}

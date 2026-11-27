import { redirect } from "next/navigation";
import { ProjectPage } from "./project-page";

// Old ?tab= links land on the page that replaced each tab.
const LEGACY_TABS: Record<string, string> = { issues: "kanban", prototypes: "prototypes", context: "context" };

export default async function ProjectOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  if (tab && LEGACY_TABS[tab]) redirect(`/projects/${id}/${LEGACY_TABS[tab]}`);
  return <ProjectPage id={id} section="overview" openTeam={tab === "team"} />;
}

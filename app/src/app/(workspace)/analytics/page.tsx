import { redirect } from "next/navigation";
import { AnalyticsWorkspace } from "@/components/factory/analytics-workspace";
import { getCurrentSession } from "@/lib/session";
import { getAnalyticsData } from "@/lib/workspace-data";

export default async function AnalyticsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const data = await getAnalyticsData(session.user.id);
  return <AnalyticsWorkspace data={data} />;
}

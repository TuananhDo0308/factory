import { redirect } from "next/navigation";
import { InboxView } from "@/components/factory/inbox-view";
import { getCurrentSession } from "@/lib/session";
import { getInboxData, runStallWatchdog } from "@/lib/workspace-data";

export default async function InboxPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  await runStallWatchdog(session.user.id).catch(() => {});
  const data = await getInboxData(session.user.id);
  return <InboxView initialData={data} />;
}

import { redirect } from "next/navigation";
import { AppShell } from "@/components/factory/app-shell";
import { getCurrentSession } from "@/lib/session";
import { getSidebarData, runStallWatchdog } from "@/lib/workspace-data";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }

  await runStallWatchdog(session.user.id).catch(() => {});
  const sidebarData = await getSidebarData(session.user.id);

  return (
    <AppShell initialData={sidebarData}>
      {children}
    </AppShell>
  );
}

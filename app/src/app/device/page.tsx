import { redirect } from "next/navigation";
import { DeviceApproveView } from "@/components/factory/device-approve-view";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const sp = await searchParams;
  const rawCode = (sp.code || "").trim().toUpperCase();
  const session = await getCurrentSession();

  if (!session) {
    const nextPath = rawCode ? `/device?code=${encodeURIComponent(rawCode)}` : "/device";
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const record = rawCode
    ? await prisma.deviceAuthCode.findUnique({ where: { userCode: rawCode } })
    : null;

  return (
    <DeviceApproveView
      initialCode={rawCode}
      user={{
        name: session.user.name || session.user.githubLogin,
        githubLogin: session.user.githubLogin,
      }}
      device={
        record
          ? {
              userCode: record.userCode,
              runnerName: record.runnerName,
              hostname: record.hostname,
              os: record.os,
              status: record.status,
              expired: record.expiresAt < new Date(),
            }
          : null
      }
    />
  );
}

import { redirect } from "next/navigation";
import { InviteAcceptView } from "@/components/factory/invite-accept-view";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getCurrentSession();

  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const record = await prisma.projectInvite.findUnique({
    where: { token },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          engine: true,
          user: { select: { githubLogin: true, name: true } },
        },
      },
    },
  });

  return (
    <InviteAcceptView
      token={token}
      user={{
        name: session.user.name || session.user.githubLogin,
        githubLogin: session.user.githubLogin,
      }}
      invite={
        record
          ? {
              projectId: record.project.id,
              projectName: record.project.name,
              engine: record.project.engine,
              ownerLogin: record.project.user.githubLogin,
              ownerName: record.project.user.name,
              role: record.role,
              expired: Boolean(record.expiresAt && record.expiresAt < new Date()),
              revoked: Boolean(record.revokedAt),
            }
          : null
      }
    />
  );
}

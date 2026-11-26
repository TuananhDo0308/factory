import { redirect } from "next/navigation";
import { LessonsWorkspace } from "@/components/factory/lessons-workspace";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";

export default async function LessonsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const lessons = await prisma.lesson.findMany({
    where: { userId: session.user.id },
    orderBy: [{ status: "asc" }, { occurrences: "desc" }, { updatedAt: "desc" }],
    include: { project: { select: { name: true } } },
  });

  return (
    <LessonsWorkspace
      initialLessons={lessons.map((l) => ({
        id: l.id,
        patternKey: l.patternKey,
        title: l.title,
        occurrences: l.occurrences,
        target: l.target,
        proposal: l.proposal,
        status: l.status,
        projectName: l.project?.name ?? null,
        updatedAt: l.updatedAt.toISOString(),
      }))}
    />
  );
}

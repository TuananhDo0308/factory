import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (request.nextUrl.searchParams.get("q") || "").trim().replace(/^@+/, "").toLowerCase();
  const excludeProjectId = (request.nextUrl.searchParams.get("excludeProjectId") || "").trim();

  const [allUsers, excludedHandles] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ githubId: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        githubId: true,
        githubLogin: true,
        name: true,
        email: true,
        avatarUrl: true,
      },
      take: 200,
    }),
    excludeProjectId
      ? prisma.project
          .findUnique({
            where: { id: excludeProjectId },
            select: {
              user: { select: { githubLogin: true } },
              members: { select: { githubLogin: true } },
            },
          })
          .then((p) => {
            const s = new Set<string>();
            if (p?.user?.githubLogin) s.add(p.user.githubLogin.toLowerCase());
            for (const m of p?.members || []) s.add(m.githubLogin.toLowerCase());
            return s;
          })
      : Promise.resolve(new Set<string>()),
  ]);

  const filtered = allUsers
    .filter((u) => {
      const login = u.githubLogin.toLowerCase();
      if (login === "local") return false;
      if (excludedHandles.has(login)) return false;
      if (!q) return true;
      return (
        login.includes(q) ||
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
      );
    })
    .slice(0, 20);

  return NextResponse.json({
    ok: true,
    users: filtered.map((u) => ({
      id: u.id,
      githubLogin: u.githubLogin,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      isGitHub: u.githubId > 0,
    })),
  });
}

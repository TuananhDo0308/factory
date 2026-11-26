import { type NextRequest, NextResponse } from "next/server";
import { provisionProject } from "@/lib/provision";
import { getCurrentSession } from "@/lib/session";

const VALID_ENGINES = new Set(["antigravity", "claude"]);

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode === "github" ? "github" : body.mode === "new" ? "new" : null;
  if (!mode) {
    return NextResponse.json({ error: 'mode must be "github" or "new"' }, { status: 400 });
  }

  const engineRaw = str(body.engine) || "antigravity";
  const engine = (VALID_ENGINES.has(engineRaw) ? engineRaw : "antigravity") as
    | "antigravity"
    | "claude";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          // Stream already closed by client.
        }
      };

      await provisionProject(
        {
          user: {
            id: session.user.id,
            githubLogin: session.user.githubLogin,
            name: session.user.name,
            email: session.user.email,
          },
          userAccessToken: session.githubAccessToken,
          mode,
          name: str(body.name) || undefined,
          description: str(body.description) || null,
          engine,
          localPath: str(body.localPath) || null,
          githubRepoId: body.githubRepoId !== undefined ? Number(body.githubRepoId) : undefined,
          createGitHubRepo: body.createGitHubRepo !== false,
          isPrivate: body.isPrivate !== false,
        },
        send,
      );

      try {
        controller.close();
      } catch {
        // Ignore close after abort.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}

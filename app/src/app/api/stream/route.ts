import { type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { sfEventBus, type FactoryStreamEvent } from "@/lib/events";
import { getAccessibleProjectIds } from "@/lib/team-access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return new Response("Unauthorized", { status: 401 });
  }

  const runFilter = request.nextUrl.searchParams.get("runId");
  const encoder = new TextEncoder();
  const initialProjectIds = await getAccessibleProjectIds(auth.user.id, auth.user.githubLogin);
  const projectIdSet = new Set(initialProjectIds);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Stream closed.
        }
      };

      send("connected", { ok: true, userId: auth.user.id, ts: new Date().toISOString() });

      const onEvent = (evt: FactoryStreamEvent) => {
        const isOwn = evt.userId === auth.user.id;
        const isSharedProject = Boolean(evt.projectId && projectIdSet.has(evt.projectId));
        if (!isOwn && !isSharedProject) return;
        if (runFilter && evt.runId && evt.runId !== runFilter) return;
        send(evt.type, evt);
      };

      sfEventBus.on("factory-event", onEvent);

      const ping = setInterval(() => {
        send("ping", { ts: new Date().toISOString() });
      }, 20_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(ping);
        sfEventBus.off("factory-event", onEvent);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

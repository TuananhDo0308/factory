import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  const candidates = [
    path.join(process.cwd(), "cli", "sf.ts"),
    path.join(process.cwd(), "software-factory", "cli", "sf.ts"),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (!file) {
    return new NextResponse("// sf.ts CLI source not found on server\n", { status: 404 });
  }
  const source = readFileSync(file, "utf8");
  return new NextResponse(source, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Local mode is disabled. Please sign in with GitHub." },
    { status: 403 },
  );
}

import { NextRequest, NextResponse } from "next/server";
import { findEntities } from "@/lib/supabase";
import { normalizeName } from "@/lib/normalize";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = (body?.name || "").toString().trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const norm = normalizeName(name);
    const results = await findEntities(norm, 5);
    return NextResponse.json({ query: name, normalized: norm, results });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Lookup failed" },
      { status: 500 },
    );
  }
}

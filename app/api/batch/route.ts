import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { findEntitiesBulk, EntityRow } from "@/lib/supabase";
import { normalizeName } from "@/lib/normalize";

export const runtime = "nodejs";
export const maxDuration = 60;

const NAME_COLUMN_CANDIDATES = [
  "owner_name_raw", "owner_name", "owner", "entity_name", "entity",
  "llc_name", "llc", "company", "company_name", "business_name", "name",
];

function detectNameColumn(headers: string[]): string | null {
  const lc = headers.map((h) => h.toLowerCase().trim());
  for (const cand of NAME_COLUMN_CANDIDATES) {
    const idx = lc.indexOf(cand);
    if (idx >= 0) return headers[idx];
  }
  for (const key of ["owner", "name"]) {
    const idx = lc.findIndex((h) => h.includes(key));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

const ENTITY_HINT = /\b(L\.?L\.?C\.?|INC\.?|CORP\.?|LP|LLP|LTD|TRUST|HOLDINGS|COMPANY)\b/i;
const looksLikeEntity = (name: string) => ENTITY_HINT.test(name || "");

function flatten(rec: EntityRow | null) {
  if (!rec) {
    return {
      sb_match: "", sb_status: "", sb_filing_type: "", sb_corp_name: "",
      sb_mail_address: "", sb_principal_address: "", sb_officer_1: "",
      sb_officer_1_address: "", sb_officer_2: "", sb_officer_2_address: "",
      sb_corp_number: "",
    };
  }
  const mail = [rec.mail_addr_1, rec.mail_addr_2,
    [rec.mail_city, rec.mail_state, rec.mail_zip].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  const principal = [rec.principal_addr_1, rec.principal_addr_2,
    [rec.principal_city, rec.principal_state, rec.principal_zip].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  const oa = (a: string|null, c: string|null, s: string|null, z: string|null) =>
    [a, [c, s, z].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    sb_match: "yes",
    sb_status: rec.status || "",
    sb_filing_type: rec.filing_type || "",
    sb_corp_name: rec.corp_name || "",
    sb_mail_address: mail,
    sb_principal_address: principal,
    sb_officer_1: (rec.officer_1_name || "").replace(/\s+/g, " ").trim(),
    sb_officer_1_address: oa(rec.officer_1_addr, rec.officer_1_city, rec.officer_1_state, rec.officer_1_zip),
    sb_officer_2: (rec.officer_2_name || "").replace(/\s+/g, " ").trim(),
    sb_officer_2_address: oa(rec.officer_2_addr, rec.officer_2_city, rec.officer_2_state, rec.officer_2_zip),
    sb_corp_number: rec.corp_number || "",
  };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data || [];
    if (rows.length === 0) return NextResponse.json({ error: "Empty CSV" }, { status: 400 });

    const headers = parsed.meta.fields || Object.keys(rows[0]);
    const nameCol = detectNameColumn(headers);
    if (!nameCol) {
      return NextResponse.json({
        error: "Could not auto-detect the LLC name column. Expected something like 'owner_name_raw', 'owner_name', 'entity', or 'company_name'.",
      }, { status: 400 });
    }

    // 1. Collect normalized names for entity rows only.
    const normPerRow: (string | null)[] = rows.map((row) => {
      const raw = (row[nameCol] || "").toString().trim();
      return raw && looksLikeEntity(raw) ? normalizeName(raw) : null;
    });

    // 2. ONE bulk query for all of them.
    const toLookup = normPerRow.filter((n): n is string => !!n);
    const matches = await findEntitiesBulk(toLookup);

    // 3. Stitch results back onto rows.
    let matched = 0, attempted = 0, skipped = 0;
    const outRows = rows.map((row, i) => {
      const norm = normPerRow[i];
      if (!norm) { skipped++; return { ...row, ...flatten(null) }; }
      attempted++;
      const hit = matches.get(norm) || null;
      if (hit) matched++;
      return { ...row, ...flatten(hit) };
    });

    const csv = Papa.unparse(outRows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.name.replace(/\.csv$/i, "")}-sunbiz.csv"`,
        "x-name-column": nameCol,
        "x-rows": String(rows.length),
        "x-attempted": String(attempted),
        "x-matched": String(matched),
        "x-skipped-individuals": String(skipped),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Batch enrichment failed" }, { status: 500 });
  }
}

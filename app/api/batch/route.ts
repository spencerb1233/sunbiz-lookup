import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { findEntities, EntityRow } from "@/lib/supabase";
import { normalizeName } from "@/lib/normalize";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel hobby tier cap

// Heuristics for auto-detecting the column that holds the LLC / entity name.
const NAME_COLUMN_CANDIDATES = [
  "owner_name_raw",
  "owner_name",
  "owner",
  "entity_name",
  "entity",
  "llc_name",
  "llc",
  "company",
  "company_name",
  "business_name",
  "name",
];

function detectNameColumn(headers: string[]): string | null {
  const lc = headers.map((h) => h.toLowerCase().trim());
  // Exact-name candidates first.
  for (const cand of NAME_COLUMN_CANDIDATES) {
    const idx = lc.indexOf(cand);
    if (idx >= 0) return headers[idx];
  }
  // Fallback: any header containing 'name' or 'owner'.
  for (const key of ["owner", "name"]) {
    const idx = lc.findIndex((h) => h.includes(key));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

const ENTITY_HINT = /\b(L\.?L\.?C\.?|INC\.?|CORP\.?|LP|LLP|LTD|TRUST|HOLDINGS|COMPANY)\b/i;

function looksLikeEntity(name: string): boolean {
  return ENTITY_HINT.test(name || "");
}

function flatten(rec: EntityRow | null) {
  if (!rec) {
    return {
      sb_match: "",
      sb_status: "",
      sb_filing_type: "",
      sb_corp_name: "",
      sb_mail_address: "",
      sb_principal_address: "",
      sb_officer_1: "",
      sb_officer_1_address: "",
      sb_officer_2: "",
      sb_officer_2_address: "",
      sb_corp_number: "",
    };
  }
  const mail = [
    rec.mail_addr_1,
    rec.mail_addr_2,
    [rec.mail_city, rec.mail_state, rec.mail_zip].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const principal = [
    rec.principal_addr_1,
    rec.principal_addr_2,
    [rec.principal_city, rec.principal_state, rec.principal_zip]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const officerAddr = (a: string | null, c: string | null, s: string | null, z: string | null) =>
    [a, [c, s, z].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return {
    sb_match: "yes",
    sb_status: rec.status || "",
    sb_filing_type: rec.filing_type || "",
    sb_corp_name: rec.corp_name || "",
    sb_mail_address: mail,
    sb_principal_address: principal,
    sb_officer_1: rec.officer_1_name || "",
    sb_officer_1_address: officerAddr(
      rec.officer_1_addr,
      rec.officer_1_city,
      rec.officer_1_state,
      rec.officer_1_zip,
    ),
    sb_officer_2: rec.officer_2_name || "",
    sb_officer_2_address: officerAddr(
      rec.officer_2_addr,
      rec.officer_2_city,
      rec.officer_2_state,
      rec.officer_2_zip,
    ),
    sb_corp_number: rec.corp_number || "",
  };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0) {
      // Log but keep going if rows parsed OK
      console.warn("CSV parse warnings:", parsed.errors.slice(0, 3));
    }

    const rows = parsed.data || [];
    if (rows.length === 0) {
      return NextResponse.json({ error: "Empty CSV" }, { status: 400 });
    }
    const headers = parsed.meta.fields || Object.keys(rows[0]);

    const nameCol = detectNameColumn(headers);
    if (!nameCol) {
      return NextResponse.json(
        {
          error:
            "Could not auto-detect the LLC name column. Expected a column like 'owner_name_raw', 'owner_name', 'entity', or 'company_name'.",
        },
        { status: 400 },
      );
    }

    // Build the output rows.  Skip lookup for rows that don't look like entities
    // (saves DB calls for individual-person owners).
    const outRows: Record<string, string>[] = [];
    let matched = 0;
    let attempted = 0;
    let skippedIndividuals = 0;

    for (const row of rows) {
      const raw = (row[nameCol] || "").toString().trim();
      let enriched: ReturnType<typeof flatten>;
      if (!raw || !looksLikeEntity(raw)) {
        skippedIndividuals++;
        enriched = flatten(null);
      } else {
        attempted++;
        const norm = normalizeName(raw);
        const results = await findEntities(norm, 1);
        const top = results[0] || null;
        if (top) matched++;
        enriched = flatten(top);
      }
      outRows.push({ ...row, ...enriched });
    }

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
        "x-skipped-individuals": String(skippedIndividuals),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Batch enrichment failed" },
      { status: 500 },
    );
  }
}

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
const ADDR_STREET_CANDIDATES = ["owner_address_1","owner_address","owner_mail_address","mail_address_1","mailing_address","mail_address","address_1","address"];
const ADDR_CITY_CANDIDATES   = ["owner_city","mail_city","city"];
const ADDR_STATE_CANDIDATES  = ["owner_state","mail_state","state"];
const ADDR_ZIP_CANDIDATES    = ["owner_postal","owner_zip","mail_zip","mail_postal","zip","postal","zipcode","zip_code"];

function detectCol(headers: string[], candidates: string[]): string | null {
  const lc = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) { const i = lc.indexOf(c); if (i >= 0) return headers[i]; }
  return null;
}
function detectNameColumn(headers: string[]): string | null {
  const hit = detectCol(headers, NAME_COLUMN_CANDIDATES);
  if (hit) return hit;
  const lc = headers.map((h) => h.toLowerCase().trim());
  for (const key of ["owner", "name"]) {
    const idx = lc.findIndex((h) => h.includes(key));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

const ENTITY_HINT = /\b(L\.?L\.?C\.?|INC\.?|CORP\.?|LP|LLP|LTD|TRUST|HOLDINGS|COMPANY)\b/i;
const looksLikeEntity = (name: string) => ENTITY_HINT.test(name || "");

function titleCase(s: string): string {
  return s.toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c) => "Mc" + c.toUpperCase())
    .replace(/\bO'([a-z])/g, (_m, c) => "O'" + c.toUpperCase());
}
function cleanOfficerName(raw: string | null): { full: string; first: string } {
  if (!raw) return { full: "", first: "" };
  let parts = raw.trim().split(/\s{2,}/).filter(Boolean);
  if (parts.length < 2) parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { full: "", first: "" };
  let last = (parts[0] || "").replace(/[,]+$/, "").trim();
  let first = (parts[1] || "").split(/\s+/)[0] || "";
  first = first.replace(/(JR|SR|II|III|IV)\.?$/i, "").trim();
  const F = titleCase(first), L = titleCase(last);
  return { full: F && L ? `${F} ${L}` : F || L, first: F };
}

function normAddr(s: string): string {
  let x = (s || "").toUpperCase();
  const repl: Record<string,string> = {STREET:"ST",DRIVE:"DR",CIRCLE:"CIR",TRAIL:"TRL",SUITE:"STE",AVENUE:"AVE",ROAD:"RD",LANE:"LN",BOULEVARD:"BLVD",COURT:"CT",PLACE:"PL",WEST:"W",EAST:"E",NORTH:"N",SOUTH:"S",APARTMENT:"APT"};
  for (const k in repl) x = x.replace(new RegExp("\\b"+k+"\\b","g"), repl[k]);
  return x.replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
const streetOf = (s: string) => normAddr((s || "").split(",")[0]);
const AGENT_SIGNALS = ["REGISTERED AGENT","NORTHWEST REGISTERED","CT CORPORATION","COGENCY","INCFILE","BIZEE","HARVARD BUSINESS","REGISTERED AGENTS INC","LEGALZOOM","ZENBUSINESS","CORPORATION SERVICE COMPANY","4281 EXPRESS LANE","UNITED STATES CORPORATION AGENTS"];
function isAgentAddr(s: string): boolean {
  const x = normAddr(s);
  if (!x) return false;
  if (AGENT_SIGNALS.some((g) => x.includes(normAddr(g)))) return true;
  if (/\bPMB\b/.test(x)) return true;
  if (/\bPO BOX\b/.test(x)) return true;
  return false;
}
function recommendAddress(orig: string, sbMail: string, sbOff: string): { address: string; confidence: string } {
  const so = streetOf(orig), sm = streetOf(sbMail), sf = streetOf(sbOff);
  const overlap = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  if (overlap(so, sm) || overlap(so, sf)) return { address: orig, confidence: "AGREE" };
  if (sm && isAgentAddr(sbMail)) {
    if (sf && !isAgentAddr(sbOff)) return { address: sbOff, confidence: "AGENT-MAILBOX" };
    if (so) return { address: orig, confidence: "AGENT-MAILBOX" };
    return { address: sbMail, confidence: "AGENT-MAILBOX" };
  }
  if (so && (sm || sf)) return { address: orig, confidence: "CONFLICT" };
  if (sf && !isAgentAddr(sbOff)) return { address: sbOff, confidence: "SUNBIZ-ONLY" };
  if (sm) return { address: sbMail, confidence: "SUNBIZ-ONLY" };
  return { address: orig, confidence: "" };
}

function flatten(rec: EntityRow | null) {
  if (!rec) {
    return {
      sb_match: "", sb_status: "", sb_filing_type: "", sb_corp_name: "",
      sb_mail_address: "", sb_principal_address: "",
      sb_officer_1: "", sb_officer_1_first: "", sb_officer_1_address: "",
      sb_officer_2: "", sb_officer_2_first: "", sb_officer_2_address: "",
      sb_corp_number: "",
    };
  }
  const mail = [rec.mail_addr_1, rec.mail_addr_2, [rec.mail_city, rec.mail_state, rec.mail_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const principal = [rec.principal_addr_1, rec.principal_addr_2, [rec.principal_city, rec.principal_state, rec.principal_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const oa = (a: string|null, c: string|null, s: string|null, z: string|null) => [a, [c, s, z].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const o1 = cleanOfficerName(rec.officer_1_name);
  const o2 = cleanOfficerName(rec.officer_2_name);
  return {
    sb_match: "yes", sb_status: rec.status || "", sb_filing_type: rec.filing_type || "", sb_corp_name: rec.corp_name || "",
    sb_mail_address: mail, sb_principal_address: principal,
    sb_officer_1: o1.full, sb_officer_1_first: o1.first, sb_officer_1_address: oa(rec.officer_1_addr, rec.officer_1_city, rec.officer_1_state, rec.officer_1_zip),
    sb_officer_2: o2.full, sb_officer_2_first: o2.first, sb_officer_2_address: oa(rec.officer_2_addr, rec.officer_2_city, rec.officer_2_state, rec.officer_2_zip),
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
    if (!nameCol) return NextResponse.json({ error: "Could not auto-detect the LLC name column." }, { status: 400 });
    const stCol = detectCol(headers, ADDR_STREET_CANDIDATES);
    const cyCol = detectCol(headers, ADDR_CITY_CANDIDATES);
    const stateCol = detectCol(headers, ADDR_STATE_CANDIDATES);
    const zipCol = detectCol(headers, ADDR_ZIP_CANDIDATES);
    const origAddrOf = (row: Record<string,string>) => {
      const street = stCol ? (row[stCol]||"").trim() : "";
      const rest = [cyCol?row[cyCol]:"", stateCol?row[stateCol]:"", zipCol?row[zipCol]:""].filter(Boolean).join(" ").trim();
      return [street, rest].filter(Boolean).join(", ");
    };

    const normPerRow = rows.map((row) => {
      const raw = (row[nameCol] || "").toString().trim();
      return raw && looksLikeEntity(raw) ? normalizeName(raw) : null;
    });
    const toLookup = normPerRow.filter((n): n is string => !!n);
    const matches = await findEntitiesBulk(toLookup);

    let matched = 0, attempted = 0, skipped = 0;
    const outRows = rows.map((row, i) => {
      const norm = normPerRow[i];
      const orig = origAddrOf(row);
      if (!norm) { skipped++; const f = flatten(null); return { ...row, ...f, recommended_mailing_address: orig, address_confidence: "" }; }
      attempted++;
      const hit = matches.get(norm) || null;
      if (hit) matched++;
      const f = flatten(hit);
      const rec = recommendAddress(orig, f.sb_mail_address, f.sb_officer_1_address);
      return { ...row, ...f, recommended_mailing_address: rec.address, address_confidence: rec.confidence };
    });

    const csv = Papa.unparse(outRows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.name.replace(/\.csv$/i, "")}-sunbiz.csv"`,
        "x-name-column": nameCol, "x-rows": String(rows.length),
        "x-attempted": String(attempted), "x-matched": String(matched), "x-skipped-individuals": String(skipped),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Batch enrichment failed" }, { status: 500 });
  }
}

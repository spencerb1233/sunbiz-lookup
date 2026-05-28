// Keep in sync with ingest/ingest.py:normalize_name

const SUFFIX_RE =
  /[,.\s]*(L\.?L\.?C\.?|INC\.?|CORP\.?|CORPORATION|COMPANY|CO\.?|LTD\.?|L\.?P\.?|L\.?L\.?P\.?|LIMITED|PARTNERSHIP|TRUST|HOLDINGS)\.?$/i;
const PUNCT_RE = /[^a-z0-9\s]/g;

export function normalizeName(name: string): string {
  let s = (name || "").trim().toLowerCase();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIX_RE, "").replace(/[\s,.]+$/, "");
    if (next === s) break;
    s = next;
  }
  s = s.replace(PUNCT_RE, " ").replace(/\s+/g, " ").trim();
  return s;
}

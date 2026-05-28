"use client";

import { useRef, useState } from "react";

type LookupResult = {
  corp_number: string;
  corp_name: string;
  status: string | null;
  filing_type: string | null;
  principal_addr_1: string | null;
  principal_addr_2: string | null;
  principal_city: string | null;
  principal_state: string | null;
  principal_zip: string | null;
  mail_addr_1: string | null;
  mail_addr_2: string | null;
  mail_city: string | null;
  mail_state: string | null;
  mail_zip: string | null;
  officer_1_name: string | null;
  officer_1_title: string | null;
  officer_1_addr: string | null;
  officer_1_city: string | null;
  officer_1_state: string | null;
  officer_1_zip: string | null;
  officer_2_name: string | null;
  officer_2_title: string | null;
  officer_2_addr: string | null;
  officer_2_city: string | null;
  officer_2_state: string | null;
  officer_2_zip: string | null;
};

const FILING_TYPE_LABEL: Record<string, string> = {
  FLAL: "Florida LLC",
  FORL: "Foreign LLC",
  DOMP: "Domestic Profit Corp",
  FORP: "Foreign Profit Corp",
  DOMLP: "Domestic Limited Partnership",
  FORLP: "Foreign Limited Partnership",
  DOMNP: "Domestic Non-Profit",
  FORNP: "Foreign Non-Profit",
};

function formatAddress(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.trim() !== "").join(", ");
}

export default function Page() {
  // Single lookup state
  const [name, setName] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [results, setResults] = useState<LookupResult[] | null>(null);
  const [normalized, setNormalized] = useState<string | null>(null);

  // Batch state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<{
    nameCol: string;
    rows: number;
    attempted: number;
    matched: number;
    skipped: number;
    downloadUrl: string;
    filename: string;
  } | null>(null);

  async function doLookup(e: React.FormEvent) {
    e.preventDefault();
    setLookupError(null);
    setResults(null);
    setNormalized(null);
    if (!name.trim()) return;
    setLookupLoading(true);
    try {
      const r = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Lookup failed");
      setResults(data.results || []);
      setNormalized(data.normalized || null);
    } catch (err: any) {
      setLookupError(err.message || "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }

  async function doBatch(e: React.FormEvent) {
    e.preventDefault();
    setBatchError(null);
    setBatchSummary(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setBatchError("Pick a CSV first.");
      return;
    }
    setBatchLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/batch", { method: "POST", body: fd });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `Server returned ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const headers = r.headers;
      setBatchSummary({
        nameCol: headers.get("x-name-column") || "—",
        rows: Number(headers.get("x-rows") || 0),
        attempted: Number(headers.get("x-attempted") || 0),
        matched: Number(headers.get("x-matched") || 0),
        skipped: Number(headers.get("x-skipped-individuals") || 0),
        downloadUrl: url,
        filename: `${file.name.replace(/\.csv$/i, "")}-sunbiz.csv`,
      });
    } catch (err: any) {
      setBatchError(err.message || "Batch failed");
    } finally {
      setBatchLoading(false);
    }
  }

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b rule">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-baseline justify-between">
          <div>
            <p className="label mb-1">Florida Division of Corporations · Public Records</p>
            <h1 className="font-display text-5xl leading-none">
              Sunbiz<span className="text-accent">·</span>Lookup
            </h1>
          </div>
          <p className="label hidden sm:block">Cross-reference LLCs to mailing addresses</p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-12 grid md:grid-cols-2 gap-12">
        {/* Single lookup */}
        <section>
          <p className="label mb-3">01 — Single Entity Lookup</p>
          <h2 className="font-display text-3xl mb-4">Look up one LLC.</h2>
          <p className="text-sm text-muted mb-6 max-w-md">
            Paste an LLC or corporate name. We&rsquo;ll find the registered mailing
            address and listed officers from Florida public records.
          </p>
          <form onSubmit={doLookup} className="space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Knabe Family Beach House LLC"
              className="w-full border rule bg-paper px-4 py-3 text-base focus:outline-none focus:border-ink"
            />
            <button
              type="submit"
              disabled={lookupLoading}
              className="label bg-ink text-paper px-5 py-3 hover:bg-accent disabled:opacity-50"
            >
              {lookupLoading ? "Searching…" : "Search Sunbiz →"}
            </button>
          </form>

          {lookupError && (
            <p className="mt-4 text-sm text-accent border-l-2 border-accent pl-3">
              {lookupError}
            </p>
          )}

          {results !== null && (
            <div className="mt-6">
              {results.length === 0 ? (
                <div className="border-l-2 border-rule pl-4 py-2">
                  <p className="label mb-1">No match</p>
                  <p className="text-sm">
                    Nothing close to{" "}
                    <span className="font-mono">{normalized}</span> in the Florida
                    registry. Likely registered in another state.
                  </p>
                </div>
              ) : (
                results.map((r) => <ResultCard key={r.corp_number} r={r} />)
              )}
            </div>
          )}
        </section>

        {/* Batch */}
        <section className="md:border-l rule md:pl-12">
          <p className="label mb-3">02 — CSV Batch</p>
          <h2 className="font-display text-3xl mb-4">Enrich a whole list.</h2>
          <p className="text-sm text-muted mb-6 max-w-md">
            Upload a CSV with an owner-name column. We&rsquo;ll detect entity rows,
            match them, and return a CSV with mailing address and officer columns
            appended.
          </p>

          <form onSubmit={doBatch} className="space-y-3">
            <input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              className="block w-full text-sm"
            />
            <button
              type="submit"
              disabled={batchLoading}
              className="label bg-ink text-paper px-5 py-3 hover:bg-accent disabled:opacity-50"
            >
              {batchLoading ? "Processing…" : "Enrich CSV →"}
            </button>
          </form>

          {batchError && (
            <p className="mt-4 text-sm text-accent border-l-2 border-accent pl-3">
              {batchError}
            </p>
          )}

          {batchSummary && (
            <div className="mt-6 border rule p-5 bg-white/40">
              <p className="label mb-3">Done</p>
              <dl className="text-sm space-y-1">
                <Row label="Rows" value={batchSummary.rows.toString()} />
                <Row label="Detected name column" value={batchSummary.nameCol} />
                <Row
                  label="Entities looked up"
                  value={batchSummary.attempted.toString()}
                />
                <Row
                  label="Matched in Sunbiz"
                  value={`${batchSummary.matched} (${
                    batchSummary.attempted
                      ? Math.round(
                          (batchSummary.matched / batchSummary.attempted) * 100,
                        )
                      : 0
                  }%)`}
                />
                <Row
                  label="Skipped (individuals)"
                  value={batchSummary.skipped.toString()}
                />
              </dl>
              <a
                href={batchSummary.downloadUrl}
                download={batchSummary.filename}
                className="inline-block mt-5 label bg-accent text-paper px-5 py-3 hover:bg-ink"
              >
                Download enriched CSV ↓
              </a>
            </div>
          )}
        </section>
      </div>

      <footer className="border-t rule mt-16">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4">
          <p className="label">
            Data:{" "}
            <a
              className="underline decoration-rule hover:decoration-ink"
              href="https://dos.fl.gov/sunbiz/other-services/data-downloads/"
              target="_blank"
              rel="noopener noreferrer"
            >
              dos.fl.gov/sunbiz · public records
            </a>
          </p>
          <p className="label">
            Coverage: <span className="text-ink">Florida only · LLCs · Corps · LPs</span>
          </p>
        </div>
      </footer>
    </main>
  );

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <div className="flex justify-between gap-4">
        <dt className="label mt-0.5">{label}</dt>
        <dd className="font-mono text-xs text-right">{value}</dd>
      </div>
    );
  }

  function ResultCard({ r }: { r: LookupResult }) {
    const mail = formatAddress([
      r.mail_addr_1,
      r.mail_addr_2,
      [r.mail_city, r.mail_state, r.mail_zip].filter(Boolean).join(" "),
    ]);
    const principal = formatAddress([
      r.principal_addr_1,
      r.principal_addr_2,
      [r.principal_city, r.principal_state, r.principal_zip].filter(Boolean).join(" "),
    ]);
    const off1 =
      r.officer_1_name &&
      formatAddress([
        r.officer_1_addr,
        [r.officer_1_city, r.officer_1_state, r.officer_1_zip].filter(Boolean).join(" "),
      ]);
    const off2 =
      r.officer_2_name &&
      formatAddress([
        r.officer_2_addr,
        [r.officer_2_city, r.officer_2_state, r.officer_2_zip].filter(Boolean).join(" "),
      ]);

    return (
      <article className="border rule p-5 mb-4 bg-white/40">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="font-display text-xl leading-tight">{r.corp_name}</h3>
          <span
            className={`label px-2 py-1 border ${
              r.status === "A"
                ? "border-ink text-ink"
                : "border-rule text-muted"
            }`}
          >
            {r.status === "A" ? "Active" : "Inactive"}
          </span>
        </div>

        <dl className="text-sm space-y-3">
          <Field
            label="Type"
            value={
              r.filing_type
                ? FILING_TYPE_LABEL[r.filing_type] || r.filing_type
                : "—"
            }
          />
          <Field label="Doc #" value={r.corp_number} mono />
          <Field label="Mailing address" value={mail || "—"} emphasize />
          {principal && principal !== mail && (
            <Field label="Principal address" value={principal} />
          )}
          {r.officer_1_name && (
            <Field
              label={r.officer_1_title ? `Officer 1 · ${r.officer_1_title}` : "Officer 1"}
              value={
                <>
                  <div className="font-medium">{r.officer_1_name}</div>
                  {off1 && <div className="text-muted text-xs mt-0.5">{off1}</div>}
                </>
              }
            />
          )}
          {r.officer_2_name && (
            <Field
              label={r.officer_2_title ? `Officer 2 · ${r.officer_2_title}` : "Officer 2"}
              value={
                <>
                  <div className="font-medium">{r.officer_2_name}</div>
                  {off2 && <div className="text-muted text-xs mt-0.5">{off2}</div>}
                </>
              }
            />
          )}
        </dl>
      </article>
    );
  }

  function Field({
    label,
    value,
    mono,
    emphasize,
  }: {
    label: string;
    value: React.ReactNode;
    mono?: boolean;
    emphasize?: boolean;
  }) {
    return (
      <div className="grid grid-cols-[110px_1fr] gap-4 items-baseline">
        <dt className="label">{label}</dt>
        <dd
          className={`${mono ? "font-mono text-xs" : "text-sm"} ${
            emphasize ? "font-medium" : ""
          }`}
        >
          {value}
        </dd>
      </div>
    );
  }
}

# Sunbiz Lookup

A standalone web tool that cross-references LLC / corporate names against the
Florida Division of Corporations public registry and returns the registered
mailing address plus listed officers.

Two modes:

1. **Single lookup** — paste one entity name, see one card.
2. **CSV batch** — drop a CSV, get an enriched CSV back with columns appended.

Stack: Next.js on Vercel, Supabase Postgres for the data, GitHub Actions for
weekly auto-refresh from Sunbiz's public SFTP. All free tiers. No cost.

---

## What's in the box

```
sunbiz-lookup/
├── app/                  ← Next.js app (UI + API routes)
│   ├── page.tsx          ← The one and only page
│   ├── api/lookup/       ← POST /api/lookup     (single entity)
│   └── api/batch/        ← POST /api/batch      (CSV upload)
├── lib/                  ← Supabase client + name normalization
├── supabase/schema.sql   ← Run this once in Supabase
├── ingest/               ← Python script that pulls Sunbiz data → Supabase
│   └── ingest.py
└── .github/workflows/    ← Weekly auto-refresh GitHub Action
    └── refresh.yml
```

---

## Deploy from scratch — ~30 min, no other people involved

### 1. Create Supabase project (5 min)

1. <https://supabase.com/dashboard> → New project.
2. Pick a region near US (e.g. us-east-1). Set a strong DB password — save it.
3. Wait ~2 min for it to provision.
4. SQL Editor → paste `supabase/schema.sql` → Run. This creates the `entities`
   table, the trigram index, and the `entities_fuzzy_search` RPC.

You'll need three values, all from the Supabase dashboard:

| Variable                       | Where                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `SUPABASE_URL`                 | Project Settings → API → "Project URL"                                |
| `SUPABASE_SERVICE_ROLE_KEY`    | Project Settings → API → "service_role" secret                        |
| `SUPABASE_DB_URL`              | Project Settings → Database → Connection string → URI (paste password) |

### 2. Seed the data (one-time, ~30–60 min on a laptop)

The bulk file from Sunbiz is a few hundred MB. Run this locally once; after
that, the GitHub Action keeps it fresh.

```bash
cd ingest
pip install -r requirements.txt
export SUPABASE_DB_URL='postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres'
python ingest.py
```

You'll see progress like:

```
Downloading /doc/quarterly/cor/cordata.zip -> cordata.zip
  Remote size: 412.7 MB
  Downloaded 412.7 MB
Parsing and upserting...
  Parsing cordata0.txt...
    321,540 read, 198,221 kept
  ...
    upserted 10,000
    upserted 20,000
  ...
Done. Total upserted: 1,847,326
```

Expect roughly **1.5–2M kept records** after filtering to active LLCs / corps / LPs.

> **Tight on free-tier disk?** Supabase free tier is 500MB. ~1.8M records of
> this width are around 350–450MB, which fits but is tight. If you hit the
> ceiling, edit `KEEP_FILING_TYPES` in `ingest/ingest.py` to drop non-profits
> and partnerships, or upgrade Supabase to Pro ($25/mo for 8GB).

### 3. Deploy the web app to Vercel (5 min)

1. Push this folder to a fresh GitHub repo.
2. <https://vercel.com/new> → Import the repo → framework auto-detects as Next.js.
3. Environment Variables → add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy. You'll get a URL like `sunbiz-lookup-xyz.vercel.app`.
5. (Optional) Add a custom domain in Vercel project settings.

You can share that URL with the client immediately.

### 4. Wire up weekly auto-refresh (3 min)

1. In the GitHub repo → Settings → Secrets and variables → Actions → New secret.
2. Add `SUPABASE_DB_URL` with the same value you used in step 2.
3. Done. `.github/workflows/refresh.yml` runs every Monday at 06:00 UTC.
   (You can also trigger it manually from the Actions tab.)

---

## How matching works

- **Normalization** — both stored names and the user query are normalized:
  lowercased, entity suffix stripped (`LLC`, `Inc`, `Corp`, etc.), punctuation
  collapsed. So `Smith Family L.L.C.`, `Smith Family, LLC` and `Smith Family
  LLC` all reduce to `smith family`.
- **Exact match first** on `corp_name_norm`. If hits, return them.
- **Trigram fuzzy match** via `pg_trgm` if no exact match. Returns top 5 ranked
  by similarity. Trigram threshold is `0.5` by default; lower it in the schema
  if you want more recall (more matches, more noise).

---

## Coverage caveat (set client expectations)

Sunbiz only contains entities **registered in Florida** — either domestic FL
entities or out-of-state entities that registered as foreign LLCs to do
business in FL. An LLC formed in Delaware / Wyoming / wherever that owns FL
property but never registered with the FL Department of State **will not be in
this dataset**. Realistic hit rate for FL STR / coastal property owner lists
is roughly 60–80%.

---

## Costs

| Component        | Tier              | Cost  | Notes                                          |
| ---------------- | ----------------- | ----- | ---------------------------------------------- |
| Vercel           | Hobby             | $0    | Plenty for a few hundred lookups/day           |
| Supabase         | Free              | $0    | 500MB DB, sufficient for filtered active set   |
| GitHub Actions   | Free              | $0    | Weekly 30–60 min job is well under free quota  |
| Sunbiz data      | Public            | $0    | Florida statute — explicitly public records    |
| **Total**        |                   | **$0** |                                                |

Upgrade triggers: if Supabase storage tips over 500MB after a refresh, either
tighten the ingest filters or move to Supabase Pro ($25/mo).

---

## Manual one-off refresh

From any machine with Python:

```bash
cd ingest
export SUPABASE_DB_URL='...'
python ingest.py
```

Or trigger the GitHub Action: repo → Actions → "Refresh Sunbiz data" → Run workflow.

---

## Local dev

```bash
npm install
cp .env.example .env.local
# fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run dev
# open http://localhost:3000
```

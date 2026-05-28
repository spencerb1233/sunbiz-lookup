# Ingest

Pulls `cordata.zip` from `sftp.floridados.gov` (public creds), parses the
fixed-width 1440-char records per the [Sunbiz field
spec](https://dos.sunbiz.org/data-definitions/cor.html), filters to active
entities likely to hold property, and bulk-upserts into the Supabase
`entities` table.

## One-time run

```bash
pip install -r requirements.txt
export SUPABASE_DB_URL='postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres'
python ingest.py
```

## What gets kept

- Status: `A` (active) only — toggle `KEEP_ACTIVE_ONLY` in `ingest.py` to also store inactive.
- Filing types: LLCs (FLAL, FORL), profit corps (DOMP, FORP), LPs (DOMLP, FORLP), non-profits (DOMNP, FORNP).
- Skipped: `AGENT` (registered-agent designations), `TRUST` (declarations of trust), `NPREG`.

## Reusing a previous download

If `ingest/cordata.zip` already exists, the script skips the SFTP download and
re-parses the existing file. Delete it to force a fresh download.

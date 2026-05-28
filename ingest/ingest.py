"""
Sunbiz cordata.zip ingest.

Pulls the quarterly bulk Florida corporate registry from the public SFTP server,
parses the 1440-char fixed-width records, filters to active LLCs / corps / LPs,
and bulk-upserts into the Supabase `entities` table.

Usage:
    pip install -r requirements.txt
    export SUPABASE_DB_URL='postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres'
    python ingest.py

The DB URL comes from Supabase: Project Settings -> Database -> Connection string -> URI.
"""

from __future__ import annotations

import io
import os
import re
import sys
import zipfile
from contextlib import contextmanager
from typing import Iterator

import paramiko
import psycopg2
from psycopg2.extras import execute_batch

# ---------------------------------------------------------------------------
# Sunbiz SFTP credentials (public, published by FL Dept of State)
# ---------------------------------------------------------------------------
SFTP_HOST = "sftp.floridados.gov"
SFTP_USER = "Public"
SFTP_PASS = "PubAccess1845!"
SFTP_PATH = "/Public/doc/quarterly/cor/cordata.zip"

# Which filing types to keep. These are the entity types likely to hold property.
# Skip: TRUST (declarations of trust), AGENT (registered-agent designations),
# NPREG (non-profit registrations).
KEEP_FILING_TYPES = {
    "DOMP",   # Domestic Profit
    "FORP",   # Foreign Profit
    "FLAL",   # Florida LLC
    "FORL",   # Foreign LLC
    "DOMLP",  # Domestic Limited Partnership
    "FORLP",  # Foreign Limited Partnership
    "DOMNP",  # Domestic Non-Profit (some PMCs are non-profit)
    "FORNP",  # Foreign Non-Profit
}

# Keep only active entities? Set False to also store inactive (dissolved/etc).
KEEP_ACTIVE_ONLY = True

# Fixed-width field map.  (start_position is 1-indexed per Sunbiz spec.)
# We convert to 0-indexed slices below.
FIELDS = {
    "corp_number":      (1,   12),
    "corp_name":        (13,  192),
    "status":           (205, 1),
    "filing_type":      (206, 15),
    "principal_addr_1": (221, 42),
    "principal_addr_2": (263, 42),
    "principal_city":   (305, 28),
    "principal_state":  (333, 2),
    "principal_zip":    (335, 10),
    "mail_addr_1":      (347, 42),
    "mail_addr_2":      (389, 42),
    "mail_city":        (431, 28),
    "mail_state":       (459, 2),
    "mail_zip":         (461, 10),
    "file_date":        (473, 8),
    "fei":              (481, 14),
    "officer_1_title":  (669, 4),
    "officer_1_name":   (674, 42),
    "officer_1_addr":   (716, 42),
    "officer_1_city":   (758, 28),
    "officer_1_state":  (786, 2),
    "officer_1_zip":    (788, 9),
    "officer_2_title":  (797, 4),
    "officer_2_name":   (802, 42),
    "officer_2_addr":   (844, 42),
    "officer_2_city":   (886, 28),
    "officer_2_state":  (914, 2),
    "officer_2_zip":    (916, 9),
}

UPSERT_SQL = """
insert into entities (
    corp_number, corp_name, corp_name_norm, status, filing_type,
    principal_addr_1, principal_addr_2, principal_city, principal_state, principal_zip,
    mail_addr_1, mail_addr_2, mail_city, mail_state, mail_zip,
    file_date, fei,
    officer_1_title, officer_1_name, officer_1_addr, officer_1_city, officer_1_state, officer_1_zip,
    officer_2_title, officer_2_name, officer_2_addr, officer_2_city, officer_2_state, officer_2_zip,
    updated_at
) values (
    %(corp_number)s, %(corp_name)s, %(corp_name_norm)s, %(status)s, %(filing_type)s,
    %(principal_addr_1)s, %(principal_addr_2)s, %(principal_city)s, %(principal_state)s, %(principal_zip)s,
    %(mail_addr_1)s, %(mail_addr_2)s, %(mail_city)s, %(mail_state)s, %(mail_zip)s,
    %(file_date)s, %(fei)s,
    %(officer_1_title)s, %(officer_1_name)s, %(officer_1_addr)s, %(officer_1_city)s, %(officer_1_state)s, %(officer_1_zip)s,
    %(officer_2_title)s, %(officer_2_name)s, %(officer_2_addr)s, %(officer_2_city)s, %(officer_2_state)s, %(officer_2_zip)s,
    now()
)
on conflict (corp_number) do update set
    corp_name = excluded.corp_name,
    corp_name_norm = excluded.corp_name_norm,
    status = excluded.status,
    filing_type = excluded.filing_type,
    principal_addr_1 = excluded.principal_addr_1,
    principal_addr_2 = excluded.principal_addr_2,
    principal_city = excluded.principal_city,
    principal_state = excluded.principal_state,
    principal_zip = excluded.principal_zip,
    mail_addr_1 = excluded.mail_addr_1,
    mail_addr_2 = excluded.mail_addr_2,
    mail_city = excluded.mail_city,
    mail_state = excluded.mail_state,
    mail_zip = excluded.mail_zip,
    file_date = excluded.file_date,
    fei = excluded.fei,
    officer_1_title = excluded.officer_1_title,
    officer_1_name = excluded.officer_1_name,
    officer_1_addr = excluded.officer_1_addr,
    officer_1_city = excluded.officer_1_city,
    officer_1_state = excluded.officer_1_state,
    officer_1_zip = excluded.officer_1_zip,
    officer_2_title = excluded.officer_2_title,
    officer_2_name = excluded.officer_2_name,
    officer_2_addr = excluded.officer_2_addr,
    officer_2_city = excluded.officer_2_city,
    officer_2_state = excluded.officer_2_state,
    officer_2_zip = excluded.officer_2_zip,
    updated_at = now();
"""


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------
ENTITY_SUFFIX_RE = re.compile(
    r"[,.\s]*(L\.?L\.?C\.?|INC\.?|CORP\.?|CORPORATION|COMPANY|CO\.?|LTD\.?|"
    r"L\.?P\.?|L\.?L\.?P\.?|LIMITED|PARTNERSHIP|TRUST|HOLDINGS)\.?$",
    re.IGNORECASE,
)
PUNCT_RE = re.compile(r"[^a-z0-9\s]")


def normalize_name(name: str) -> str:
    """Lowercase, strip entity suffix, strip punctuation, collapse whitespace."""
    s = (name or "").strip().lower()
    # Repeatedly strip trailing entity suffixes ("Smith Family LLC, Inc." -> "smith family")
    for _ in range(3):
        new = ENTITY_SUFFIX_RE.sub("", s).strip(" ,.")
        if new == s:
            break
        s = new
    s = PUNCT_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_record(line: str):
    """Parse one 1440-char fixed-width record. Returns dict, or None if it should be skipped."""
    if len(line) < 500:
        return None

    rec = {}
    for fname, (start, length) in FIELDS.items():
        # Sunbiz uses 1-indexed positions; convert to 0-indexed slices.
        rec[fname] = line[start - 1 : start - 1 + length].strip() or None

    # Filter
    if not rec["corp_number"] or not rec["corp_name"]:
        return None
    if KEEP_ACTIVE_ONLY and rec["status"] != "A":
        return None
    if rec["filing_type"] not in KEEP_FILING_TYPES:
        return None

    rec["corp_name_norm"] = normalize_name(rec["corp_name"])
    return rec


# ---------------------------------------------------------------------------
# SFTP download + zip stream
# ---------------------------------------------------------------------------
@contextmanager
def open_sftp():
    transport = paramiko.Transport((SFTP_HOST, 22))
    transport.connect(username=SFTP_USER, password=SFTP_PASS)
    sftp = paramiko.SFTPClient.from_transport(transport)
    try:
        yield sftp
    finally:
        sftp.close()
        transport.close()


def download_zip(local_path: str) -> None:
    print(f"Downloading {SFTP_PATH} -> {local_path}")
    with open_sftp() as sftp:
        size = sftp.stat(SFTP_PATH).st_size
        print(f"  Remote size: {size / 1_000_000:.1f} MB")
        with sftp.open(SFTP_PATH, 'rb') as remote, open(local_path, 'wb') as local:
            remote.prefetch = lambda *a, **kw: None
            remote.set_pipelined(False)
            downloaded = 0
            chunk = 1024 * 256
            while True:
                data = remote.read(chunk)
                if not data:
                    break
                local.write(data)
                downloaded += len(data)
                if downloaded % (50 * 1024 * 1024) < chunk:
                    print(f"    {downloaded / 1_000_000:.0f} MB / {size / 1_000_000:.0f} MB")
    print(f"  Downloaded {os.path.getsize(local_path) / 1_000_000:.1f} MB")


def iter_records(zip_path):
    """Yield filtered records from extracted cordata*.txt files."""
    import glob
    txt_dir = os.path.dirname(os.path.abspath(zip_path)) or "."
    txt_files = sorted(glob.glob(os.path.join(txt_dir, "cordata*.txt")))
    if not txt_files:
        raise RuntimeError(
            "No cordata*.txt files in " + txt_dir +
            ". Run: unzip " + zip_path + " first."
        )
    for name in txt_files:
        print("  Parsing " + os.path.basename(name) + "...")
        count_in = 0
        count_out = 0
        with open(name, "rb") as fh:
            for raw in io.TextIOWrapper(fh, encoding="latin-1", newline=""):
                count_in += 1
                rec = parse_record(raw.rstrip())
                if rec is not None:
                    count_out += 1
                    yield rec
        print("    {:,} read, {:,} kept".format(count_in, count_out))



def upsert_batches(records: Iterator[dict], db_url: str, batch_size: int = 1000) -> int:
    total = 0
    batch = []
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for rec in records:
                batch.append(rec)
                if len(batch) >= batch_size:
                    execute_batch(cur, UPSERT_SQL, batch, page_size=batch_size)
                    conn.commit()
                    total += len(batch)
                    if total % 10_000 == 0:
                        print(f"    upserted {total:,}")
                    batch.clear()
            if batch:
                execute_batch(cur, UPSERT_SQL, batch, page_size=len(batch))
                conn.commit()
                total += len(batch)
    finally:
        conn.close()
    return total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("ERROR: SUPABASE_DB_URL env var is required", file=sys.stderr)
        return 1

    zip_path = os.environ.get("CORDATA_ZIP", "cordata.zip")
    if not os.path.exists(zip_path):
        download_zip(zip_path)
    else:
        print(f"Reusing existing {zip_path}")

    print("Parsing and upserting...")
    total = upsert_batches(iter_records(zip_path), db_url)
    print(f"Done. Total upserted: {total:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

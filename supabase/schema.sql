-- Sunbiz Lookup - Supabase schema
-- Run this once in the Supabase SQL Editor before first ingest.

create extension if not exists pg_trgm;

create table if not exists entities (
  corp_number       text primary key,
  corp_name         text not null,
  corp_name_norm    text not null,
  status            text,
  filing_type       text,

  principal_addr_1  text,
  principal_addr_2  text,
  principal_city    text,
  principal_state   text,
  principal_zip     text,

  mail_addr_1       text,
  mail_addr_2       text,
  mail_city         text,
  mail_state        text,
  mail_zip          text,

  file_date         text,
  fei               text,

  officer_1_title   text,
  officer_1_name    text,
  officer_1_addr    text,
  officer_1_city    text,
  officer_1_state   text,
  officer_1_zip     text,

  officer_2_title   text,
  officer_2_name    text,
  officer_2_addr    text,
  officer_2_city    text,
  officer_2_state   text,
  officer_2_zip     text,

  updated_at        timestamptz default now()
);

-- Fuzzy match index on the normalized name (strip LLC/Inc/punctuation, lowercase).
create index if not exists entities_corp_name_norm_trgm
  on entities using gin (corp_name_norm gin_trgm_ops);

-- Exact-match fallback.
create index if not exists entities_corp_name_norm_eq
  on entities (corp_name_norm);

-- Optional: address lookups (uncomment if you want to search by mail address)
-- create index if not exists entities_mail_zip on entities (mail_zip);
-- create index if not exists entities_mail_state on entities (mail_state);

-- Fuzzy-search RPC used by the Next.js app.
-- Returns the top `lim` entities ordered by trigram similarity to `q`.
create or replace function entities_fuzzy_search(q text, lim int default 5)
returns setof entities
language sql stable as $$
  select *
  from entities
  where corp_name_norm % q
  order by similarity(corp_name_norm, q) desc, corp_name asc
  limit lim;
$$;

-- Tighten the similarity threshold a bit (default 0.3 is loose; 0.5 returns
-- only meaningful matches). Adjust if you want more recall.
-- select set_limit(0.5);


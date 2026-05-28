import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.",
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export type EntityRow = {
  corp_number: string;
  corp_name: string;
  corp_name_norm: string;
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
  file_date: string | null;
  fei: string | null;
  officer_1_title: string | null;
  officer_1_name: string | null;
  officer_1_addr: string | null;
  officer_1_city: string | null;
  officer_1_state: string | null;
  officer_1_zip: string | null;
  officer_2_title: string | null;
  officer_2_name: string | null;
  officer_2_addr: string | null;
  officer_2_city: string | null;
  officer_2_state: string | null;
  officer_2_zip: string | null;
};

/**
 * Find the best matching entity by normalized name.
 * Strategy:
 *   1. Exact match on normalized name -> return all matches (could be 0..N)
 *   2. Trigram similarity match (corp_name_norm % :query) ordered by similarity desc
 *   3. Limit to top N results
 */
export async function findEntities(
  normalizedName: string,
  limit = 5,
): Promise<EntityRow[]> {
  if (!normalizedName) return [];
  const sb = supabase();

  // Exact match first.
  const exact = await sb
    .from("entities")
    .select("*")
    .eq("corp_name_norm", normalizedName)
    .limit(limit);
  if (exact.error) throw new Error(exact.error.message);
  if (exact.data && exact.data.length > 0) return exact.data as EntityRow[];

  // Trigram fuzzy match via RPC (defined in schema). Fallback to ilike if RPC absent.
  const fuzzy = await sb.rpc("entities_fuzzy_search", {
    q: normalizedName,
    lim: limit,
  });
  if (!fuzzy.error && fuzzy.data) return fuzzy.data as EntityRow[];

  // Last-resort: prefix ilike (slower but always works).
  const fallback = await sb
    .from("entities")
    .select("*")
    .ilike("corp_name_norm", `${normalizedName}%`)
    .limit(limit);
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data || []) as EntityRow[];
}

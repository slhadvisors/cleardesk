-- ============================================================
-- Migration 027: §8 REGULATORY UPDATE FEED
-- ============================================================
-- ARCHITECTURE.md §8: the feed is built on the SAME global tax_law_knowledge
-- KB (§3.2) — not a separate source. Every current KB entry is automatically
-- a feed item. Tag each by category + applicability_criteria (turnover bracket,
-- scheme type) and cross-reference the client roster to surface "X clients
-- affected". Manual curation first (publish_tax_law_version), automation later.
--
-- Builds on 016 helpers + 017 (tax_law_knowledge). Idempotent.
-- ============================================================

-- Client roster attributes used to match applicability.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS turnover_bracket VARCHAR(40) DEFAULT NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gst_scheme       VARCHAR(40) DEFAULT NULL; -- e.g. regular, composition

-- Count clients in the CALLER's org affected by a KB entry's applicability.
-- A criterion that is absent/empty means "applies to all". SECURITY INVOKER so
-- the caller's RLS (org scope) applies to the contacts read.
CREATE OR REPLACE FUNCTION public.count_affected_clients(p_kb uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH crit AS (
    SELECT applicability_criteria AS c FROM tax_law_knowledge WHERE id = p_kb
  )
  SELECT COUNT(*)::int
  FROM contacts ct, crit
  WHERE
    ( NULLIF(crit.c->>'turnover_bracket','') IS NULL
      OR ct.turnover_bracket = crit.c->>'turnover_bracket' )
    AND
    ( NULLIF(crit.c->>'scheme_type','') IS NULL
      OR ct.gst_scheme = crit.c->>'scheme_type' );
$$;

-- The feed = current KB entries + this-org affected count. security_invoker so
-- the embedded count is scoped to the querying tenant's roster.
CREATE OR REPLACE VIEW public.regulatory_feed
WITH (security_invoker = on) AS
  SELECT
    k.id,
    k.topic_key,
    k.version,
    k.title,
    k.body,
    k.category,
    k.applicability_criteria,
    k.country_code,
    k.source_reference,
    k.last_verified_at,
    k.created_at,
    public.count_affected_clients(k.id) AS affected_clients
  FROM tax_law_knowledge k
  WHERE k.is_current
  ORDER BY k.last_verified_at DESC NULLS LAST;

COMMENT ON VIEW public.regulatory_feed IS '§8 Regulatory update feed: current tax_law_knowledge entries with a per-tenant "affected_clients" roster cross-reference. Read inherits the KB read policy (authenticated).';

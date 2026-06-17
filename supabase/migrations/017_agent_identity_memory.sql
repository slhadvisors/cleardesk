-- ============================================================
-- Migration 017: §3 AI AGENT IDENTITY, KNOWLEDGE DOMAINS & SHARED MEMORY
-- ============================================================
-- Implements ARCHITECTURE.md §3:
--   §3.1 AI agent identity / personas     -> agent_personas
--   §3.2 Two knowledge domains            -> tax_law_knowledge (global, versioned)
--                                            (client context = existing per-org tables)
--   §3.3 Shared client memory             -> client_relationship_memory
--                                            client_interaction_summaries (append-only)
--   §3.4 Structural confidentiality       -> tenant RLS via app_metadata only
--
-- NOTE: the existing `agents` table holds HUMAN staff (name/email/role/
-- compliance_rate). AI personas therefore live in `agent_personas`.
--
-- Builds on migration 016 helpers (app_metadata ONLY, client-unwritable):
--   public.current_org_id()  ·  public.is_developer()
--
-- Idempotent: safe to re-run. Run in Supabase SQL editor or `supabase db push`.
-- ============================================================


-- ============================================================
-- §3.1  AI AGENT IDENTITY  (per-org personas)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE agent_type_enum AS ENUM
    ('customer_support','calling','recovery','inbound_care');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS agent_personas (
    id                            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id               UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    agent_type                    agent_type_enum NOT NULL,
    display_name                  VARCHAR(120) NOT NULL,
    avatar_url                    TEXT    DEFAULT NULL,
    persona_tone                  TEXT    NOT NULL,
    requires_automated_disclosure BOOLEAN NOT NULL DEFAULT false,
    is_active                     BOOLEAN NOT NULL DEFAULT true,
    created_at                    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at                    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, agent_type)
);

COMMENT ON TABLE  agent_personas IS '§3.1 Per-org AI agent personas (distinct from the `agents` table, which is human staff). agent_type is the fixed role; display_name/avatar/persona_tone are org-customisable. Personas are NOT interchangeable — each tone is matched to its job.';
COMMENT ON COLUMN agent_personas.requires_automated_disclosure IS '§3.1 Recovery must disclose it is an automated assistant from the firm when asked (FDCPA-style debt-collection norms). Never let such a persona pass as a live human if pressed.';

CREATE INDEX IF NOT EXISTS idx_agent_personas_org ON agent_personas(organization_id);

ALTER TABLE agent_personas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant RLS: Agent Personas" ON agent_personas;
CREATE POLICY "Tenant RLS: Agent Personas" ON agent_personas
    FOR ALL
    USING (organization_id = public.current_org_id())
    WITH CHECK (organization_id = public.current_org_id());

DROP POLICY IF EXISTS "DEVELOPER bypass: Agent Personas" ON agent_personas;
CREATE POLICY "DEVELOPER bypass: Agent Personas" ON agent_personas
    FOR ALL USING (public.is_developer());

CREATE OR REPLACE FUNCTION trg_agent_personas_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS agent_personas_updated_at ON agent_personas;
CREATE TRIGGER agent_personas_updated_at
    BEFORE UPDATE ON agent_personas
    FOR EACH ROW EXECUTE FUNCTION trg_agent_personas_updated_at();

-- Seed the 4 default personas for every existing org that lacks them.
-- (Names align with ARCHITECTURE.md §3.3: Priya = Compliance/Support, Arjun = Recovery.)
INSERT INTO agent_personas (organization_id, agent_type, display_name, persona_tone, requires_automated_disclosure)
SELECT o.id, v.agent_type::agent_type_enum, v.display_name, v.persona_tone, v.disc
FROM organizations o
CROSS JOIN (VALUES
    ('customer_support', 'Priya', 'Measured, reassuring. Compliance and filing follow-ups.',              false),
    ('calling',          'Rohan', 'Brisk, energetic. Outbound prospect outreach.',                         false),
    ('recovery',         'Arjun', 'Firm but respectful. Fee recovery via calls + WhatsApp.',               true),
    ('inbound_care',     'Meera', 'Patient, solution-first. Inbound customer care with staff escalation.',  false)
) AS v(agent_type, display_name, persona_tone, disc)
ON CONFLICT (organization_id, agent_type) DO NOTHING;


-- ============================================================
-- §3.2  GLOBAL TAX-LAW KNOWLEDGE BASE  (shared, full row-versioning)
-- ============================================================
-- Global & shared across ALL tenants — NOT org-scoped. Distinct from
-- per-client "client context" (existing org-scoped tables), which must
-- never be merged with this (different freshness/update cadences).
-- Each new entry is automatically a §8 regulatory-feed item.
DO $$ BEGIN
  CREATE TYPE tax_kb_category_enum AS ENUM
    ('composition_scheme','e_invoicing','itc','due_dates','general');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tax_law_knowledge (
    id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    topic_key              VARCHAR(120) NOT NULL,          -- groups every version of one topic
    version                INT NOT NULL DEFAULT 1,
    is_current             BOOLEAN NOT NULL DEFAULT true,
    title                  VARCHAR(255) NOT NULL,
    body                   TEXT NOT NULL,
    category               tax_kb_category_enum NOT NULL DEFAULT 'general',
    applicability_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {turnover_bracket, scheme_type, ...} for §8 client cross-ref
    country_code           VARCHAR(5) DEFAULT 'IN' CHECK (country_code IN ('IN','US','AE')),
    source_reference       TEXT DEFAULT NULL,
    last_verified_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),  -- §3.2 "last verified" date, staff-visible
    verified_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    superseded_at          TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    UNIQUE (topic_key, version)
);

COMMENT ON TABLE tax_law_knowledge IS '§3.2 Global, shared, versioned tax-law KB. Full row-versioning: each edit inserts a new version row; old versions retained for audit (compliance liability). Feeds the §8 regulatory update feed.';

-- Exactly one current version per topic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_kb_one_current
    ON tax_law_knowledge(topic_key) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_tax_kb_category ON tax_law_knowledge(category) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_tax_kb_verified ON tax_law_knowledge(last_verified_at DESC) WHERE is_current;

ALTER TABLE tax_law_knowledge ENABLE ROW LEVEL SECURITY;

-- Read: every authenticated user/persona (global knowledge, no secrets).
DROP POLICY IF EXISTS "Tax KB read: authenticated" ON tax_law_knowledge;
CREATE POLICY "Tax KB read: authenticated" ON tax_law_knowledge
    FOR SELECT TO authenticated USING (true);

-- Write: ClearDesk internal team only (DEVELOPER). §8 starts with manual curation.
DROP POLICY IF EXISTS "Tax KB write: developer" ON tax_law_knowledge;
CREATE POLICY "Tax KB write: developer" ON tax_law_knowledge
    FOR ALL USING (public.is_developer()) WITH CHECK (public.is_developer());

-- Helper: publish a new version atomically (supersedes the current one).
-- SECURITY INVOKER so the DEVELOPER-write RLS above still applies.
CREATE OR REPLACE FUNCTION public.publish_tax_law_version(
    p_topic_key     text,
    p_title         text,
    p_body          text,
    p_category      tax_kb_category_enum DEFAULT 'general',
    p_applicability jsonb DEFAULT '{}'::jsonb,
    p_country       text  DEFAULT 'IN',
    p_source        text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_next INT;
    v_id   uuid;
BEGIN
    SELECT COALESCE(MAX(version),0)+1 INTO v_next
    FROM tax_law_knowledge WHERE topic_key = p_topic_key;

    UPDATE tax_law_knowledge
       SET is_current = false, superseded_at = NOW()
     WHERE topic_key = p_topic_key AND is_current;

    INSERT INTO tax_law_knowledge
        (topic_key, version, is_current, title, body, category,
         applicability_criteria, country_code, source_reference,
         last_verified_at, verified_by)
    VALUES
        (p_topic_key, v_next, true, p_title, p_body, p_category,
         p_applicability, p_country, p_source, NOW(), auth.uid())
    RETURNING id INTO v_id;

    RETURN v_id;
END; $$;


-- ============================================================
-- §3.3  SHARED CLIENT RELATIONSHIP MEMORY  (one row per client)
-- ============================================================
-- ONE record per client, shared across ALL agent personas (not siloed).
-- INTERNAL USE ONLY: never read back to the client verbatim, never visible
-- across different clients (enforced structurally by tenant RLS below).
CREATE TABLE IF NOT EXISTS client_relationship_memory (
    id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id        UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    client_id              UUID REFERENCES contacts(id)      ON DELETE CASCADE NOT NULL,
    -- comms style + preferences
    preferred_language     VARCHAR(20) DEFAULT NULL,
    preferred_channel      VARCHAR(20) DEFAULT NULL
                             CHECK (preferred_channel IS NULL OR preferred_channel IN ('call','whatsapp','sms','email')),
    preferred_contact_time VARCHAR(60) DEFAULT NULL,
    communication_style    TEXT DEFAULT NULL,
    tone_that_works        TEXT DEFAULT NULL,
    -- sentiment
    current_sentiment      VARCHAR(20) DEFAULT NULL,
    sentiment_history      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ts, signal, score, source}]
    anxiety_triggers       TEXT[] DEFAULT '{}',                  -- e.g. {deadlines, payment}
    -- prior commitments
    prior_commitments      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ts, by:'client'|'agent', commitment, due_date, status}]
    -- rollup
    last_interaction_at    TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (client_id)
);

COMMENT ON TABLE client_relationship_memory IS '§3.3 One shared memory record per client across all agent personas (Priya & Arjun both see it). INTERNAL ONLY — never surfaced to the client verbatim, never cross-client. Tenant-isolated via RLS.';

CREATE INDEX IF NOT EXISTS idx_crm_mem_org    ON client_relationship_memory(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_mem_client ON client_relationship_memory(client_id);

ALTER TABLE client_relationship_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant RLS: Client Memory" ON client_relationship_memory;
CREATE POLICY "Tenant RLS: Client Memory" ON client_relationship_memory
    FOR ALL
    USING (organization_id = public.current_org_id())
    WITH CHECK (organization_id = public.current_org_id());

DROP POLICY IF EXISTS "DEVELOPER bypass: Client Memory" ON client_relationship_memory;
CREATE POLICY "DEVELOPER bypass: Client Memory" ON client_relationship_memory
    FOR ALL USING (public.is_developer());

CREATE OR REPLACE FUNCTION trg_crm_mem_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS crm_mem_updated_at ON client_relationship_memory;
CREATE TRIGGER crm_mem_updated_at
    BEFORE UPDATE ON client_relationship_memory
    FOR EACH ROW EXECUTE FUNCTION trg_crm_mem_updated_at();


-- ── Append-only interaction summary log (child of the memory record) ──
CREATE TABLE IF NOT EXISTS client_interaction_summaries (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    client_id       UUID REFERENCES contacts(id)      ON DELETE CASCADE NOT NULL,
    agent_type      agent_type_enum DEFAULT NULL,
    channel         VARCHAR(20) DEFAULT NULL,
    summary         TEXT NOT NULL,
    occurred_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE client_interaction_summaries IS '§3.3 Append-only short summaries of past conversations (ts, agent_type, channel). Feeds the shared client_relationship_memory rollup. INTERNAL ONLY.';

CREATE INDEX IF NOT EXISTS idx_cis_client ON client_interaction_summaries(client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cis_org    ON client_interaction_summaries(organization_id);

ALTER TABLE client_interaction_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant RLS: Interaction Summaries" ON client_interaction_summaries;
CREATE POLICY "Tenant RLS: Interaction Summaries" ON client_interaction_summaries
    FOR ALL
    USING (organization_id = public.current_org_id())
    WITH CHECK (organization_id = public.current_org_id());

DROP POLICY IF EXISTS "DEVELOPER bypass: Interaction Summaries" ON client_interaction_summaries;
CREATE POLICY "DEVELOPER bypass: Interaction Summaries" ON client_interaction_summaries
    FOR ALL USING (public.is_developer());

-- Touch the shared memory row's last_interaction_at whenever a summary lands
-- (upserts a memory row if none exists yet).
CREATE OR REPLACE FUNCTION trg_cis_touch_memory()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO client_relationship_memory (organization_id, client_id, last_interaction_at)
    VALUES (NEW.organization_id, NEW.client_id, NEW.occurred_at)
    ON CONFLICT (client_id) DO UPDATE
        SET last_interaction_at = GREATEST(
                COALESCE(client_relationship_memory.last_interaction_at, NEW.occurred_at),
                NEW.occurred_at),
            updated_at = NOW();
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS cis_touch_memory ON client_interaction_summaries;
CREATE TRIGGER cis_touch_memory
    AFTER INSERT ON client_interaction_summaries
    FOR EACH ROW EXECUTE FUNCTION trg_cis_touch_memory();


-- ============================================================
-- §3.4  STRUCTURAL CONFIDENTIALITY — notes & verification
-- ============================================================
-- All §3 tables above scope tenants via public.current_org_id() /
-- public.is_developer(), which read app_metadata ONLY (client-unwritable).
-- They DO NOT expose company secrets: internal financials, pricing, API
-- keys, vendor contracts, other clients' data and system prompts live in
-- organization_developer_vault / platform_settings, which are DEVELOPER-
-- only and are NOT in any persona-readable view. Client-facing personas
-- must run under the tenant (authenticated) role — never service_role — so
-- they are STRUCTURALLY incapable of reaching secret scope (§3.4), with
-- prompt instructions as a second layer only.
--
-- VERIFICATION (run after applying; any row = a policy still trusting
-- client-writable user_metadata and must be fixed):
--   SELECT schemaname, tablename, policyname, qual
--   FROM pg_policies
--   WHERE tablename IN ('agent_personas','tax_law_knowledge',
--                       'client_relationship_memory','client_interaction_summaries')
--     AND (qual ILIKE '%user_metadata%' OR with_check ILIKE '%user_metadata%');
-- ============================================================

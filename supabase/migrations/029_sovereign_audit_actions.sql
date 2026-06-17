-- ============================================================
-- Migration 029: §9 Sovereign Vault — access log + action approvals
-- ============================================================
-- Every cross-tenant touch is logged (who/what org/when/why). Destructive
-- Actions need a reason + audit; the most dangerous need TWO-PERSON approval
-- (approver != requester): org_deletion, mass_action, refund, impersonate,
-- data_export. Builds on 028 helpers. Idempotent.
-- ============================================================

-- ── Cross-tenant access log ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sovereign_access_log (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    actor_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    internal_role internal_role_enum DEFAULT NULL,
    action        VARCHAR(80) NOT NULL,        -- e.g. 'view_org', 'request:refund'
    target_org_id UUID DEFAULT NULL,
    reason        TEXT DEFAULT NULL,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
COMMENT ON TABLE sovereign_access_log IS '§9 Append-only audit of every cross-tenant Sovereign Vault access/action (who, org, when, why).';

CREATE INDEX IF NOT EXISTS idx_sov_log_actor ON sovereign_access_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sov_log_org   ON sovereign_access_log(target_org_id, created_at DESC);

ALTER TABLE sovereign_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sovereign: log read" ON sovereign_access_log;
CREATE POLICY "Sovereign: log read" ON sovereign_access_log
    FOR SELECT USING (public.is_sovereign());
DROP POLICY IF EXISTS "Sovereign: log insert" ON sovereign_access_log;
CREATE POLICY "Sovereign: log insert" ON sovereign_access_log
    FOR INSERT WITH CHECK (public.is_sovereign() AND actor_id = auth.uid());

-- ── Action approvals (two-person where required) ────────────────────
CREATE TABLE IF NOT EXISTS sovereign_actions (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    actor_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
    action_type         sovereign_action_enum NOT NULL,
    target_org_id       UUID DEFAULT NULL,
    reason              TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    requires_two_person BOOLEAN NOT NULL DEFAULT false,
    status              sovereign_action_status_enum NOT NULL DEFAULT 'pending',
    approved_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at         TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    executed_at         TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
COMMENT ON TABLE sovereign_actions IS '§9 Sovereign Vault destructive-action queue with reason + two-person approval (approver != actor) for the most dangerous types.';

CREATE INDEX IF NOT EXISTS idx_sov_actions_status ON sovereign_actions(status, created_at DESC);

ALTER TABLE sovereign_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sovereign: actions read" ON sovereign_actions;
CREATE POLICY "Sovereign: actions read" ON sovereign_actions
    FOR SELECT USING (public.is_sovereign());

-- Which action types demand two-person approval.
CREATE OR REPLACE FUNCTION public.sovereign_needs_two_person(p_action sovereign_action_enum)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_action IN ('org_deletion','mass_action','refund','impersonate','data_export');
$$;

-- Request an action: caller must be internal + hold the matching capability +
-- give a reason. Logs to the audit trail. Returns the action id.
CREATE OR REPLACE FUNCTION public.request_sovereign_action(
    p_action sovereign_action_enum,
    p_target_org uuid,
    p_reason text,
    p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_two boolean;
BEGIN
  IF NOT public.is_sovereign() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF NOT public.internal_has_cap(p_action::text) THEN RAISE EXCEPTION 'missing capability: %', p_action; END IF;
  IF coalesce(btrim(p_reason),'') = '' THEN RAISE EXCEPTION 'reason required'; END IF;
  v_two := public.sovereign_needs_two_person(p_action);
  INSERT INTO sovereign_actions (actor_id, action_type, target_org_id, reason, payload, requires_two_person, status)
  VALUES (auth.uid(), p_action, p_target_org, p_reason, coalesce(p_payload,'{}'::jsonb), v_two,
          CASE WHEN v_two THEN 'pending' ELSE 'approved' END)
  RETURNING id INTO v_id;
  INSERT INTO sovereign_access_log (actor_id, internal_role, action, target_org_id, reason, metadata)
  VALUES (auth.uid(), public.internal_role_of(), 'request:'||p_action::text, p_target_org, p_reason, jsonb_build_object('action_id', v_id, 'two_person', v_two));
  RETURN v_id;
END; $$;

-- Approve a pending action: approver must be internal, hold the capability, and
-- be a DIFFERENT person than the requester (two-person rule). Logs it.
CREATE OR REPLACE FUNCTION public.approve_sovereign_action(p_action_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rec sovereign_actions%ROWTYPE;
BEGIN
  IF NOT public.is_sovereign() THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO v_rec FROM sovereign_actions WHERE id = p_action_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'action not found'; END IF;
  IF v_rec.status <> 'pending' THEN RAISE EXCEPTION 'action not pending'; END IF;
  IF NOT public.internal_has_cap(v_rec.action_type::text) THEN RAISE EXCEPTION 'missing capability'; END IF;
  IF v_rec.actor_id = auth.uid() THEN RAISE EXCEPTION 'two-person rule: approver must differ from requester'; END IF;
  UPDATE sovereign_actions SET status='approved', approved_by=auth.uid(), approved_at=NOW() WHERE id = p_action_id;
  INSERT INTO sovereign_access_log (actor_id, internal_role, action, target_org_id, reason, metadata)
  VALUES (auth.uid(), public.internal_role_of(), 'approve:'||v_rec.action_type::text, v_rec.target_org_id, v_rec.reason, jsonb_build_object('action_id', p_action_id));
END; $$;

-- Lock down EXECUTE: internal checks live inside; never expose to anon.
REVOKE EXECUTE ON FUNCTION public.request_sovereign_action(sovereign_action_enum, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_sovereign_action(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_sovereign_action(sovereign_action_enum, uuid, text, jsonb) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.approve_sovereign_action(uuid) TO authenticated;

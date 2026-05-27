# ClearDesk — Deployment Checklist

## 1. Supabase Migrations (run in order in SQL Console)

Go to: https://supabase.com/dashboard → your project → SQL Editor

Run each file in sequence:

| File | What it creates |
|------|----------------|
| `supabase/migrations/004_crm_webhook_logs.sql` | `call_logs` + `crm_webhook_logs` tables, RLS, wallet deduction trigger |
| `supabase/migrations/005_ops_developer_rls.sql` | `auth.is_developer()` fn + DEVELOPER bypass policies for all tables |
| `supabase/migrations/006_platform_settings.sql` | `platform_settings` table + seed maintenance_mode row |
| `supabase/migrations/007_contacts.sql` | `contacts` table + RLS + updated_at trigger |

> ⚠️ Run 005 before 007 — `auth.is_developer()` must exist before contacts policies reference it.

---

## 2. Edge Function Secrets

Go to: Supabase Dashboard → Edge Functions → Manage Secrets

### `vapi-dispatch`
| Key | Value | Where to get |
|-----|-------|-------------|
| `VAPI_API_KEY` | `sk-...` | Vapi Dashboard → API Keys |
| `VAPI_ASSISTANT_ID` | `asst_...` | Vapi Dashboard → Assistants → your assistant |
| `VAPI_PHONE_ID_IN` | `phone_...` | Vapi Dashboard → Phone Numbers → IN number |
| `VAPI_PHONE_ID_US` | `phone_...` | Vapi Dashboard → Phone Numbers → US number |
| `VAPI_PHONE_ID_AE` | `phone_...` | Vapi Dashboard → Phone Numbers → AE number |

### `vapi-webhook`
| Key | Value | Where to get |
|-----|-------|-------------|
| `VAPI_WEBHOOK_SECRET` | generate with `openssl rand -base64 32` | self-generated |

Then set in Vapi: Dashboard → Settings → Integrations → Custom Credential → Bearer Token → paste secret.
Set webhook URL on your assistant: `https://<project-ref>.supabase.co/functions/v1/vapi-webhook`

### `crm-webhook`
| Key | Value | Where to get |
|-----|-------|-------------|
| `WEBHOOK_SIGNING_SECRET` | generate with `openssl rand -base64 32` | self-generated |

---

## 3. Deploy Edge Functions

```bash
supabase functions deploy vapi-dispatch
supabase functions deploy vapi-webhook
supabase functions deploy crm-webhook
```

---

## 4. Vercel — Environment Variables

Not needed (all secrets live in Supabase Edge Function secrets, not Vercel env vars).
The frontend uses the public anon key only (`supabase-config.js`).

---

## 5. Domain (when ready)

1. Buy `cleardesk.com` via Vercel Dashboard → Domains
2. Add subdomain `ops.cleardesk.com` → points to same Vercel project
3. `vercel.json` rewrite already configured — ops subdomain → `/ops.html`

// api/send-message.js
// ClearDesk → Twilio message send (WhatsApp / SMS).
// Vercel serverless function. Uses native fetch (Node 18+) — no SDK install needed.
//
// Env vars required (Vercel project settings + local .env):
//   TWILIO_ACCOUNT_SID   ACxxxxxxxx...
//   TWILIO_AUTH_TOKEN    xxxxxxxx...
//   TWILIO_WHATSAPP_FROM whatsapp:+14155238886   (Twilio WhatsApp sandbox number; override once a prod sender is approved)
//   TWILIO_SMS_FROM      +1...                    (a purchased Twilio number; required for channel=sms)
//
// Trial-account notes:
//   - WhatsApp: works via sandbox. Recipient must have joined the sandbox ("join <code>").
//   - SMS to India (+91): blocked on trial. Needs upgraded account + DLT registration. See CLAUDE.md / project memory.
//   - All recipients must be Verified Caller IDs on a trial account.

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// Normalize a destination for the chosen channel.
function buildAddresses({ channel, to }) {
  if (channel === "whatsapp") {
    const from = process.env.TWILIO_WHATSAPP_FROM;
    if (!from) throw new Error("TWILIO_WHATSAPP_FROM not set");
    const toAddr = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const fromAddr = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
    return { fromAddr, toAddr };
  }
  // sms
  const from = process.env.TWILIO_SMS_FROM;
  if (!from) throw new Error("TWILIO_SMS_FROM not set (buy a Twilio number first)");
  return { fromAddr: from, toAddr: to };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed. Use POST." });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return json(res, 500, { error: "Twilio credentials not configured on server." });
  }

  // Body may already be parsed by Vercel; fall back to manual parse.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const channel = (body.channel || "whatsapp").toLowerCase();
  const to = body.to;
  const text = body.body;

  if (!to || !text) {
    return json(res, 400, { error: "Required fields: to, body. Optional: channel ('whatsapp'|'sms')." });
  }
  if (channel !== "whatsapp" && channel !== "sms") {
    return json(res, 400, { error: "channel must be 'whatsapp' or 'sms'." });
  }

  let fromAddr, toAddr;
  try {
    ({ fromAddr, toAddr } = buildAddresses({ channel, to }));
  } catch (e) {
    return json(res, 400, { error: e.message });
  }

  const form = new URLSearchParams({ To: toAddr, From: fromAddr, Body: text });

  try {
    const tw = await fetch(`${TWILIO_BASE}/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = await tw.json();

    if (!tw.ok) {
      // Twilio returns { code, message, more_info, status } on error.
      return json(res, 502, {
        error: "Twilio rejected the message.",
        twilio_code: data.code,
        twilio_message: data.message,
        more_info: data.more_info,
      });
    }

    return json(res, 202, {
      accepted: true,
      sid: data.sid,
      status: data.status,
      channel,
      to: toAddr,
    });
  } catch (e) {
    return json(res, 500, { error: "Send failed: " + e.message });
  }
};

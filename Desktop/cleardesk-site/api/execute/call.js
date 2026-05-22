import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, userId, contact, campaign, integration } = req.body;

    // Initialize Twilio client
    const client = twilio(integration.api_key, integration.api_secret, {
      accountSid: integration.account_sid
    });

    // Create call log entry
    const { data: callLog } = await supabase
      .from('call_logs')
      .insert({
        user_id: userId,
        campaign_id: campaignId,
        recipient_name: contact.name,
        recipient_phone: contact.phone,
        status: 'pending'
      })
      .select()
      .single();

    // Build TwiML for AI agent
    const twiml = `
      <Response>
        <Say voice="${campaign.agent_configs?.voice_id || 'Polly.Joanna'}">
          ${campaign.agent_configs?.system_prompt || 'Hello, this is an automated call.'}
        </Say>
        <Pause length="2"/>
        <Say>Thank you for your time. Goodbye.</Say>
      </Response>
    `;

    // Make call via Twilio
    const call = await client.calls.create({
      to: contact.phone,
      from: integration.phone_number,
      twiml: twiml,
      statusCallback: `${process.env.VERCEL_URL}/api/webhooks/call-status?logId=${callLog.id}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
    });

    // Update call log with Twilio SID
    await supabase
      .from('call_logs')
      .update({ 
        status: 'initiated',
        started_at: new Date().toISOString()
      })
      .eq('id', callLog.id);

    res.json({ 
      success: true, 
      callSid: call.sid,
      logId: callLog.id 
    });

  } catch (error) {
    console.error('Call execution error:', error);
    res.status(500).json({ error: error.message });
  }
}
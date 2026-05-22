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

    // Build message from agent prompt
    const message = campaign.agent_configs?.system_prompt || 
      'Hello! This is an automated message from our team.';

    // Create SMS log entry
    const { data: smsLog } = await supabase
      .from('sms_logs')
      .insert({
        user_id: userId,
        campaign_id: campaignId,
        recipient_name: contact.name,
        recipient_phone: contact.phone,
        message: message,
        status: 'pending'
      })
      .select()
      .single();

    // Send SMS via Twilio
    const sms = await client.messages.create({
      to: contact.phone,
      from: integration.phone_number,
      body: message,
      statusCallback: `${process.env.VERCEL_URL}/api/webhooks/sms-status?logId=${smsLog.id}`
    });

    // Update SMS log with Twilio SID
    await supabase
      .from('sms_logs')
      .update({ 
        status: 'sent',
        sent_at: new Date().toISOString()
      })
      .eq('id', smsLog.id);

    res.json({ 
      success: true, 
      messageSid: sms.sid,
      logId: smsLog.id 
    });

  } catch (error) {
    console.error('SMS execution error:', error);
    res.status(500).json({ error: error.message });
  }
}
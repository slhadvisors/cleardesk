import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { logId } = req.query;
    const { MessageStatus } = req.body;

    const updates = {
      status: MessageStatus.toLowerCase(),
      delivery_status: MessageStatus,
      updated_at: new Date().toISOString()
    };

    if (MessageStatus === 'delivered') {
      updates.delivered_at = new Date().toISOString();
    }

    await supabase
      .from('sms_logs')
      .update(updates)
      .eq('id', logId);

    // Update campaign stats
    if (MessageStatus === 'delivered' || MessageStatus === 'failed') {
      const { data: smsLog } = await supabase
        .from('sms_logs')
        .select('campaign_id, status')
        .eq('id', logId)
        .single();

      if (smsLog) {
        const { data: campaign } = await supabase
          .from('campaigns')
          .select('completed_count, success_count')
          .eq('id', smsLog.campaign_id)
          .single();

        await supabase
          .from('campaigns')
          .update({
            completed_count: (campaign.completed_count || 0) + 1,
            success_count: MessageStatus === 'delivered'
              ? (campaign.success_count || 0) + 1 
              : campaign.success_count
          })
          .eq('id', smsLog.campaign_id);
      }
    }

    res.json({ success: true });

  } catch (error) {
    console.error('SMS webhook error:', error);
    res.status(500).json({ error: error.message });
  }
}
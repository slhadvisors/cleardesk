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
    const { CallStatus, CallDuration, RecordingUrl } = req.body;

    const updates = {
      status: CallStatus.toLowerCase(),
      updated_at: new Date().toISOString()
    };

    if (CallDuration) {
      updates.duration = parseInt(CallDuration);
      updates.ended_at = new Date().toISOString();
    }

    if (RecordingUrl) {
      updates.recording_url = RecordingUrl;
    }

    // Determine outcome
    if (CallStatus === 'completed') {
      updates.outcome = CallDuration > 10 ? 'success' : 'voicemail';
    } else if (CallStatus === 'busy') {
      updates.outcome = 'busy';
    } else if (CallStatus === 'no-answer') {
      updates.outcome = 'no-answer';
    } else if (CallStatus === 'failed') {
      updates.outcome = 'failed';
    }

    await supabase
      .from('call_logs')
      .update(updates)
      .eq('id', logId);

    // Update campaign stats
    if (CallStatus === 'completed') {
      const { data: callLog } = await supabase
        .from('call_logs')
        .select('campaign_id, outcome')
        .eq('id', logId)
        .single();

      if (callLog) {
        const { data: campaign } = await supabase
          .from('campaigns')
          .select('completed_count, success_count')
          .eq('id', callLog.campaign_id)
          .single();

        await supabase
          .from('campaigns')
          .update({
            completed_count: (campaign.completed_count || 0) + 1,
            success_count: callLog.outcome === 'success' 
              ? (campaign.success_count || 0) + 1 
              : campaign.success_count
          })
          .eq('id', callLog.campaign_id);
      }
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Call webhook error:', error);
    res.status(500).json({ error: error.message });
  }
}
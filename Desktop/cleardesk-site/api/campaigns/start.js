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
    const { campaignId, userId, contacts } = req.body;

    // Update campaign status
    await supabase
      .from('campaigns')
      .update({ 
        status: 'running',
        started_at: new Date().toISOString(),
        target_count: contacts.length
      })
      .eq('id', campaignId)
      .eq('user_id', userId);

    // Get campaign details
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('*, agent_configs(*)')
      .eq('id', campaignId)
      .single();

    // Get integration config
    const providerType = campaign.campaign_type === 'call' ? 'voice' : 'sms';
    const { data: integration } = await supabase
      .from('integration_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_type', providerType)
      .eq('is_active', true)
      .single();

    if (!integration) {
      return res.status(400).json({ error: 'No active integration configured' });
    }

    // Execute campaign
    const executeUrl = campaign.campaign_type === 'call' 
      ? `${process.env.VERCEL_URL}/api/execute/call`
      : `${process.env.VERCEL_URL}/api/execute/sms`;

    const results = await Promise.allSettled(
      contacts.map(contact =>
        fetch(executeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            userId,
            contact,
            campaign,
            integration
          })
        })
      )
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;

    res.json({ 
      success: true, 
      executed: contacts.length,
      successful: successCount 
    });

  } catch (error) {
    console.error('Campaign start error:', error);
    res.status(500).json({ error: error.message });
  }
}

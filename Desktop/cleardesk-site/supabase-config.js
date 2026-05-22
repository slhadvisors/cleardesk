// Supabase configuration
const SUPABASE_URL = 'https://grudvsgmbyobilqnvoof.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdydWR2c2dtYnlvYmlscW52b29mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzODU3NTQsImV4cCI6MjA5NDk2MTc1NH0._vpHj5tyrkY6yYAP3m3yn2clA1mqT4OjUrJ4W24ZY1s';

// Initialize Supabase client (using window.supabase from CDN)
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
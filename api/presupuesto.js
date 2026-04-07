const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://ffiyprmbrznofoprvvik.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmaXlwcm1icnpub2ZvcHJ2dmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjU2OTYsImV4cCI6MjA5MDc0MTY5Nn0.DesBbR1Az0i-nokR8d7TiJS6zQu3dF-cBfVPlJpcoRg'
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });

  try {
    const { data: pres, error } = await sb
      .from('presupuestos')
      .select('*')
      .eq('token_publico', token)
      .single();

    if (error || !pres) return res.status(404).json({ error: 'Presupuesto no encontrado' });

    const { data: lineas } = await sb
      .from('presupuesto_lineas')
      .select('*')
      .eq('presupuesto_id', pres.id)
      .order('orden');

    return res.status(200).json({ presupuesto: pres, lineas: lineas || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

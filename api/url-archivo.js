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

  const { bucket, path } = req.query;
  if (!bucket || !path) return res.status(400).json({ error: 'Faltan parámetros (bucket, path)' });
  if (!['pedido-archivos', 'cliente-artes'].includes(bucket)) return res.status(400).json({ error: 'Bucket inválido' });

  try {
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600); // 1h
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ url: data.signedUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

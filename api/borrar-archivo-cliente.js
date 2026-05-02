const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://ffiyprmbrznofoprvvik.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmaXlwcm1icnpub2ZvcHJ2dmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjU2OTYsImV4cCI6MjA5MDc0MTY5Nn0.DesBbR1Az0i-nokR8d7TiJS6zQu3dF-cBfVPlJpcoRg'
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { archivo_id, token } = body;
    if (!archivo_id || !token) return res.status(400).json({ error: 'Faltan parámetros (archivo_id, token)' });

    // Validar que el token corresponde al pedido del archivo
    const { data: arch, error: eArch } = await sb
      .from('pedido_archivos')
      .select('id, storage_path, pedido_id')
      .eq('id', archivo_id)
      .single();
    if (eArch || !arch) return res.status(404).json({ error: 'Archivo no encontrado' });

    const { data: ped } = await sb
      .from('pedidos')
      .select('archivos_token, fase')
      .eq('id', arch.pedido_id)
      .single();
    if (!ped || ped.archivos_token !== token) return res.status(403).json({ error: 'Token no válido para este archivo' });

    const cerrado = ped.fase >= 5;
    if (cerrado) return res.status(403).json({ error: 'Pedido cerrado, no se puede modificar' });

    // Borrar del bucket
    await sb.storage.from('pedido-archivos').remove([arch.storage_path]);
    // Borrar registro
    await sb.from('pedido_archivos').delete().eq('id', archivo_id);

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

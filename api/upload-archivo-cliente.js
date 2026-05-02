const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://ffiyprmbrznofoprvvik.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmaXlwcm1icnpub2ZvcHJ2dmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjU2OTYsImV4cCI6MjA5MDc0MTY5Nn0.DesBbR1Az0i-nokR8d7TiJS6zQu3dF-cBfVPlJpcoRg'
);

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB (limite global Supabase)
const MAX_ARCHIVOS_POR_PEDIDO = 15;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Body JSON: { token, nombre_archivo, mime_type, contenido_base64 }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { token, nombre_archivo, mime_type, contenido_base64 } = body;

    if (!token || !nombre_archivo || !contenido_base64) {
      return res.status(400).json({ error: 'Faltan parámetros (token, nombre_archivo, contenido_base64)' });
    }

    // Validar pedido
    const { data: pedido, error: ePed } = await sb
      .from('pedidos')
      .select('id, fase')
      .eq('archivos_token', token)
      .single();
    if (ePed || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const cerrado = pedido.fase >= 5;
    if (cerrado) return res.status(403).json({ error: 'Este pedido ya está cerrado, no se admiten más archivos' });

    // Validar tamaño
    const buf = Buffer.from(contenido_base64, 'base64');
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: 'Archivo demasiado grande. Máximo 50 MB. Para ficheros mayores, contacta con la tienda.' });
    }

    // Validar cantidad
    const { count } = await sb
      .from('pedido_archivos')
      .select('id', { count: 'exact', head: true })
      .eq('pedido_id', pedido.id);
    if ((count || 0) >= MAX_ARCHIVOS_POR_PEDIDO) {
      return res.status(429).json({ error: 'Has alcanzado el máximo de ' + MAX_ARCHIVOS_POR_PEDIDO + ' archivos. Contacta con la tienda.' });
    }

    // Subir al bucket
    const limpio = (nombre_archivo || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 80);
    const path = `pedido-${pedido.id}/${Date.now()}_${limpio}`;
    const { error: eUp } = await sb.storage
      .from('pedido-archivos')
      .upload(path, buf, { contentType: mime_type || 'application/octet-stream', upsert: false });
    if (eUp) return res.status(500).json({ error: 'Error subiendo: ' + eUp.message });

    // Registrar en BD
    const { data: registro, error: eReg } = await sb
      .from('pedido_archivos')
      .insert([{
        pedido_id: pedido.id,
        nombre_original: nombre_archivo,
        storage_path: path,
        mime_type: mime_type || null,
        tamano_bytes: buf.length
      }])
      .select()
      .single();
    if (eReg) {
      // Rollback: borrar del bucket
      await sb.storage.from('pedido-archivos').remove([path]);
      return res.status(500).json({ error: 'Error registrando: ' + eReg.message });
    }

    res.status(200).json({ ok: true, archivo: registro });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

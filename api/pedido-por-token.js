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
    const { data: pedido, error } = await sb
      .from('pedidos')
      .select('id, cliente_id, descripcion, fase, fecha_creacion, fecha_entrega')
      .eq('archivos_token', token)
      .single();

    if (error || !pedido) return res.status(404).json({ error: 'Pedido no encontrado o token inválido' });

    // Estado bloqueante: si pedido en fase final (terminado/cobrado/recogido), no permitir subir
    // Fases: 0=nuevo, 1=atendido, 2=previas env, 3=previas ok, 4=produccion, 5=terminado, 6=cobrado, 7=recogido
    const cerrado = pedido.fase >= 5;

    // Cliente
    let cliente = null;
    if (pedido.cliente_id) {
      const { data: c } = await sb.from('clientes').select('nombre, telefono').eq('id', pedido.cliente_id).single();
      cliente = c;
    }

    // Archivos ya subidos
    const { data: archivos } = await sb
      .from('pedido_archivos')
      .select('id, nombre_original, mime_type, tamano_bytes, subido_at, storage_path')
      .eq('pedido_id', pedido.id)
      .order('subido_at', { ascending: false });

    res.status(200).json({
      pedido: {
        id: pedido.id,
        num_pedido: pedido.id, // alias para sube.html
        descripcion: pedido.descripcion,
        cerrado: cerrado,
        fecha_entrega: pedido.fecha_entrega
      },
      cliente: cliente,
      archivos: archivos || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

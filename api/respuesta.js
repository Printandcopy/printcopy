const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://ffiyprmbrznofoprvvik.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmaXlwcm1icnpub2ZvcHJ2dmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjU2OTYsImV4cCI6MjA5MDc0MTY5Nn0.DesBbR1Az0i-nokR8d7TiJS6zQu3dF-cBfVPlJpcoRg'
);

const WHATICKET_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJjcmVhdGU6bWVzc2FnZXMiLCJjcmVhdGU6Y29udGFjdHMiXSwiY29tcGFueUlkIjoiMzQxNzEyYWMtYzhhMy00NGMzLWE5ZDctZGIzZDRiNzhiYzU0IiwiaWF0IjoxNzc1MzcxNTE4fQ.-KPCiTDj46gREXYpkMeMJuQwj8msINyu0kwyyuNzIag';
const WHATSAPP_ID = '74b01007-4608-4c29-a086-190786999f56';
const TEL_PRINTCOPY = '34622305934';

function normalizarTel(tel) {
  if (!tel) return null;
  const t = tel.toString().replace(/\s/g, '').replace(/^\+/, '');
  return t.length === 9 && !t.startsWith('34') ? '34' + t : t;
}

async function enviarWA(numero, mensaje) {
  try {
    const r = await fetch('https://app.whaticket.com/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WHATICKET_TOKEN}` },
      body: JSON.stringify({ number: numero, whatsappId: WHATSAPP_ID, body: mensaje })
    });
    const d = await r.json();
    console.log('WA enviado a', numero, ':', JSON.stringify(d));
    return d;
  } catch(e) {
    console.error('Error WA a', numero, ':', e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, accion, mensaje } = req.body || {};
  if (!token || !accion) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const { data: pres, error } = await sb
      .from('presupuestos').select('*').eq('token_publico', token).single();

    if (error || !pres) return res.status(404).json({ error: 'Presupuesto no encontrado' });

    const telCliente = normalizarTel(pres.cliente_telefono);
    const nombre = (pres.cliente_nombre || '').split(' ')[0];
    const conds = {
      '50_50': '50% al encargar · 50% al recoger',
      '100_0': '100% al encargar',
      '0_100': '100% al recoger',
      'factura30': 'Factura a 30 días',
      'factura60': 'Factura a 60 días'
    };
    const condTexto = conds[pres.condicion_pago] || pres.condicion_pago || '';

    // ── ACEPTAR ──
    if (accion === 'aceptar') {
      await sb.from('presupuestos')
        .update({ estado: 'aceptado', aceptado_por_cliente: true, notificado_interno: false })
        .eq('id', pres.id);

      // 1. WA al cliente — confirmación
      if (telCliente) {
        await enviarWA(telCliente,
          `✅ ¡Perfecto ${nombre}!\n\n` +
          `Hemos recibido tu confirmación del presupuesto *${pres.numero}*.\n\n` +
          `Nos ponemos en contacto contigo en breve para coordinar los detalles.\n\n` +
          (condTexto ? `💳 Condición acordada: ${condTexto}\n\n` : '') +
          `Gracias por confiar en Print & Copy 🙌\n` +
          `923 018 034 · printcopysalamanca.es`
        );
      }

      // 2. WA a Print & Copy — aviso interno
      // Usamos el tel del cliente como número de origen para que Whaticket
      // lo enrute dentro de la conversación existente con el cliente
      await enviarWA(TEL_PRINTCOPY,
        `✅ PRESUPUESTO ACEPTADO\n\n` +
        `Cliente: ${pres.cliente_nombre}\n` +
        `Tel: ${pres.cliente_telefono || '—'}\n` +
        `Ref: ${pres.numero}\n` +
        `Total: ${parseFloat(pres.total || 0).toFixed(2)}€\n\n` +
        `Entra en el sistema para crear el pedido.`
      );

      return res.status(200).json({ success: true });
    }

    // ── CAMBIOS ──
    if (accion === 'cambios') {
      // 1. WA al cliente — acuse de recibo
      if (telCliente) {
        await enviarWA(telCliente,
          `👋 Hola ${nombre}, hemos recibido tu consulta sobre el presupuesto *${pres.numero}*.\n\n` +
          `Te respondemos hoy mismo en horario de tienda.\n\n` +
          `Print & Copy · 923 018 034`
        );
      }

      // 2. WA a Print & Copy — con el mensaje
      await enviarWA(TEL_PRINTCOPY,
        `💬 CONSULTA EN PRESUPUESTO\n\n` +
        `Cliente: ${pres.cliente_nombre}\n` +
        `Tel: ${pres.cliente_telefono || '—'}\n` +
        `Ref: ${pres.numero}\n\n` +
        `Mensaje:\n"${mensaje}"\n\n` +
        `Responde para cerrar la venta.`
      );

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Accion no reconocida' });
  } catch (e) {
    console.error('Error respuesta:', e);
    return res.status(500).json({ error: e.message });
  }
};

const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://ffiyprmbrznofoprvvik.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmaXlwcm1icnpub2ZvcHJ2dmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjU2OTYsImV4cCI6MjA5MDc0MTY5Nn0.DesBbR1Az0i-nokR8d7TiJS6zQu3dF-cBfVPlJpcoRg'
);

const WHATICKET_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJjcmVhdGU6bWVzc2FnZXMiLCJjcmVhdGU6Y29udGFjdHMiXSwiY29tcGFueUlkIjoiMzQxNzEyYWMtYzhhMy00NGMzLWE5ZDctZGIzZDRiNzhiYzU0IiwiaWF0IjoxNzc1NjQ0Mjg3fQ.gqrNl_IrV1X8pdYC_dqG4D8h4akgHFv1K9iWhzo3Wh4';
const WHATSAPP_ID = '74b01007-4608-4c29-a086-190786999f56';
const TEL_PRINTCOPY = '34622305934';

function normalizarTel(tel) {
  if (!tel) return null;
  const t = tel.toString().replace(/\s/g, '').replace(/^\+/, '');
  return t.length === 9 && !t.startsWith('34') ? '34' + t : t;
}

async function enviarWA(numero, mensaje) {
  try {
    console.log('WA SEND -> numero:', numero, 'msg:', mensaje.slice(0, 60) + '...');
    const r = await fetch('https://api.whaticket.com/api/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WHATICKET_TOKEN}` },
      body: JSON.stringify({ whatsappId: WHATSAPP_ID, messages: [{ number: numero, body: mensaje }] })
    });
    const status = r.status;
    const txt = await r.text();
    console.log('WA RESPONSE -> status:', status, 'numero:', numero, 'body:', txt.slice(0, 250));
    
    // Detectar errores
    if (status === 401 || txt.includes('Unauthorized')) {
      console.error('WA ERROR: Token caducado');
      return { error: 'token_caducado', raw: txt.slice(0, 100) };
    }
    if (txt.includes('<?xml') || txt.includes('<html')) {
      console.error('WA ERROR: Respuesta XML/HTML');
      return { error: 'respuesta_xml', raw: txt.slice(0, 100) };
    }
    
    try { return JSON.parse(txt); } catch(e) { return { raw: txt, status: status }; }
  } catch(e) {
    console.error('WA EXCEPTION:', e.message);
    return { error: e.message };
  }
}

function fmt(n) { return parseFloat(n).toFixed(2) + '€'; }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, accion, mensaje, metodo_pago, senal, url_pago } = req.body || {};
  if (!token || !accion) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const { data: pres, error } = await sb
      .from('presupuestos').select('*').eq('token_publico', token).single();
    if (error || !pres) return res.status(404).json({ error: 'No encontrado' });

    const telCliente = normalizarTel(pres.cliente_telefono);
    const nombre = (pres.cliente_nombre || '').split(' ')[0];
    // Calcular señal en servidor para garantizar valor correcto
    const senalNum = parseFloat(senal) || 0;
    const totalNum = parseFloat(pres.total) || 0;
    const condP = pres.condicion_pago || '50_50';
    const senalCalc = senalNum > 0 ? senalNum : (
      condP === '50_50' ? totalNum * 0.5 :
      condP === '100_0' ? totalNum : 0
    );
    const senalFmt = senalCalc > 0 ? fmt(senalCalc) : fmt(totalNum);
    const restoCalc = totalNum - senalCalc;

    // ── ACEPTAR ──
    if (accion === 'aceptar') {
      await sb.from('presupuestos').update({
        estado: 'aceptado',
        aceptado_por_cliente: true,
        notificado_interno: false,
        metodo_pago_senal: metodo_pago || null
      }).eq('id', pres.id);

      // Mensajes según método - Optimizados por Agente Closer
      const totalFmt = fmt(pres.total);
      const restoFmt = senalCalc > 0 && senalCalc < totalNum ? fmt(restoCalc) : null;
      
      // Mensaje Bizum fusionado con enlace
      const bizumMsg = url_pago
        ? `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `📋 Ref: *${pres.numero}* · Total: ${totalFmt}\n\n`
          + `💳 *Realiza tu pago inicial aquí:*\n`
          + `${url_pago}\n`
          + `Importe: *${senalFmt}* · Bizum o tarjeta\n\n`
          + `📌 *Siguiente paso:* en cuanto se confirme el pago te enviamos la previa digital para que la revises antes de producir.\n\n`
          + (restoFmt ? `Resto (${restoFmt}) al recoger tu pedido terminado.` : '')
        : `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `📋 Ref: *${pres.numero}* · Total: ${totalFmt}\n\n`
          + `💳 Te enviamos el enlace de pago en breve.\n`
          + `Importe: *${senalFmt}* · Bizum o tarjeta\n\n`
          + `📌 *Siguiente paso:* en cuanto se confirme el pago te enviamos la previa digital para que la revises antes de producir.`;
      
      const msgCliente = {
        bizum: bizumMsg,
        transf: `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `📋 Ref: *${pres.numero}* · Total: ${totalFmt}\n\n`
          + `🏦 *Datos para el pago inicial:*\n`
          + `Importe: *${senalFmt}*\n`
          + `IBAN: ES58 0049 5292 14 2616098558\n`
          + `Titular: Eventos Personalizados Salamanca SL\n`
          + `Concepto: *${pres.numero}*\n\n`
          + `📌 *Siguiente paso:* en cuanto recibamos el ingreso te enviamos la previa digital para que la revises antes de producir.\n\n`
          + (restoFmt ? `Resto (${restoFmt}) al recoger tu pedido terminado.` : ''),
        efectivo: `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `📋 Ref: *${pres.numero}* · Total: ${totalFmt}\n\n`
          + `🏪 *Te esperamos en tienda para el pago inicial:*\n`
          + `Importe: *${senalFmt}*\n`
          + `📍 Av. Portugal 62, Salamanca\n`
          + `🕐 L-V 10:00-14:00 y 17:00-20:00\n\n`
          + `📌 *Siguiente paso:* cuando pases por tienda y abonemos el pago inicial, te enviamos la previa digital para que la revises antes de producir.\n\n`
          + (restoFmt ? `Resto (${restoFmt}) al recoger tu pedido terminado.` : ''),
        pendiente: `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `📋 Ref: *${pres.numero}* · Total: ${totalFmt}\n\n`
          + `Pago inicial pendiente: *${senalFmt}*\n\n`
          + `Nos ponemos en contacto contigo hoy mismo para acordar el pago.`,
        al_recoger: `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `📋 Ref: *${pres.numero}* · Total: ${totalFmt}\n\n`
          + `📌 *Siguiente paso:* te enviamos la previa digital para que la revises antes de producir.\n\n`
          + `Pago completo al recoger tu pedido terminado.`,
      };

      const msgEmpresa = {
        bizum: `✅ PEDIDO CONFIRMADO — ENVIAR ENLACE DE PAGO\n\nCliente: ${pres.cliente_nombre}\nTel: ${pres.cliente_telefono || '—'}\nRef: ${pres.numero}\nTotal: ${fmt(pres.total)} · Señal: ${senalFmt}\n\nMétodo: Bizum / Tarjeta\n⚠️ Enviar enlace de pago al cliente ahora.`,
        transf: `✅ PEDIDO CONFIRMADO — ESPERAR TRANSFERENCIA\n\nCliente: ${pres.cliente_nombre}\nTel: ${pres.cliente_telefono || '—'}\nRef: ${pres.numero}\nTotal: ${fmt(pres.total)} · Señal: ${senalFmt}\n\nMétodo: Transferencia bancaria\nConcepto esperado: ${pres.numero}`,
        efectivo: `✅ PEDIDO CONFIRMADO — COBRAR EN TIENDA\n\nCliente: ${pres.cliente_nombre}\nTel: ${pres.cliente_telefono || '—'}\nRef: ${pres.numero}\nTotal: ${fmt(pres.total)} · Señal: ${senalFmt}\n\nMétodo: Efectivo en tienda`,
        pendiente: `✅ PEDIDO CONFIRMADO — ACORDAR PAGO CON CLIENTE\n\nCliente: ${pres.cliente_nombre}\nTel: ${pres.cliente_telefono || '—'}\nRef: ${pres.numero}\nTotal: ${fmt(pres.total)} · Señal: ${senalFmt}\n\nLlamar para acordar forma de pago.`,
        al_recoger: `✅ PEDIDO CONFIRMADO — PAGO AL RECOGER\n\nCliente: ${pres.cliente_nombre}\nRef: ${pres.numero} · Total: ${fmt(pres.total)}\n\nEntra a producción directamente.`,
      };

      const metodo = metodo_pago || 'pendiente';
      if (telCliente && msgCliente[metodo]) await enviarWA(telCliente, msgCliente[metodo]);
      await enviarWA(TEL_PRINTCOPY, msgEmpresa[metodo] || msgEmpresa.pendiente);

      return res.status(200).json({ success: true });
    }

    // ── CAMBIOS ──
    if (accion === 'cambios') {
      if (telCliente) {
        await enviarWA(telCliente,
          `👋 Hola ${nombre}, recibimos tu consulta sobre ${pres.numero}.\n\nTe respondemos hoy en horario de tienda.\n\nPrint & Copy · 923 018 034`
        );
      }
      await enviarWA(TEL_PRINTCOPY,
        `💬 CONSULTA — ${pres.numero}\n\nCliente: ${pres.cliente_nombre} · ${pres.cliente_telefono || '—'}\n\n"${mensaje}"`
      );
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Accion no reconocida' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};

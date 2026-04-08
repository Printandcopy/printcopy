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
      body: JSON.stringify({ number: numero, whatsappId: WHATSAPP_ID, messages: [{ body: mensaje }] })
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

  const { token, accion, mensaje, metodo_pago, senal } = req.body || {};
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

      // Mensajes según método
      const totalFmt = fmt(pres.total);
      const restoFmt = senalCalc > 0 && senalCalc < totalNum ? fmt(restoCalc) : null;
      const ahora = new Date().toLocaleString('es-ES', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const msgCliente = {
        bizum: `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `Ref: *${pres.numero}* · ${ahora}\n`
          + `Total: ${totalFmt}\n\n`
          + `💳 *Señal a pagar: ${senalFmt}*\n`
          + (restoFmt ? `Resto al recoger: ${restoFmt}\n\n` : '\n')
          + `Te enviamos ahora el enlace de pago seguro.\n`
          + `En cuanto se confirme arrancamos con tu pedido.\n\n`
          + `Print & Copy · 923 018 034`,
        transf: `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `Ref: *${pres.numero}* · ${ahora}\n`
          + `Total: ${totalFmt}\n\n`
          + `🏦 *Transferencia bancaria*\n`
          + `Importe señal: *${senalFmt}*\n`
          + `IBAN: ES58 0049 5292 14 2616098558\n`
          + `Titular: Eventos Personalizados Salamanca SL\n`
          + `Concepto: *${pres.numero}*\n\n`
          + (restoFmt ? `Resto al recoger: ${restoFmt}\n\n` : '')
          + `Avisamos en cuanto recibamos el ingreso.\n`
          + `Print & Copy · 923 018 034`,
        efectivo: `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `Ref: *${pres.numero}* · ${ahora}\n`
          + `Total: ${totalFmt}\n\n`
          + `🏪 *Pago en tienda: ${senalFmt}*\n`
          + `Efectivo, tarjeta o Bizum\n`
          + `Av. Portugal 62, Salamanca\n`
          + `L-V 9:30-14:00 y 16:30-20:00 · Sáb 10:00-14:00\n\n`
          + (restoFmt ? `Resto al recoger: ${restoFmt}\n\n` : '')
          + `Arrancamos en cuanto pases.\n`
          + `Print & Copy · 923 018 034`,
        pendiente: `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `Ref: *${pres.numero}* · ${ahora}\n`
          + `Total: ${totalFmt}\n\n`
          + `Señal pendiente: *${senalFmt}*\n\n`
          + `Nos ponemos en contacto contigo hoy mismo para acordar el pago.\n`
          + `Print & Copy · 923 018 034`,
        al_recoger: `✅ ¡Pedido confirmado, ${nombre}!\n\n`
          + `Ref: *${pres.numero}* · ${ahora}\n`
          + `Total a pagar al recoger: *${totalFmt}*\n\n`
          + `Tu pedido entra en producción ahora.\n`
          + `Print & Copy · 923 018 034`,
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

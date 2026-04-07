const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://ffiyprmbrznofoprvvik.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmaXlwcm1icnpub2ZvcHJ2dmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjU2OTYsImV4cCI6MjA5MDc0MTY5Nn0.DesBbR1Az0i-nokR8d7TiJS6zQu3dF-cBfVPlJpcoRg'
);

const WHATICKET_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJjcmVhdGU6bWVzc2FnZXMiLCJjcmVhdGU6Y29udGFjdHMiXSwiY29tcGFueUlkIjoiMzQxNzEyYWMtYzhhMy00NGMzLWE5ZDctZGIzZDRiNzhiYzU0IiwiaWF0IjoxNzc1MzcxNTE4fQ.-KPCiTDj46gREXYpkMeMJuQwj8msINyu0kwyyuNzIag';
const WHATSAPP_ID = '74b01007-4608-4c29-a086-190786999f56';
const TEL_PRINTCOPY = '34622305934';
const REDSYS_CLAVE = process.env.REDSYS_CLAVE || 'CLAVE_SHA256';

function encrypt3DES(key, data) {
  const crypto = require('crypto');
  const keyBuffer = Buffer.from(key, 'base64');
  const cipher = crypto.createCipheriv('des-ede3-cbc', keyBuffer, Buffer.alloc(8));
  cipher.setAutoPadding(false);
  const padded = data.padEnd(Math.ceil(data.length / 8) * 8, '\0');
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function verificarFirma(order, params64, firmaRecibida) {
  const crypto = require('crypto');
  const key = encrypt3DES(REDSYS_CLAVE, order);
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(params64);
  const firmaEsperada = hmac.digest('base64');
  return firmaEsperada === firmaRecibida;
}

async function enviarWA(numero, mensaje) {
  try {
    await fetch('https://app.whaticket.com/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WHATICKET_TOKEN}` },
      body: JSON.stringify({ number: numero, whatsappId: WHATSAPP_ID, body: mensaje })
    });
  } catch(e) { console.error('WA error:', e.message); }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { Ds_MerchantParameters, Ds_Signature } = req.body || {};
  if (!Ds_MerchantParameters || !Ds_Signature) return res.status(400).end();

  try {
    const params = JSON.parse(Buffer.from(Ds_MerchantParameters, 'base64').toString());
    const order = params.Ds_Order;
    const respuesta = params.Ds_Response;
    const importe = parseInt(params.Ds_Amount) / 100;

    // Verificar firma del banco
    if (!verificarFirma(order, Ds_MerchantParameters, Ds_Signature)) {
      console.error('Firma Redsys inválida');
      return res.status(400).end();
    }

    // Respuesta 0000-0099 = pago OK
    const pagoOk = parseInt(respuesta) >= 0 && parseInt(respuesta) <= 99;

    if (pagoOk) {
      // Buscar presupuesto por número de orden (PRES-XXXXXX → limpiado)
      const { data: pres } = await sb.from('presupuestos')
        .select('*').ilike('numero', '%'+order+'%').single();

      if (pres) {
        // Marcar señal cobrada
        await sb.from('presupuestos').update({
          senal_cobrada: true,
          metodo_pago_senal: 'bizum'
        }).eq('id', pres.id);

        // WA a Print & Copy
        await enviarWA(TEL_PRINTCOPY,
          `✅ PAGO RECIBIDO — REDSYS\n\nCliente: ${pres.cliente_nombre}\nRef: ${pres.numero}\nImporte: ${importe.toFixed(2)}€\n\nSeñal cobrada automáticamente. Pasar a taller.`
        );

        // WA al cliente
        if (pres.cliente_telefono) {
          const tel = pres.cliente_telefono.toString().replace(/\s/g,'').replace(/^\+/,'');
          const telNorm = tel.length === 9 && !tel.startsWith('34') ? '34'+tel : tel;
          const nombre = pres.cliente_nombre.split(' ')[0];
          const total = parseFloat(pres.total) || 0;
          const resto = total - importe;
          await enviarWA(telNorm,
            `✅ ¡Pago recibido, ${nombre}!\n\nHemos confirmado tu pago de ${importe.toFixed(2)}€ para el pedido ${pres.numero}.\n\nTu pedido ya está en producción.\n`
            + (resto > 0 ? `Resta por pagar al recoger: ${resto.toFixed(2)}€\n\n` : '\n')
            + `Te avisamos cuando esté listo.\nPrint & Copy · 923 018 034`
          );
        }
      }
    }

    return res.status(200).send('OK');
  } catch(e) {
    console.error('Error redsys-ok:', e);
    return res.status(500).end();
  }
};

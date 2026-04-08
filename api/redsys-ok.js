const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://ffiyprmbrznofoprvvik.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmaXlwcm1icnpub2ZvcHJ2dmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjU2OTYsImV4cCI6MjA5MDc0MTY5Nn0.DesBbR1Az0i-nokR8d7TiJS6zQu3dF-cBfVPlJpcoRg'
);

const REDSYS_CLAVE = process.env.REDSYS_CLAVE || 'bhPxVRrP/m9laYdEZwJu0yLbWAjb8pnC';
const WHATICKET_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJjcmVhdGU6bWVzc2FnZXMiLCJjcmVhdGU6Y29udGFjdHMiXSwiY29tcGFueUlkIjoiMzQxNzEyYWMtYzhhMy00NGMzLWE5ZDctZGIzZDRiNzhiYzU0IiwiaWF0IjoxNzc1NjQ0Mjg3fQ.gqrNl_IrV1X8pdYC_dqG4D8h4akgHFv1K9iWhzo3Wh4';
const WHATSAPP_ID = '74b01007-4608-4c29-a086-190786999f56';
const TEL_PRINTCOPY = '34622305934';

function encrypt3DES(key, data) {
  const keyBuffer = Buffer.from(key, 'base64');
  const iv = Buffer.alloc(8, 0);
  const cipher = crypto.createCipheriv('des-ede3-cbc', keyBuffer, iv);
  cipher.setAutoPadding(false);
  const dataBuffer = Buffer.from(data);
  const padLen = 8 - (dataBuffer.length % 8 === 0 ? 8 : dataBuffer.length % 8);
  const padded = Buffer.concat([dataBuffer, Buffer.alloc(padLen, 0)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function verificarFirma(order, params64, firmaRecibida) {
  const key = encrypt3DES(REDSYS_CLAVE, order);
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(params64);
  return hmac.digest('base64') === firmaRecibida;
}

async function enviarWA(numero, mensaje) {
  try {
    await fetch('https://api.whaticket.com/api/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WHATICKET_TOKEN}` },
      body: JSON.stringify({ whatsappId: WHATSAPP_ID, messages: [{ number: numero, body: mensaje }] })
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
    const respuesta = parseInt(params.Ds_Response || '9999');
    const importe = parseInt(params.Ds_Amount || '0') / 100;

    if (!verificarFirma(order, Ds_MerchantParameters, Ds_Signature)) {
      console.error('Firma invalida');
      return res.status(400).end();
    }

    const pagoOk = respuesta >= 0 && respuesta <= 99;
    console.log('Redsys notificacion - order:', order, 'respuesta:', respuesta, 'ok:', pagoOk);

    if (pagoOk) {
      // Buscar presupuesto por numero de orden
      const { data: presArr } = await sb.from('presupuestos')
        .select('*').ilike('numero', '%' + order.replace(/^0+/, '') + '%');
      const pres = presArr && presArr[0];

      if (pres) {
        await sb.from('presupuestos').update({
          senal_cobrada: true,
          metodo_pago_senal: 'bizum'
        }).eq('id', pres.id);

        const total = parseFloat(pres.total) || 0;
        const resto = total - importe;

        // WA a Print & Copy
        await enviarWA(TEL_PRINTCOPY,
          `💳 Pago recibido - Redsys\n\nCliente: ${pres.cliente_nombre}\nRef: ${pres.numero}\nImporte cobrado: ${importe.toFixed(2)}€\n\nSeñal cobrada automáticamente. Pasar a producción.`
        );

        // WA al cliente - Mensaje optimizado Agente Closer
        if (pres.cliente_telefono) {
          const tel = pres.cliente_telefono.toString().replace(/\s/g,'').replace(/^\+/,'');
          const telNorm = tel.length === 9 && !tel.startsWith('34') ? '34'+tel : tel;
          const nombre = pres.cliente_nombre.split(' ')[0];
          
          // Calcular fecha entrega
          let fechaEntregaTxt = '';
          if (pres.fecha_entrega) {
            const fe = new Date(pres.fecha_entrega);
            const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
            fechaEntregaTxt = `\n📅 Fecha estimada de entrega: *${dias[fe.getDay()]} ${fe.getDate()}/${fe.getMonth()+1}*`;
          }
          
          await enviarWA(telNorm,
            `✅ ¡Pago confirmado, ${nombre}!\n\n`
            + `Ya estamos trabajando en tu pedido *${pres.numero}*.\n\n`
            + `📌 *Siguiente paso:* te enviamos la previa digital por aquí para que la revises. No producimos nada hasta que nos des el OK.`
            + fechaEntregaTxt
            + (resto > 0.01 ? `\n\nResto (${resto.toFixed(2)}€) al recoger tu pedido terminado.` : '')
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

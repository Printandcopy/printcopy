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
    const r = await fetch('https://api.whaticket.com/api/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WHATICKET_TOKEN}` },
      body: JSON.stringify({ whatsappId: WHATSAPP_ID, messages: [{ number: numero, body: mensaje }] })
    });
    const data = await r.json();
    console.log('WA enviado a', numero, ':', data);
    return data;
  } catch(e) { 
    console.error('WA error:', e.message);
    return { error: e.message };
  }
}

// Función para crear pedido automáticamente
async function crearPedidoDesdePresupuesto(pres, senal) {
  try {
    // Obtener líneas del presupuesto
    const { data: lineas } = await sb.from('presupuesto_lineas')
      .select('*').eq('presupuesto_id', pres.id);
    
    if (!lineas || !lineas.length) {
      console.log('No hay líneas para crear pedido');
      return [];
    }

    const totalGlobal = parseFloat(pres.total) || 0;
    let maxPlazo = 3;
    lineas.forEach(l => { if (l.plazo && l.plazo > maxPlazo) maxPlazo = l.plazo; });
    
    // Calcular fecha entrega
    const fechaAuto = new Date();
    fechaAuto.setDate(fechaAuto.getDate() + maxPlazo);
    while (fechaAuto.getDay() === 0 || fechaAuto.getDay() === 6) {
      fechaAuto.setDate(fechaAuto.getDate() + 1);
    }
    const fecha = fechaAuto.toISOString().split('T')[0];
    
    // Buscar cliente
    const { data: clienteArr } = await sb.from('clientes')
      .select('id').eq('telefono', pres.cliente_telefono).limit(1);
    const clienteId = clienteArr && clienteArr[0] ? clienteArr[0].id : null;
    
    const senalTotal = senal || 0;
    const pagoEst = senalTotal >= totalGlobal ? 'pagado' : senalTotal > 0 ? 'senal' : 'pendiente';
    
    const pedidosCreados = [];
    
    for (const lin of lineas) {
      const sec = lin.seccion || 'XR';
      
      // Obtener y actualizar contador
      const { data: contData } = await sb.from('contadores')
        .select('valor').eq('seccion', sec).single();
      const nv = (contData ? contData.valor : 0) + 1;
      await sb.from('contadores').update({ valor: nv }).eq('seccion', sec);
      
      const numPed = sec + '-' + String(nv).padStart(4, '0');
      const proporcion = totalGlobal > 0 ? ((parseFloat(lin.subtotal) || 0) / totalGlobal) : 1;
      
      const ped = {
        id: numPed,
        cliente_id: clienteId,
        cliente_nombre: pres.cliente_nombre,
        cliente_tel: pres.cliente_telefono,
        cliente_email: pres.cliente_email || '',
        seccion: sec,
        operario: 'Sistema',
        fecha_creacion: new Date().toISOString(),
        fecha_entrega: fecha,
        fecha_tipo: 'aprox',
        descripcion: lin.descripcion,
        notas: 'Auto desde ' + pres.numero + ' | Bizum/Tarjeta',
        total: parseFloat(lin.subtotal) || 0,
        senal: Math.round((senalTotal * proporcion) * 100) / 100,
        pago: pagoEst,
        condiciones: pres.condicion_pago || '50_50',
        fase: 1,
        presupuesto_origen: pres.numero
      };
      
      await sb.from('pedidos').insert([ped]);
      pedidosCreados.push(numPed);
    }
    
    // Marcar presupuesto como convertido
    await sb.from('presupuestos').update({
      convertido: true,
      senal_cobrada: true
    }).eq('id', pres.id);
    
    console.log('Pedidos creados:', pedidosCreados);
    return pedidosCreados;
  } catch (e) {
    console.error('Error creando pedido:', e);
    return [];
  }
}

module.exports = async function handler(req, res) {
  console.log('=== REDSYS-OK LLAMADO ===', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Body keys:', req.body ? Object.keys(req.body) : 'sin body');
  
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

    // Buscar presupuesto por numero de orden
    const { data: presArr } = await sb.from('presupuestos')
      .select('*').ilike('numero', '%' + order.replace(/^0+/, '') + '%');
    const pres = presArr && presArr[0];

    if (pagoOk) {
      if (pres) {
        console.log('Presupuesto encontrado:', pres.numero);
        
        // Actualizar presupuesto
        await sb.from('presupuestos').update({
          senal_cobrada: true,
          metodo_pago_senal: 'bizum'
        }).eq('id', pres.id);

        const total = parseFloat(pres.total) || 0;
        const resto = total - importe;

        // CREAR PEDIDO AUTOMÁTICAMENTE
        const pedidosCreados = await crearPedidoDesdePresupuesto(pres, importe);
        console.log('Pedidos auto-creados:', pedidosCreados);

        // WA a Print & Copy
        await enviarWA(TEL_PRINTCOPY,
          `💳 Pago recibido - Redsys\n\n`
          + `Cliente: ${pres.cliente_nombre}\n`
          + `Ref: ${pres.numero}\n`
          + `Importe cobrado: ${importe.toFixed(2)}€\n\n`
          + `✅ Pedido creado automáticamente: ${pedidosCreados.join(', ') || 'error'}\n`
          + `Ya está en taller.`
        );

        // WA al cliente - Mensaje optimizado Agente Closer v2
        if (pres.cliente_telefono && pedidosCreados && pedidosCreados.length) {
          const tel = pres.cliente_telefono.toString().replace(/\s/g,'').replace(/^\+/,'');
          const telNorm = tel.length === 9 && !tel.startsWith('34') ? '34'+tel : tel;
          const nombre = pres.cliente_nombre.split(' ')[0];
          const numPedStr = pedidosCreados.join(', ');
          
          const plazoDias = pres.plazo_dias || 5;
          
          await enviarWA(telNorm,
            `✅ ¡Pago confirmado, ${nombre}!\n\n`
            + `📌 Arrancamos con tu pedido *${numPedStr}*. En cuanto tengamos la previa digital te la enviamos para que la revises.\n\n`
            + `⏱️ *Plazo de producción:* ${plazoDias} días laborables desde tu aprobación.`
            + (resto > 0.01 ? `\n\nResto (${resto.toFixed(2)}€) al recoger tu pedido terminado.` : '')
          );
        }
      } else {
        console.log('Presupuesto NO encontrado para order:', order);
      }
    } else {
      // PAGO FALLIDO - Avisar al cliente
      console.log('Pago FALLIDO - respuesta:', respuesta);
      
      if (pres && pres.cliente_telefono) {
        const tel = pres.cliente_telefono.toString().replace(/\s/g,'').replace(/^\+/,'');
        const telNorm = tel.length === 9 && !tel.startsWith('34') ? '34'+tel : tel;
        const nombre = pres.cliente_nombre.split(' ')[0];
        
        // Calcular señal
        const total = parseFloat(pres.total) || 0;
        const condicion = pres.condicion_pago || '50_50';
        let porcentaje = 50;
        if (condicion === '100_0') porcentaje = 100;
        else if (condicion === '0_100') porcentaje = 0;
        const senal = Math.round(total * porcentaje) / 100;
        
        // Generar nuevo enlace de pago
        const redsysRes = await fetch('https://printcopy.vercel.app/api/redsys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ presupuesto_id: pres.id, importe: senal })
        });
        const redsysData = await redsysRes.json();
        const nuevoEnlace = redsysData.url || '';
        
        await enviarWA(telNorm,
          `⚠️ ${nombre}, parece que el pago no se ha completado.\n\n`
          + `Puede que se haya cancelado o que falte confirmar en tu banco.\n\n`
          + (nuevoEnlace 
            ? `💳 Puedes intentarlo de nuevo aquí:\n${nuevoEnlace}\n\n`
            : `💳 Vuelve a acceder a tu presupuesto para reintentar el pago.\n\n`)
          + `Si tienes algún problema me dices por aquí 👇`
        );
        
        // Avisar también a Print & Copy
        await enviarWA(TEL_PRINTCOPY,
          `⚠️ Pago FALLIDO - Redsys\n\n`
          + `Cliente: ${pres.cliente_nombre}\n`
          + `Tel: ${pres.cliente_telefono}\n`
          + `Ref: ${pres.numero}\n`
          + `Código error: ${respuesta}\n\n`
          + `Se ha enviado WA al cliente con nuevo enlace.`
        );
      }
    }

    return res.status(200).send('OK');
  } catch(e) {
    console.error('Error redsys-ok:', e);
    return res.status(500).end();
  }
};

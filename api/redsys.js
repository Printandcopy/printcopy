// ═══════════════════════════════════════════════════════════════════════════
// REDSYS UNIFICADO — Print & Copy
// ═══════════════════════════════════════════════════════════════════════════
// 
// Esta API unifica las funciones que antes estaban en api/redsys.js y api/redsys-ok.js
// para no superar el límite de 12 funciones serverless del plan Hobby de Vercel.
// 
// RUTAS:
//  POST /api/redsys                  → genera link de pago Paygold
//  POST /api/redsys?accion=ok        → recibe notificación de Redsys (callback)
// 
// La URL configurada en el portal Getnet de Redsys debe ser:
//   https://printcopy.vercel.app/api/redsys?accion=ok
// 
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

// ─── Variables comunes ───────────────────────────────────────────────────
const REDSYS_FUC = process.env.REDSYS_FUC || '097435762';
const REDSYS_TERMINAL = process.env.REDSYS_TERMINAL || '1';
const REDSYS_CLAVE = process.env.REDSYS_CLAVE || 'bhPxVRrP/m9laYdEZwJu0yLbWAjb8pnC';
const SUPABASE_URL = 'https://ffiyprmbrznofoprvvik.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmaXlwcm1icnpub2ZvcHJ2dmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjU2OTYsImV4cCI6MjA5MDc0MTY5Nn0.DesBbR1Az0i-nokR8d7TiJS6zQu3dF-cBfVPlJpcoRg';
const WHATICKET_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJjcmVhdGU6bWVzc2FnZXMiLCJjcmVhdGU6Y29udGFjdHMiXSwiY29tcGFueUlkIjoiMzQxNzEyYWMtYzhhMy00NGMzLWE5ZDctZGIzZDRiNzhiYzU0IiwiaWF0IjoxNzc1NjQ0Mjg3fQ.gqrNl_IrV1X8pdYC_dqG4D8h4akgHFv1K9iWhzo3Wh4';
const WHATSAPP_ID = '74b01007-4608-4c29-a086-190786999f56';
const TEL_PRINTCOPY = '34622305934';

// ─── Helpers compartidos ─────────────────────────────────────────────────
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

function firmar(order, params64, clave) {
  const key = encrypt3DES(clave, order);
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(params64);
  return hmac.digest('base64');
}

function verificarFirma(order, params64, firmaRecibida) {
  const key = encrypt3DES(REDSYS_CLAVE, order);
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(params64);
  return hmac.digest('base64') === firmaRecibida;
}

function httpsPost(hostname, path, bodyStr) {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(bodyStr, 'utf8');
    const options = {
      hostname, port: 443, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length }
    };
    const req = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => { resolve(data); });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

function extraerXML(xml, campo) {
  const re = new RegExp('<' + campo + '>([^<]*)<\\/' + campo + '>', 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
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

// ═══════════════════════════════════════════════════════════════════════════
// RUTA 1: GENERAR LINK DE PAGO PAYGOLD (POST /api/redsys)
// ═══════════════════════════════════════════════════════════════════════════
async function generarLinkPago(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = req.body || {};
  const importe = body.importe;
  const numero_pedido = body.numero_pedido;
  const concepto = body.concepto;

  if (!importe || !numero_pedido) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  // Añadir sufijo timestamp para evitar SIS0051 (orden repetida)
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  const orderBase = numero_pedido.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  const order = (orderBase + ts).padStart(4, '0').slice(-12);
  const importeCentimos = Math.round(parseFloat(importe) * 100).toString();

  const params = {
    DS_MERCHANT_AMOUNT: importeCentimos,
    DS_MERCHANT_ORDER: order,
    DS_MERCHANT_MERCHANTCODE: REDSYS_FUC,
    DS_MERCHANT_CURRENCY: '978',
    DS_MERCHANT_TRANSACTIONTYPE: 'F',
    DS_MERCHANT_TERMINAL: REDSYS_TERMINAL,
    DS_MERCHANT_MERCHANTURL: 'https://printcopy.vercel.app/api/redsys?accion=ok',
    DS_MERCHANT_URLOK: 'https://printcopy.vercel.app/pago-ok.html',
    DS_MERCHANT_URLKO: 'https://printcopy.vercel.app/pago-ko.html',
    DS_MERCHANT_PRODUCTDESCRIPTION: (concepto || 'Pedido Print & Copy').slice(0, 125),
  };

  const params64 = Buffer.from(JSON.stringify(params)).toString('base64');
  const firma = firmar(order, params64, REDSYS_CLAVE);

  const postBody = JSON.stringify({
    DS_SIGNATUREVERSION: 'HMAC_SHA256_V1',
    DS_MERCHANTPARAMETERS: params64,
    DS_SIGNATURE: firma,
  });

  try {
    console.log('Redsys request - order:', order, 'importe:', importeCentimos);
    const rawResponse = await httpsPost('sis.redsys.es', '/sis/rest/trataPeticionREST', postBody);
    console.log('Redsys raw response (primeros 800):', rawResponse.slice(0, 800));

    let urlPago = null;
    let errorId = null;

    if (rawResponse.trim().startsWith('{')) {
      const data = JSON.parse(rawResponse);
      console.log('Redsys JSON keys:', Object.keys(data));
      if (data.DS_ERROR_ID) errorId = data.DS_ERROR_ID;
      if (data.Ds_MerchantParameters || data.DS_MERCHANTPARAMETERS) {
        const params64 = data.Ds_MerchantParameters || data.DS_MERCHANTPARAMETERS;
        const rp = JSON.parse(Buffer.from(params64, 'base64').toString());
        console.log('Redsys decoded params:', JSON.stringify(rp));
        urlPago = rp.Ds_UrlPago2Fases || rp.DS_URLPAGO2FASES || rp.Ds_Url_Pago_2Fases || rp.DS_URL_PAGO_2FASES || rp.Ds_UrlPago || rp.DS_URLPAGO;
      }
    } else if (rawResponse.includes('<?xml') || rawResponse.includes('<RETORNOXML>') || rawResponse.includes('<CODIGO>')) {
      console.log('Redsys respondio XML');
      const codigo = extraerXML(rawResponse, 'CODIGO');
      urlPago = extraerXML(rawResponse, 'Ds_UrlPago2Fases') || extraerXML(rawResponse, 'DS_URLPAGO2FASES') || extraerXML(rawResponse, 'Ds_Url_Pago_2Fases');
      errorId = codigo && codigo !== '0' ? codigo : null;
      console.log('Redsys XML - codigo:', codigo, 'urlPago:', urlPago);
    }

    console.log('Redsys FINAL - urlPago:', urlPago, 'errorId:', errorId);

    if (errorId) {
      return res.status(400).json({ error: 'Error Redsys: ' + errorId });
    }

    return res.status(200).json({ success: true, url_pago: urlPago || null, order });

  } catch(e) {
    console.error('Error Redsys:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RUTA 2: RECIBIR NOTIFICACIÓN DE PAGO (POST /api/redsys?accion=ok)
// ═══════════════════════════════════════════════════════════════════════════

async function crearPedidoDesdePresupuesto(sb, pres, senal) {
  try {
    const { data: lineas } = await sb.from('presupuesto_lineas').select('*').eq('presupuesto_id', pres.id);
    if (!lineas || !lineas.length) {
      console.log('No hay líneas para crear pedido');
      return [];
    }
    const totalGlobal = parseFloat(pres.total) || 0;
    let maxPlazo = 3;
    lineas.forEach(l => { if (l.plazo && l.plazo > maxPlazo) maxPlazo = l.plazo; });
    const fechaAuto = new Date();
    fechaAuto.setDate(fechaAuto.getDate() + maxPlazo);
    while (fechaAuto.getDay() === 0 || fechaAuto.getDay() === 6) {
      fechaAuto.setDate(fechaAuto.getDate() + 1);
    }
    const fecha = fechaAuto.toISOString().split('T')[0];
    const { data: clienteArr } = await sb.from('clientes').select('id').eq('telefono', pres.cliente_telefono).limit(1);
    const clienteId = clienteArr && clienteArr[0] ? clienteArr[0].id : null;
    const senalTotal = senal || 0;
    const pagoEst = senalTotal >= totalGlobal ? 'pagado' : senalTotal > 0 ? 'senal' : 'pendiente';
    const pedidosCreados = [];
    for (const lin of lineas) {
      const sec = lin.seccion || 'XR';
      const { data: contData } = await sb.from('contadores').select('valor').eq('seccion', sec).single();
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
        operario: null,
        fecha_creacion: new Date().toISOString(),
        fecha_entrega: fecha,
        fecha_tipo: 'aprox',
        descripcion: lin.descripcion,
        notas: 'Pago online (Bizum/Tarjeta) desde ' + pres.numero,
        total: parseFloat(lin.subtotal) || 0,
        senal: Math.round((senalTotal * proporcion) * 100) / 100,
        pago: pagoEst,
        condiciones: pres.condicion_pago || '50_50',
        fase: 0,
        presupuesto_origen: pres.numero
      };
      await sb.from('pedidos').insert([ped]);
      pedidosCreados.push(numPed);
    }
    await sb.from('presupuestos').update({ convertido: true, senal_cobrada: true }).eq('id', pres.id);
    console.log('Pedidos creados:', pedidosCreados);
    return pedidosCreados;
  } catch (e) {
    console.error('Error creando pedido:', e);
    return [];
  }
}

async function recibirNotificacionPago(req, res) {
  console.log('=== REDSYS-OK LLAMADO ===', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Body keys:', req.body ? Object.keys(req.body) : 'sin body');

  if (req.method !== 'POST') return res.status(405).end();

  const { Ds_MerchantParameters, Ds_Signature } = req.body || {};
  if (!Ds_MerchantParameters || !Ds_Signature) return res.status(400).end();

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

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

    // Extraer el número de presupuesto del order de Redsys
    // El order tiene formato: prefijo + numero + timestamp(4 chars)
    // Ej: ES000110BTXE → presupuesto 000110 (PRES-000110)
    // Ej: 000056ABCD → presupuesto 000056 (PRES-000056)
    // Estrategia: quitar los últimos 4 chars (timestamp) y luego extraer dígitos
    let numLimpio = order;
    if (order.length > 4) {
      const sinTimestamp = order.slice(0, -4); // quita timestamp
      const soloDigitos = sinTimestamp.replace(/[^0-9]/g, ''); // solo números
      if (soloDigitos.length > 0) {
        numLimpio = soloDigitos.replace(/^0+/, '') || soloDigitos; // quita ceros izq
      }
    }
    console.log('Buscando presupuesto - order:', order, 'numLimpio:', numLimpio);
    
    // Intentar 3 búsquedas en orden de probabilidad
    let presArr = null;
    
    // 1. Buscar por número exacto (PRES-000110, PRES-110, etc)
    let res1 = await sb.from('presupuestos').select('*').ilike('numero', '%' + numLimpio + '%');
    if (res1.data && res1.data.length) {
      // Filtrar por coincidencia exacta del número (evitar PRES-110 vs PRES-1100)
      presArr = res1.data.filter(p => {
        const numP = (p.numero || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
        return numP === numLimpio;
      });
      if (!presArr.length) presArr = res1.data; // si no hay match exacto, usar el primero
    }
    
    // 2. Si no se encontró, buscar por order original
    if (!presArr || !presArr.length) {
      let res2 = await sb.from('presupuestos').select('*').ilike('numero', '%' + order.replace(/^0+/, '') + '%');
      presArr = res2.data || [];
    }
    
    const pres = presArr && presArr[0];

    if (pagoOk) {
      if (pres) {
        console.log('Presupuesto encontrado:', pres.numero);
        await sb.from('presupuestos').update({ senal_cobrada: true, metodo_pago_senal: 'bizum' }).eq('id', pres.id);
        const total = parseFloat(pres.total) || 0;
        const resto = total - importe;
        const pedidosCreados = await crearPedidoDesdePresupuesto(sb, pres, importe);
        console.log('Pedidos auto-creados:', pedidosCreados);
        await enviarWA(TEL_PRINTCOPY,
          `💳 Pago recibido - Redsys\n\n`
          + `Cliente: ${pres.cliente_nombre}\n`
          + `Ref: ${pres.numero}\n`
          + `Importe cobrado: ${importe.toFixed(2)}€\n\n`
          + `✅ Pedido creado automáticamente: ${pedidosCreados.join(', ') || 'error'}\n`
          + `Ya está en taller.`
        );
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
      console.log('Pago FALLIDO - respuesta:', respuesta);
      if (pres && pres.cliente_telefono) {
        const tel = pres.cliente_telefono.toString().replace(/\s/g,'').replace(/^\+/,'');
        const telNorm = tel.length === 9 && !tel.startsWith('34') ? '34'+tel : tel;
        const nombre = pres.cliente_nombre.split(' ')[0];
        const total = parseFloat(pres.total) || 0;
        const condicion = pres.condicion_pago || '50_50';
        let porcentaje = 50;
        if (condicion === '100_0') porcentaje = 100;
        else if (condicion === '0_100') porcentaje = 0;
        const senal = Math.round(total * porcentaje) / 100;
        // Generar nuevo enlace llamando a la propia función
        let nuevoEnlace = '';
        try {
          const fakeReq = { method: 'POST', body: { importe: senal, numero_pedido: pres.numero, concepto: 'Reintento ' + pres.numero } };
          const fakeRes = {
            statusCode: 200, _data: null,
            setHeader() {}, status(c) { this.statusCode = c; return this; },
            json(d) { this._data = d; return this; },
            end() { return this; }
          };
          await generarLinkPago(fakeReq, fakeRes);
          nuevoEnlace = (fakeRes._data && fakeRes._data.url_pago) || '';
        } catch(e) { console.error('Error generando reintento:', e.message); }
        await enviarWA(telNorm,
          `⚠️ ${nombre}, parece que el pago no se ha completado.\n\n`
          + `Puede que se haya cancelado o que falte confirmar en tu banco.\n\n`
          + (nuevoEnlace 
            ? `💳 Puedes intentarlo de nuevo aquí:\n${nuevoEnlace}\n\n`
            : `💳 Vuelve a acceder a tu presupuesto para reintentar el pago.\n\n`)
          + `Si tienes algún problema me dices por aquí 👇`
        );
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
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER PRINCIPAL: decide entre generar link o recibir notificación
// ═══════════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  const accion = (req.query && req.query.accion) || '';
  if (accion === 'ok') {
    return await recibirNotificacionPago(req, res);
  }
  return await generarLinkPago(req, res);
};

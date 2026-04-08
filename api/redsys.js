const crypto = require('crypto');
const https = require('https');

const REDSYS_FUC = process.env.REDSYS_FUC || '097435762';
const REDSYS_TERMINAL = process.env.REDSYS_TERMINAL || '1';
const REDSYS_CLAVE = process.env.REDSYS_CLAVE || 'bhPxVRrP/m9laYdEZwJu0yLbWAjb8pnC';

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

function httpsPost(hostname, path, bodyStr) {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(bodyStr, 'utf8');
    const options = {
      hostname,
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyBuf.length
      }
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

// Extraer valor de campo XML
function extraerXML(xml, campo) {
  const re = new RegExp('<' + campo + '>([^<]*)<\\/' + campo + '>', 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

module.exports = async function handler(req, res) {
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
    DS_MERCHANT_MERCHANTURL: 'https://printcopy.vercel.app/api/redsys-ok',
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

    // Redsys puede responder JSON o XML
    if (rawResponse.trim().startsWith('{')) {
      // JSON
      const data = JSON.parse(rawResponse);
      console.log('Redsys JSON keys:', Object.keys(data));
      if (data.DS_ERROR_ID) errorId = data.DS_ERROR_ID;
      if (data.Ds_MerchantParameters || data.DS_MERCHANTPARAMETERS) {
        const params64 = data.Ds_MerchantParameters || data.DS_MERCHANTPARAMETERS;
        const rp = JSON.parse(Buffer.from(params64, 'base64').toString());
        console.log('Redsys decoded params:', JSON.stringify(rp));
        // Buscar URL en todas las variantes posibles
        urlPago = rp.Ds_UrlPago2Fases || rp.DS_URLPAGO2FASES || rp.Ds_Url_Pago_2Fases || rp.DS_URL_PAGO_2FASES || rp.Ds_UrlPago || rp.DS_URLPAGO;
      }
    } else if (rawResponse.includes('<?xml') || rawResponse.includes('<RETORNOXML>') || rawResponse.includes('<CODIGO>')) {
      // XML
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

    return res.status(200).json({
      success: true,
      url_pago: urlPago || null,
      order
    });

  } catch(e) {
    console.error('Error Redsys:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

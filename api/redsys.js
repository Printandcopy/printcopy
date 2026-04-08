const crypto = require('crypto');
const https = require('https');

const REDSYS_FUC = process.env.REDSYS_FUC || '097435762';
const REDSYS_TERMINAL = process.env.REDSYS_TERMINAL || '1';
const REDSYS_CLAVE = process.env.REDSYS_CLAVE || 'bhPxVRrP/m9laYdEZwJu0yLbWAjb8pnC';
// Endpoint correcto para Paygold REST en produccion
const REDSYS_ENDPOINT = 'https://sis.redsys.es/sis/rest/trataPeticionREST';

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { importe, numero_pedido, concepto } = req.body || {};
  if (!importe || !numero_pedido) return res.status(400).json({ error: 'Faltan datos' });

  // Numero pedido: max 12 chars alfanumerico, empieza por letra o numero, min 4
  const order = numero_pedido.replace(/[^a-zA-Z0-9]/g, '').slice(-12).padStart(4, '0');
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

  try {
    // Llamada HTTPS nativa (compatible con todas las versiones de Node)
    const postData = JSON.stringify({
      DS_SIGNATUREVERSION: 'HMAC_SHA256_V1',
      DS_MERCHANTPARAMETERS: params64,
      DS_SIGNATURE: firma,
    });

    const data = await new Promise((resolve, reject) => {
      const url = new URL(REDSYS_ENDPOINT);
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch(e) { reject(new Error('Respuesta no JSON: ' + body.slice(0,200))); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
    console.log('Redsys respuesta raw:', JSON.stringify(data));

    if (data.DS_ERROR_ID) {
      console.error('Error Redsys:', data.DS_ERROR_ID);
      return res.status(400).json({ error: 'Error Redsys ' + data.DS_ERROR_ID });
    }

    // Decodificar respuesta
    const respParams = JSON.parse(Buffer.from(data.DS_MERCHANTPARAMETERS, 'base64').toString());
    console.log('Redsys params decodificados:', JSON.stringify(respParams));

    // La URL puede venir como Ds_UrlPago2Fases o DS_URLPAGO2FASES
    const urlPago = respParams.Ds_UrlPago2Fases || respParams.DS_URLPAGO2FASES || respParams.Ds_Url_Pago2Fases;

    return res.status(200).json({
      success: true,
      url_pago: urlPago || null,
      order: order,
      respuesta: respParams.Ds_Response
    });

  } catch(e) {
    console.error('Error llamada Redsys:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

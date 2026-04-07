const crypto = require('crypto');

// ── CONFIGURACIÓN REDSYS (rellenar con datos del banco) ──
const REDSYS_FUC = process.env.REDSYS_FUC || 'XXXXXXXXX';        // Número de comercio
const REDSYS_TERMINAL = process.env.REDSYS_TERMINAL || '001';
const REDSYS_CLAVE = process.env.REDSYS_CLAVE || 'CLAVE_SHA256';  // Clave secreta
const REDSYS_URL = process.env.REDSYS_ENTORNO === 'produccion'
  ? 'https://sis.redsys.es/sis/realizarPago'
  : 'https://sis-t.redsys.es:25443/sis/realizarPago'; // sandbox por defecto

function base64url(str) {
  return Buffer.from(str).toString('base64');
}

function encrypt3DES(key, data) {
  const keyBuffer = Buffer.from(key, 'base64');
  const cipher = crypto.createCipheriv('des-ede3-cbc', keyBuffer, Buffer.alloc(8));
  cipher.setAutoPadding(false);
  const padded = data.padEnd(Math.ceil(data.length / 8) * 8, '\0');
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function firmarPeticion(order, params64) {
  const key = encrypt3DES(REDSYS_CLAVE, order);
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(params64);
  return hmac.digest('base64');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { importe, numero_pedido, concepto, url_ok, url_ko } = req.body || {};
  if (!importe || !numero_pedido) return res.status(400).json({ error: 'Faltan datos' });

  // Importe en céntimos sin decimales
  const importeCentimos = Math.round(parseFloat(importe) * 100).toString().padStart(12, '0');

  const params = {
    DS_MERCHANT_AMOUNT: importeCentimos,
    DS_MERCHANT_ORDER: numero_pedido.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).padStart(4, '0'),
    DS_MERCHANT_MERCHANTCODE: REDSYS_FUC,
    DS_MERCHANT_CURRENCY: '978', // EUR
    DS_MERCHANT_TRANSACTIONTYPE: '0', // Autorización
    DS_MERCHANT_TERMINAL: REDSYS_TERMINAL,
    DS_MERCHANT_MERCHANTURL: 'https://printcopy.vercel.app/api/redsys-ok',
    DS_MERCHANT_URLOK: url_ok || 'https://printcopy.vercel.app/pago-ok.html',
    DS_MERCHANT_URLKO: url_ko || 'https://printcopy.vercel.app/pago-ko.html',
    DS_MERCHANT_PRODUCTDESCRIPTION: (concepto || 'Pedido Print & Copy').slice(0, 125),
    DS_MERCHANT_PAYMETHODS: 'z', // Bizum + Tarjeta
  };

  const params64 = base64url(JSON.stringify(params));
  const firma = firmarPeticion(params.DS_MERCHANT_ORDER, params64);

  return res.status(200).json({
    url: REDSYS_URL,
    Ds_SignatureVersion: 'HMAC_SHA256_V1',
    Ds_MerchantParameters: params64,
    Ds_Signature: firma,
  });
};

const nodemailer = require('nodemailer');

const WHATICKET_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJjcmVhdGU6bWVzc2FnZXMiLCJjcmVhdGU6Y29udGFjdHMiXSwiY29tcGFueUlkIjoiMzQxNzEyYWMtYzhhMy00NGMzLWE5ZDctZGIzZDRiNzhiYzU0IiwiaWF0IjoxNzc2MDIyNzM1fQ.SEHrP8WZVdnBBEvyrHadkDcEP00MtFZmbfZ1y3LuZXo';
const WHATSAPP_ID = '74b01007-4608-4c29-a086-190786999f56';
const GMAIL_USER = 'printcopyonline@gmail.com';
const GMAIL_APP_PASSWORD = 'gpxgxfreydphkfcm';
const ALERTA_EMAIL = 'printcopyonline@gmail.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const ahora = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
  const resultado = { check: 'WhatsApp Health', fecha: ahora, estado: null, detalle: null, emailEnviado: false };

  try {
    // Intentar enviar un mensaje vacío para comprobar conexión
    // Usamos un número inexistente para no molestar a nadie
    const response = await fetch('https://api.whaticket.com/api/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + WHATICKET_TOKEN
      },
      body: JSON.stringify({
        whatsappId: WHATSAPP_ID,
        messages: [{ number: '34000000000', body: 'health-check' }]
      })
    });

    const status = response.status;
    const txt = await response.text();

    // Analizar respuesta
    if (status === 401) {
      resultado.estado = 'ERROR';
      resultado.detalle = 'Token caducado (401)';
    } else if (txt.includes('ERR_CONNECTION_OFFLINE')) {
      resultado.estado = 'ERROR';
      resultado.detalle = 'WhatsApp desconectado en Whaticket (ERR_CONNECTION_OFFLINE)';
    } else if (txt.includes('ERR_') || status >= 500) {
      resultado.estado = 'ERROR';
      resultado.detalle = 'Error Whaticket: ' + txt.slice(0, 100);
    } else {
      // 200/201 o incluso 400 sin ERR_CONNECTION = la conexión WA está activa
      resultado.estado = 'OK';
      resultado.detalle = 'WhatsApp conectado y operativo';
      return res.status(200).json(resultado);
    }

    // Si hay error, enviar email de alerta
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: '"Print & Copy Sistema" <' + GMAIL_USER + '>',
      to: ALERTA_EMAIL,
      subject: '⚠️ ALERTA: WhatsApp caído — ' + resultado.detalle,
      html: '<div style="font-family:sans-serif;max-width:500px;margin:0 auto">'
        + '<div style="background:#A32D2D;color:#fff;padding:16px;border-radius:8px 8px 0 0;font-size:18px;font-weight:700">⚠️ WhatsApp NO funciona</div>'
        + '<div style="background:#fff;border:1px solid #e5e7eb;padding:20px;border-radius:0 0 8px 8px">'
        + '<p style="font-size:14px;color:#333;margin:0 0 12px"><strong>Error:</strong> ' + resultado.detalle + '</p>'
        + '<p style="font-size:14px;color:#333;margin:0 0 12px"><strong>Fecha:</strong> ' + ahora + '</p>'
        + '<p style="font-size:14px;color:#333;margin:0 0 16px">Todos los envíos automáticos de WhatsApp están parados: fases de pedido, recordatorios, tallas, previas.</p>'
        + '<div style="background:#FFF8E6;border:1px solid #FAC775;border-radius:6px;padding:12px;margin-bottom:16px">'
        + '<p style="font-size:13px;color:#854F0B;margin:0"><strong>Solución:</strong></p>'
        + '<ol style="font-size:13px;color:#854F0B;margin:8px 0 0;padding-left:20px">'
        + '<li>Entra en Whaticket</li>'
        + '<li>Ve a Conexiones</li>'
        + '<li>Reconecta el WhatsApp (escanea QR)</li>'
        + '<li>Verifica que el ID es correcto y que el dispositivo está vinculado</li>'
        + '</ol></div>'
        + '<p style="font-size:11px;color:#aaa;margin:0">Print & Copy · Sistema de gestión · Health check automático</p>'
        + '</div></div>'
    });

    resultado.emailEnviado = true;
    console.log('HEALTH-CHECK: WA caído, email de alerta enviado');
    return res.status(200).json(resultado);

  } catch (error) {
    resultado.estado = 'ERROR';
    resultado.detalle = 'Excepción: ' + error.message;
    console.error('HEALTH-CHECK ERROR:', error.message);
    return res.status(500).json(resultado);
  }
};

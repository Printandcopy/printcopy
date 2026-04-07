const nodemailer = require('nodemailer');

const GMAIL_USER = 'printcopyonline@gmail.com';
const GMAIL_APP_PASSWORD = 'gpxgxfreydphkfcm';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { destinatario, asunto, mensaje, html } = req.body;

    if (!destinatario || !asunto) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });

    const mailOptions = {
      from: '"Print & Copy" <' + GMAIL_USER + '>',
      to: destinatario,
      subject: asunto,
      text: mensaje || asunto,
      html: html || (mensaje ? mensaje.replace(/\n/g, '<br>') : asunto)
    };

    const info = await transporter.sendMail(mailOptions);
    return res.status(200).json({ success: true, messageId: info.messageId });

  } catch (error) {
    return res.status(500).json({ error: 'Error al enviar email', details: error.message });
  }
};

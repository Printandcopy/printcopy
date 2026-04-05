// API Route: /api/email
// Envía emails a través de Gmail SMTP

import nodemailer from 'nodemailer';

const GMAIL_USER = 'printcopyonline@gmail.com';
const GMAIL_APP_PASSWORD = 'gpxgxfreydphkfcm';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { destinatario, asunto, mensaje } = req.body;

    if (!destinatario || !asunto || !mensaje) {
      return res.status(400).json({ error: 'Faltan campos: destinatario, asunto y mensaje son requeridos' });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD
      }
    });

    const mailOptions = {
      from: `"Print & Copy" <${GMAIL_USER}>`,
      to: destinatario,
      subject: asunto,
      text: mensaje,
      html: mensaje.replace(/\n/g, '<br>')
    };

    const info = await transporter.sendMail(mailOptions);

    return res.status(200).json({ success: true, message: 'Email enviado correctamente', messageId: info.messageId });

  } catch (error) {
    return res.status(500).json({ error: 'Error al enviar email', details: error.message });
  }
}

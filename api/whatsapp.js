// API Route: /api/whatsapp
// Envía mensajes de WhatsApp a través de Whaticket

const WHATICKET_URL = 'https://app.whaticket.com';
const WHATICKET_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJjcmVhdGU6bWVzc2FnZXMiLCJjcmVhdGU6Y29udGFjdHMiXSwiY29tcGFueUlkIjoiMzQxNzEyYWMtYzhhMy00NGMzLWE5ZDctZGIzZDRiNzhiYzU0IiwiaWF0IjoxNzc1MzcxNTE4fQ.-KPCiTDj46gREXYpkMeMJuQwj8msINyu0kwyyuNzIag';

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
    const { telefono, mensaje } = req.body;

    if (!telefono || !mensaje) {
      return res.status(400).json({ error: 'Faltan campos: telefono y mensaje son requeridos' });
    }

    let tel = telefono.replace(/\s/g, '').replace(/^\+/, '');
    if (tel.length === 9 && !tel.startsWith('34')) {
      tel = '34' + tel;
    }

    const response = await fetch(`${WHATICKET_URL}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WHATICKET_TOKEN}`
      },
      body: JSON.stringify({
        number: tel,
        body: mensaje
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Error al enviar WhatsApp', details: data });
    }

    return res.status(200).json({ success: true, message: 'WhatsApp enviado correctamente', data });

  } catch (error) {
    return res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
}

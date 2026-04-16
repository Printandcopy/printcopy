const WHATICKET_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJjcmVhdGU6bWVzc2FnZXMiLCJjcmVhdGU6Y29udGFjdHMiXSwiY29tcGFueUlkIjoiMzQxNzEyYWMtYzhhMy00NGMzLWE5ZDctZGIzZDRiNzhiYzU0IiwiaWF0IjoxNzc2MDIyNzM1fQ.SEHrP8WZVdnBBEvyrHadkDcEP00MtFZmbfZ1y3LuZXo';
const WHATSAPP_ID = '74b01007-4608-4c29-a086-190786999f56';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // KILL SWITCH EMERGENCIA — bloquea TODO hasta que se desactive
  const EMERGENCY_STOP = true;
  if (EMERGENCY_STOP) {
    return res.status(200).json({ success: false, blocked: true, reason: 'Emergency stop activo' });
  }

  // BLOQUEO HORARIO SERVER-SIDE: solo enviar entre 9:00 y 21:00 hora Madrid
  const madridHour = parseInt(new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
  const isManual = req.body && req.body.manual === true;
  if (!isManual && (madridHour < 9 || madridHour >= 21)) {
    console.log('WA BLOCKED -> Fuera de horario Madrid:', madridHour + 'h. Mensaje no enviado.');
    return res.status(200).json({ success: false, blocked: true, reason: 'Fuera de horario (9-21h Madrid)', hora: madridHour });
  }

  try {
    const { telefono, mensaje, nombre } = req.body;
    if (!telefono || !mensaje) return res.status(400).json({ error: 'Faltan campos' });

    let tel = telefono.replace(/\s/g, '').replace(/^\+/, '');
    if (tel.length === 9 && !tel.startsWith('34')) tel = '34' + tel;

    console.log('WA REQUEST -> tel:', tel, 'msg:', mensaje.slice(0, 50) + '...');

    const response = await fetch('https://api.whaticket.com/api/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + WHATICKET_TOKEN
      },
      body: JSON.stringify({
        whatsappId: WHATSAPP_ID,
        messages: [
          { number: tel, body: mensaje }
        ]
      })
    });

    const txt = await response.text();
    const status = response.status;
    console.log('WA RESPONSE -> status:', status, 'body:', txt.slice(0, 300));

    // Detectar errores comunes
    if (status === 401 || txt.includes('Unauthorized') || txt.includes('token')) {
      console.error('WA ERROR: Token caducado o invalido');
      return res.status(401).json({ success: false, error: 'Token Whaticket caducado', raw: txt.slice(0, 200) });
    }
    if (status === 404 || txt.includes('not found')) {
      console.error('WA ERROR: Endpoint no encontrado');
      return res.status(404).json({ success: false, error: 'Endpoint Whaticket no encontrado', raw: txt.slice(0, 200) });
    }
    if (txt.includes('<?xml') || txt.includes('<html')) {
      console.error('WA ERROR: Respuesta XML/HTML inesperada');
      return res.status(502).json({ success: false, error: 'Whaticket devolvio HTML/XML', raw: txt.slice(0, 200) });
    }

    let data;
    try { data = JSON.parse(txt); } catch(e) { data = { raw: txt }; }

    // Verificar si Whaticket confirmo el envio
    const enviado = status === 200 || status === 201 || (data && (data.id || data.messageId || data.success));
    
    return res.status(200).json({ 
      success: enviado, 
      status: status,
      data: data 
    });

  } catch (error) {
    console.error('WA EXCEPTION:', error.message);
    return res.status(500).json({ error: 'Error interno', details: error.message });
  }
};

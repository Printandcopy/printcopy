// Endpoint de diagnóstico para probar WhatsApp
// USO: https://printcopy.vercel.app/api/test-wa?tel=622305934

const WHATICKET_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJjcmVhdGU6bWVzc2FnZXMiLCJjcmVhdGU6Y29udGFjdHMiXSwiY29tcGFueUlkIjoiMzQxNzEyYWMtYzhhMy00NGMzLWE5ZDctZGIzZDRiNzhiYzU0IiwiaWF0IjoxNzc1MzcxNTE4fQ.-KPCiTDj46gREXYpkMeMJuQwj8msINyu0kwyyuNzIag';
const WHATSAPP_ID = '74b01007-4608-4c29-a086-190786999f56';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Obtener teléfono de query o usar el de Print & Copy
  let tel = req.query.tel || '622305934';
  tel = tel.replace(/\s/g, '').replace(/^\+/, '');
  if (tel.length === 9 && !tel.startsWith('34')) tel = '34' + tel;

  const ahora = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
  const mensaje = `🔧 Test diagnóstico WA\n\nFecha: ${ahora}\nEndpoint: api/test-wa\n\nSi recibes esto, WhatsApp funciona correctamente.\n\nPrint & Copy`;

  const resultado = {
    test: 'WhatsApp Whaticket',
    fecha: ahora,
    telefono_destino: tel,
    whaticket_endpoint: 'https://app.whaticket.com/api/messages/send',
    whatsapp_id: WHATSAPP_ID,
    token_preview: WHATICKET_TOKEN.slice(0, 20) + '...',
    request: null,
    response: null,
    diagnostico: null
  };

  try {
    const bodyEnvio = {
      number: tel,
      whatsappId: WHATSAPP_ID,
      body: mensaje
    };
    resultado.request = bodyEnvio;

    const response = await fetch('https://app.whaticket.com/api/messages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + WHATICKET_TOKEN
      },
      body: JSON.stringify(bodyEnvio)
    });

    const status = response.status;
    const headers = Object.fromEntries(response.headers.entries());
    const txt = await response.text();

    resultado.response = {
      status: status,
      status_text: response.statusText,
      headers: headers,
      body_raw: txt.slice(0, 500),
      body_length: txt.length
    };

    // Diagnóstico automático
    if (status === 200 || status === 201) {
      try {
        const json = JSON.parse(txt);
        if (json.id || json.messageId || json.success) {
          resultado.diagnostico = '✅ OK - Mensaje enviado correctamente. Revisa el WhatsApp de ' + tel;
        } else {
          resultado.diagnostico = '⚠️ Status 200 pero respuesta sin ID de mensaje. Revisar body.';
        }
        resultado.response.body_parsed = json;
      } catch(e) {
        resultado.diagnostico = '⚠️ Status 200 pero respuesta no es JSON válido';
      }
    } else if (status === 401) {
      resultado.diagnostico = '❌ ERROR 401 - Token caducado o inválido. Renovar en whaticket.com';
    } else if (status === 403) {
      resultado.diagnostico = '❌ ERROR 403 - Sin permisos. Verificar scopes del token en Whaticket';
    } else if (status === 404) {
      resultado.diagnostico = '❌ ERROR 404 - Endpoint no encontrado. Verificar URL de Whaticket';
    } else if (status === 500) {
      resultado.diagnostico = '❌ ERROR 500 - Error interno de Whaticket. Contactar soporte';
    } else if (txt.includes('<?xml') || txt.includes('<html') || txt.includes('<!DOCTYPE')) {
      resultado.diagnostico = '❌ ERROR - Whaticket devolvió HTML/XML en lugar de JSON. Posible página de error o mantenimiento';
    } else {
      resultado.diagnostico = '⚠️ Status ' + status + ' - Revisar respuesta para más detalles';
    }

    // Log en Vercel
    console.log('TEST-WA RESULTADO:', JSON.stringify(resultado, null, 2));

    return res.status(200).json(resultado);

  } catch (error) {
    resultado.diagnostico = '❌ EXCEPCIÓN - ' + error.message;
    resultado.error = error.message;
    console.error('TEST-WA ERROR:', error);
    return res.status(500).json(resultado);
  }
};

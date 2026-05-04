// ═══════════════════════════════════════════════════════════════════════════
// BACKUP AUTOMÁTICO — Print & Copy
// ═══════════════════════════════════════════════════════════════════════════
// 
// QUÉ HACE:
// 1. Exporta TODAS las tablas del sistema a un único JSON
// 2. Lo envía por email a printcopyonline@gmail.com con el adjunto
// 3. Se ejecuta automáticamente cada domingo a las 23:00 vía cron de Vercel
// 4. También se puede llamar manualmente con la URL:
//    https://printcopy.vercel.app/api/backup?token=BACKUP_SECRET_TOKEN
// 
// PROTECCIÓN:
// - Requiere token en query (?token=...) o header authorization
// - Si falta o es incorrecto → 401 Unauthorized
// - El token va en variable de entorno BACKUP_TOKEN
// 
// RESTAURACIÓN MANUAL (si se necesita):
// 1. Descargar el JSON del email
// 2. Para cada tabla: parsear el array y hacer INSERT en Supabase
// ═══════════════════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

// Variables de entorno (configuradas en Vercel)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffiyprmbrznofoprvvik.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmaXlwcm1icnpub2ZvcHJ2dmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjU2OTYsImV4cCI6MjA5MDc0MTY5Nn0.DesBbR1Az0i-nokR8d7TiJS6zQu3dF-cBfVPlJpcoRg';
const BACKUP_TOKEN = process.env.BACKUP_TOKEN || 'pyc_backup_2026_secret_xK9mZ3qR';
const GMAIL_USER = 'printcopyonline@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'gpxgxfreydphkfcm';

// Lista de tablas a respaldar
const TABLAS = [
  'pedidos',
  'clientes',
  'presupuestos',
  'presupuesto_lineas',
  'solicitudes',
  'proveedores',
  'productores',
  'operarios_telefonos',
  'pedido_archivos',
  'pedido_previas',
  'pedido_log',
  'contadores',
  'contador_global',
  'combinados'
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Verificar token
  const tokenQuery = (req.query && req.query.token) || '';
  const tokenHeader = (req.headers && req.headers.authorization || '').replace('Bearer ', '');
  // Vercel cron envía header 'authorization: Bearer <CRON_SECRET>' configurable
  const cronSecret = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET || ''}` && process.env.CRON_SECRET;
  
  if (tokenQuery !== BACKUP_TOKEN && tokenHeader !== BACKUP_TOKEN && !cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const fechaISO = new Date().toISOString();
    const fechaCorta = fechaISO.split('T')[0];
    const horaCorta = fechaISO.split('T')[1].substring(0, 5).replace(':', '-');
    
    console.log(`[BACKUP] Iniciando backup ${fechaISO}...`);
    
    // Estructura del backup
    const backup = {
      meta: {
        proyecto: 'Print & Copy',
        version: 'v61',
        fecha: fechaISO,
        supabase_url: SUPABASE_URL,
        tablas: TABLAS.length
      },
      data: {}
    };
    
    let totalRegistros = 0;
    const resumen = [];
    
    // Exportar cada tabla
    for (const tabla of TABLAS) {
      try {
        const { data, error } = await supabase.from(tabla).select('*');
        if (error) {
          console.error(`[BACKUP] Error tabla ${tabla}:`, error.message);
          backup.data[tabla] = { error: error.message, registros: 0 };
          resumen.push(`❌ ${tabla}: ERROR (${error.message})`);
        } else {
          backup.data[tabla] = data || [];
          const n = (data || []).length;
          totalRegistros += n;
          resumen.push(`✅ ${tabla}: ${n} registros`);
        }
      } catch (e) {
        console.error(`[BACKUP] Excepción tabla ${tabla}:`, e.message);
        backup.data[tabla] = { error: e.message, registros: 0 };
        resumen.push(`❌ ${tabla}: EXCEPCIÓN (${e.message})`);
      }
    }
    
    backup.meta.total_registros = totalRegistros;
    
    // Convertir a JSON con indentación legible
    const jsonStr = JSON.stringify(backup, null, 2);
    const sizeKB = (Buffer.byteLength(jsonStr, 'utf8') / 1024).toFixed(1);
    
    // Si es petición manual con ?download=1, devolver el JSON directamente
    if (req.query && req.query.download === '1') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="backup_printcopy_${fechaCorta}_${horaCorta}.json"`);
      return res.status(200).send(jsonStr);
    }
    
    // Si no, enviar por email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });
    
    const filename = `backup_printcopy_${fechaCorta}_${horaCorta}.json`;
    const fechaFmt = new Date().toLocaleString('es-ES', { 
      timeZone: 'Europe/Madrid',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    
    const htmlBody = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a">
        <div style="background:#185FA5;color:#fff;padding:20px;border-radius:8px 8px 0 0">
          <h1 style="margin:0;font-size:18px">🔒 Backup Print & Copy</h1>
          <p style="margin:5px 0 0;font-size:13px;opacity:.9">${fechaFmt}</p>
        </div>
        <div style="background:#fff;border:1px solid #ddd;border-top:none;padding:20px;border-radius:0 0 8px 8px">
          <h2 style="font-size:14px;color:#185FA5;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px">Resumen</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
            <tr><td style="padding:6px 0;color:#666">Total tablas</td><td style="text-align:right;font-weight:600">${TABLAS.length}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Total registros</td><td style="text-align:right;font-weight:600">${totalRegistros.toLocaleString('es-ES')}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Tamaño archivo</td><td style="text-align:right;font-weight:600">${sizeKB} KB</td></tr>
          </table>
          <h2 style="font-size:14px;color:#185FA5;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px">Detalle por tabla</h2>
          <pre style="background:#f5f5f0;padding:12px;border-radius:6px;font-size:12px;line-height:1.6;overflow-x:auto;font-family:monospace">${resumen.join('\n')}</pre>
          <div style="background:#FFF8EC;border-left:3px solid #FAC775;padding:10px 12px;margin-top:16px;font-size:12px;color:#854F0B;border-radius:4px">
            💡 <b>Guarda este email.</b> El JSON adjunto contiene todos los datos para restaurar el sistema en caso de pérdida.
          </div>
          <p style="font-size:11px;color:#888;margin:16px 0 0;text-align:center;border-top:1px solid #eee;padding-top:12px">
            Backup automático generado por <code>/api/backup</code><br>
            Print & Copy · printcopy.vercel.app
          </p>
        </div>
      </div>
    `;
    
    const mailOptions = {
      from: '"Print & Copy Backup" <' + GMAIL_USER + '>',
      to: GMAIL_USER,
      subject: `🔒 Backup Print & Copy · ${fechaCorta} · ${totalRegistros.toLocaleString('es-ES')} registros`,
      text: `Backup automático generado el ${fechaFmt}\n\n${resumen.join('\n')}\n\nTotal: ${totalRegistros} registros\nTamaño: ${sizeKB} KB`,
      html: htmlBody,
      attachments: [{
        filename: filename,
        content: jsonStr,
        contentType: 'application/json'
      }]
    };
    
    const info = await transporter.sendMail(mailOptions);
    
    console.log(`[BACKUP] Email enviado: ${info.messageId}`);
    
    return res.status(200).json({
      success: true,
      fecha: fechaISO,
      tablas: TABLAS.length,
      registros: totalRegistros,
      tamano_kb: parseFloat(sizeKB),
      email_message_id: info.messageId,
      resumen: resumen
    });
    
  } catch (error) {
    console.error('[BACKUP] Error general:', error);
    return res.status(500).json({ 
      error: 'Error generando backup', 
      details: error.message 
    });
  }
};

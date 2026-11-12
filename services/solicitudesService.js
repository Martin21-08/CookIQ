const { createHash, randomUUID } = require('node:crypto');

const formatoDia = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
});
function diaChile(fecha = new Date()) {
    const partes = Object.fromEntries(formatoDia.formatToParts(fecha).map(p => [p.type, p.value]));
    return `${partes.year}-${partes.month}-${partes.day}`;
}
function estable(valor) {
    if (Array.isArray(valor)) return valor.map(estable);
    if (valor && typeof valor === 'object') return Object.fromEntries(Object.keys(valor).sort().map(k => [k, estable(valor[k])]));
    return valor;
}
function parametros(req) {
    const b = req.body || {};
    const datos = { consulta: b.consulta ?? '', ingredientes: b.ingredientes ?? [],
        tiempoMaximo: b.tiempoMaximo ?? 30, porciones: b.porciones ?? 2,
        dificultad: b.dificultad ?? 'Todas', pedirFaltantes: b.pedirFaltantes ?? false,
        usarDespensa: b.usarDespensa ?? false, decision: b.confirmacionIntolerancia?.accion ?? null };
    const clave = req.get('Idempotency-Key') || randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clave)) {
        throw error('SUSCRIPCION_CLAVE_INVALIDA', 'La clave de la solicitud no es válida.', 400);
    }
    return { clave: clave.toLowerCase(), huella: createHash('sha256').update(JSON.stringify(estable(datos))).digest(),
        ip: createHash('sha256').update(String(req.ip || req.socket?.remoteAddress || 'desconocida')).digest() };
}
function error(code, mensaje, status = 409) { return Object.assign(new Error(mensaje), { code, status }); }
function comprobarRepeticion(fila, huella) {
    if (!Buffer.from(fila.huella_peticion).equals(huella)) throw error('SUSCRIPCION_CLAVE_REUTILIZADA', 'Esta solicitud ya se utilizó con otros parámetros.');
    if (fila.estado === 'exitosa') return fila;
    if (fila.estado === 'reservada' && Number(fila.vigente) === 0) throw error('SUSCRIPCION_RESERVA_VENCIDA', 'La solicitud anterior venció. Inicia una nueva generación.');
    if (fila.estado === 'reservada') throw error('SUSCRIPCION_EN_CURSO', 'Esta generación sigue en curso. Espera antes de intentarlo nuevamente.');
    throw error('SUSCRIPCION_FINALIZADA', 'Esta solicitud terminó sin guardar recetas. Inicia una nueva generación.');
}
function comprobarCupo(plan, exitosas, reservadas = 0) {
    if (plan.masterchef) return;
    if (exitosas >= Number(plan.solicitudes_diarias)) throw error('SUSCRIPCION_CUOTA_AGOTADA',
        'Has utilizado tus 5 generaciones gratuitas de hoy. Vuelve mañana o descubre MasterChef para cocinar sin límites.', 429);
    if (exitosas + reservadas >= Number(plan.solicitudes_diarias)) throw error('SUSCRIPCION_CUPOS_RESERVADOS', 'Tus cupos disponibles están en uso. Espera a que termine la generación actual.');
}
module.exports = { diaChile, parametros, error, comprobarRepeticion, comprobarCupo };

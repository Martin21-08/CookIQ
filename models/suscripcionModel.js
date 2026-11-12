const pool = require('../config/db');

// No se usan los saldos de tokens ni los IDs numéricos de los planes.
async function obtenerPlan(idUsuario, conexion = pool, bloquear = false) {
    const [usuarios] = await conexion.execute(
        `SELECT id_usuario, id_suscripcion FROM usuario
         WHERE id_usuario = ? AND activo = TRUE${bloquear ? ' FOR UPDATE' : ''}`, [idUsuario]);
    if (!usuarios.length) throw Object.assign(new Error('Debes iniciar sesión nuevamente.'), { status: 401, code: 'SUSCRIPCION_SESION_INVALIDA' });
    const [planes] = await conexion.execute(
        `SELECT s.id_suscripcion, s.codigo, s.nombre, s.solicitudes_diarias, s.precio_clp
         FROM suscripcion s WHERE s.activo = TRUE AND (
           s.codigo = 'gratis' OR (s.codigo = 'masterchef' AND s.id_suscripcion = ? AND EXISTS (
             SELECT 1 FROM suscripcion_usuario su
             WHERE su.id_usuario = ? AND su.id_suscripcion = s.id_suscripcion
               AND su.estado = 'activa' AND su.fecha_inicio <= CURRENT_TIMESTAMP
               AND (su.fecha_fin IS NULL OR su.fecha_fin > CURRENT_TIMESTAMP)
           ))) ORDER BY (s.codigo = 'masterchef') DESC LIMIT 1`,
        [usuarios[0].id_suscripcion, idUsuario]);
    const plan = planes[0];
    if (!plan || (plan.codigo === 'gratis' && Number(plan.solicitudes_diarias) !== 5)
        || (plan.codigo === 'masterchef' && plan.solicitudes_diarias !== null)) {
        throw Object.assign(new Error('No pudimos comprobar tu plan. Intenta más tarde.'), { status: 503, code: 'SUSCRIPCION_NO_DISPONIBLE' });
    }
    return { ...plan, masterchef: plan.codigo === 'masterchef' };
}

module.exports = { obtenerPlan };

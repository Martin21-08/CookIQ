const pool = require('../config/db');
const { obtenerPlan } = require('./suscripcionModel');
const { diaChile, error, comprobarRepeticion, comprobarCupo } = require('../services/solicitudesService');

async function reloj(c) {
    const [[r]] = await c.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(6), '%Y-%m-%dT%H:%i:%s.%fZ') AS ahora");
    return diaChile(new Date(r.ahora));
}
async function buscar(idUsuario, clave, c = pool) {
    const [filas] = await c.execute("SELECT *, (vence_en > UTC_TIMESTAMP(6)) AS vigente FROM solicitud_generacion WHERE id_usuario = ? AND clave_idempotencia = ?", [idUsuario, clave]);
    return filas[0];
}
async function contar(c, idUsuario, dia, excluir = 0) {
    const [[r]] = await c.execute(
        `SELECT COALESCE(SUM(estado = 'exitosa' AND sujeta_cuota = TRUE AND dia_consumo = ?),0) AS exitosas,
          COALESCE(SUM(estado = 'reservada' AND sujeta_cuota = TRUE AND vence_en > UTC_TIMESTAMP(6) AND id_solicitud <> ?),0) AS reservas,
          COALESCE(SUM(estado = 'reservada' AND vence_en > UTC_TIMESTAMP(6) AND id_solicitud <> ?),0) AS activas,
          COALESCE(SUM(creada_en > UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE),0) AS recientes
         FROM solicitud_generacion WHERE id_usuario = ?`, [dia, excluir, excluir, idUsuario]);
    return Object.fromEntries(Object.entries(r).map(([k,v]) => [k, Number(v)]));
}
async function reservar(idUsuario, datos) {
    const c = await pool.getConnection();
    const cerrojo = `cookiq:ip:${datos.ip.toString('hex').slice(0, 48)}`;
    let bloqueada = false;
    let destruida = false;
    let transaccion = false;
    try {
        const [[lock]] = await c.execute('SELECT GET_LOCK(?, 5) AS adquirido', [cerrojo]);
        if (Number(lock.adquirido) !== 1) throw error('SUSCRIPCION_OCUPADA', 'Hay varias solicitudes en curso. Intenta en unos segundos.', 429);
        bloqueada = true;
        // READ COMMITTED y el bloqueo del usuario evitan contar una instantánea anterior.
        await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await c.beginTransaction(); transaccion = true;
        const plan = await obtenerPlan(idUsuario, c, true);
        const anterior = await buscar(idUsuario, datos.clave, c);
        if (anterior) {
            comprobarRepeticion(anterior, datos.huella);
            await c.commit(); transaccion = false;
            return { repetida: true, id: anterior.id_solicitud };
        }
        const dia = await reloj(c);
        const uso = await contar(c, idUsuario, dia);
        comprobarCupo(plan, uso.exitosas, uso.reservas);
        if (uso.activas >= 2) throw error('SUSCRIPCION_CONCURRENCIA', 'Ya tienes dos generaciones en curso. Espera a que terminen.', 429);
        if (uso.recientes >= 3) throw error('SUSCRIPCION_FRECUENCIA', 'Espera un minuto antes de iniciar otra generación.', 429);
        const [[origen]] = await c.execute(`SELECT COUNT(*) AS total FROM solicitud_generacion
            WHERE ip_huella = ? AND creada_en > UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE`, [datos.ip]);
        if (Number(origen.total) >= 30) throw error('SUSCRIPCION_FRECUENCIA_IP', 'Hay muchas solicitudes desde esta red. Intenta en un minuto.', 429);
        const [r] = await c.execute(`INSERT INTO solicitud_generacion
            (id_usuario,id_suscripcion,clave_idempotencia,huella_peticion,ip_huella,estado,sujeta_cuota,
             dia_reserva,cantidad_recetas,creada_en,vence_en)
            VALUES (?,?,?,?,?,'reservada',?,?,0,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6) + INTERVAL 3 MINUTE)`,
        [idUsuario,plan.id_suscripcion,datos.clave,datos.huella,datos.ip,!plan.masterchef,dia]);
        await c.commit(); transaccion = false;
        return { id: r.insertId, repetida: false };
    } catch (e) { if (transaccion) await c.rollback(); throw e; }
    finally {
        if (bloqueada) {
            try { await c.execute('SELECT RELEASE_LOCK(?)', [cerrojo]); }
            catch { c.destroy(); destruida = true; }
        }
        if (!destruida) c.release();
    }
}
async function renovar(id, idUsuario) {
    const [r] = await pool.execute(`UPDATE solicitud_generacion
        SET vence_en = LEAST(UTC_TIMESTAMP(6) + INTERVAL 3 MINUTE, creada_en + INTERVAL 10 MINUTE)
        WHERE id_solicitud = ? AND id_usuario = ? AND estado = 'reservada'
          AND vence_en > UTC_TIMESTAMP(6) AND creada_en + INTERVAL 10 MINUTE > UTC_TIMESTAMP(6)`, [id,idUsuario]);
    return r.affectedRows === 1;
}
async function finalizar(id, idUsuario, cancelada) {
    await pool.execute(`UPDATE solicitud_generacion SET estado = ?, finalizada_en = UTC_TIMESTAMP(6)
        WHERE id_solicitud = ? AND id_usuario = ? AND estado = 'reservada'`, [cancelada ? 'cancelada' : 'fallida',id,idUsuario]);
}
// Se ejecuta dentro de la MISMA transacción que guarda todas las recetas.
async function prepararConfirmacion(c, id, idUsuario) {
    const plan = await obtenerPlan(idUsuario, c, true);
    const [filas] = await c.execute(`SELECT id_solicitud FROM solicitud_generacion
        WHERE id_solicitud = ? AND id_usuario = ? AND estado = 'reservada'
          AND vence_en > UTC_TIMESTAMP(6) AND creada_en + INTERVAL 10 MINUTE > UTC_TIMESTAMP(6) FOR UPDATE`, [id,idUsuario]);
    if (!filas.length) throw error('SUSCRIPCION_RESERVA_VENCIDA', 'La generación venció o fue cancelada. Intenta nuevamente.');
    const dia = await reloj(c);
    const uso = await contar(c,idUsuario,dia,id);
    comprobarCupo(plan,uso.exitosas,uso.reservas);
    return { plan, dia };
}
async function confirmar(c, id, idUsuario, ids, contexto) {
    if (!ids.length) throw new Error('No se puede consumir una solicitud sin recetas.');
    const [r] = await c.execute(`UPDATE solicitud_generacion SET estado = 'exitosa', id_suscripcion = ?,
        sujeta_cuota = ?, dia_consumo = ?, cantidad_recetas = ?, confirmada_en = UTC_TIMESTAMP(6), finalizada_en = UTC_TIMESTAMP(6)
        WHERE id_solicitud = ? AND id_usuario = ? AND estado = 'reservada' AND vence_en > UTC_TIMESTAMP(6)`,
    [contexto.plan.id_suscripcion,!contexto.plan.masterchef,contexto.dia,ids.length,id,idUsuario]);
    if (r.affectedRows !== 1) throw error('SUSCRIPCION_RESERVA_VENCIDA', 'La generación venció. Intenta nuevamente.');
    for (const idReceta of ids) await c.execute('INSERT INTO solicitud_generacion_receta (id_solicitud,id_receta) VALUES (?,?)', [id,idReceta]);
}
async function recuperar(id, idUsuario) {
    const [recetas] = await pool.execute(`SELECT r.id_receta AS idReceta, r.nombre, r.descripcion,
        r.minutos_preparacion AS minutosPreparacion, r.cantidad_porciones AS porciones,
        r.imagen_url AS imagenUrl, d.nombre AS dificultad
        FROM solicitud_generacion_receta sr JOIN solicitud_generacion s ON s.id_solicitud = sr.id_solicitud
        JOIN receta r ON r.id_receta = sr.id_receta LEFT JOIN dificultad d ON d.id_dificultad = r.id_dificultad
        WHERE s.id_solicitud = ? AND s.id_usuario = ? AND s.estado = 'exitosa' AND r.id_usuario = ?`, [id,idUsuario,idUsuario]);
    for (const receta of recetas) {
        const [ingredientes] = await pool.execute(`SELECT i.nombre, ri.cantidad, ri.indicacion, COALESCE(u.abreviatura,u.nombre,'') AS unidad
            FROM receta_ingrediente ri JOIN ingrediente i ON i.id_ingrediente = ri.id_ingrediente
            LEFT JOIN unidad_medida u ON u.id_unidad = ri.id_unidad WHERE ri.id_receta = ?`, [receta.idReceta]);
        const [pasos] = await pool.execute('SELECT descripcion FROM paso_receta WHERE id_receta = ? ORDER BY numero_paso', [receta.idReceta]);
        receta.ingredientes = ingredientes; receta.pasos = pasos.map(p => p.descripcion);
    }
    return { ok: true, repetida: true, cantidad: recetas.length, idBusqueda: null, recetas };
}
module.exports = { buscar, reservar, renovar, finalizar, prepararConfirmacion, confirmar, recuperar };

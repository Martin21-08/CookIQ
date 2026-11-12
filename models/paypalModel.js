const pool = require('../config/db');
const { randomUUID } = require('node:crypto');
const { fallo,PLAN,sqlUTC,horaChile,coberturaVigente,instante } = require('../services/paypalService');

const seleccion = `SELECT p.*, DATE_FORMAT(p.creada_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS creadaISO,
    DATE_FORMAT(p.sincronizada_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS sincronizadaISO,
    DATE_FORMAT(p.actualizado_paypal_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS actualizadaISO
    FROM paypal_suscripcion p`;
async function transaccion(tarea) {
    const c = await pool.getConnection();
    try {
        await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await c.beginTransaction();
        const resultado = await tarea(c); await c.commit(); return resultado;
    } catch (e) { try { await c.rollback(); } catch { /* Mantener el error original. */ } throw e; }
    finally { c.release(); }
}
async function usuario(c,id) {
    const [[u]] = await c.execute('SELECT id_usuario,id_suscripcion FROM usuario WHERE id_usuario = ? AND activo = TRUE FOR UPDATE',[id]);
    if (!u) throw fallo('PAYPAL_USUARIO_INVALIDO',401); return u;
}
async function buscarOperacion(clave,idUsuario,c = pool) {
    const [[p]] = await c.execute(`${seleccion} WHERE p.clave_operacion = ? AND p.id_usuario = ?`,[clave,idUsuario]);
    return p || null;
}
async function buscarRemota(id) {
    const [[p]] = await pool.execute(`${seleccion} WHERE p.paypal_subscription_id = ?`,[id]); return p || null;
}
async function buscarCobro(id) {
    const [[p]] = await pool.execute(`${seleccion} JOIN paypal_cobro pc ON pc.id_paypal_suscripcion = p.id_paypal_suscripcion WHERE pc.paypal_transaction_id = ?`,[id]);
    return p || null;
}
async function ultima(idUsuario) {
    const [[p]] = await pool.execute(`${seleccion} WHERE p.id_usuario = ? ORDER BY p.id_paypal_suscripcion DESC LIMIT 1`,[idUsuario]); return p || null;
}
async function iniciar(idUsuario,clave) {
    return transaccion(async c => {
        const u = await usuario(c,idUsuario);
        const anterior = await buscarOperacion(clave,idUsuario,c);
        if (anterior) return anterior;
        const [[plan]] = await c.execute("SELECT id_suscripcion FROM suscripcion WHERE codigo = 'masterchef' AND activo = TRUE");
        if (!plan) throw fallo('PAYPAL_PLAN_LOCAL_AUSENTE',503);
        const [[derecho]] = await c.execute(`SELECT id_suscripcion_usuario FROM suscripcion_usuario
            WHERE id_usuario = ? AND id_suscripcion = ? AND estado = 'activa' AND fecha_inicio <= CURRENT_TIMESTAMP
            AND (fecha_fin IS NULL OR fecha_fin > CURRENT_TIMESTAMP) LIMIT 1`,[idUsuario,plan.id_suscripcion]);
        if (derecho) throw fallo('PAYPAL_MASTERCHEF_VIGENTE');
        const [[anteriorPaypal]] = await c.execute('SELECT id_paypal_suscripcion FROM paypal_suscripcion WHERE id_usuario = ? LIMIT 1',[idUsuario]);
        // No convertir una asignación manual incompleta en una compra ni modificarla.
        if (u.id_suscripcion === plan.id_suscripcion && !anteriorPaypal) throw fallo('PAYPAL_ASIGNACION_MANUAL');
        const [[pendiente]] = await c.execute(`${seleccion} WHERE p.id_usuario = ?
            AND p.estado_paypal NOT IN ('CANCELLED','EXPIRED','LOCAL_FAILED') ORDER BY p.id_paypal_suscripcion DESC LIMIT 1`,[idUsuario]);
        if (pendiente) return pendiente;
        const referencia = randomUUID();
        await c.execute(`INSERT INTO paypal_suscripcion
            (id_usuario,id_suscripcion,clave_operacion,referencia_cliente,paypal_plan_id,moneda,importe,estado_paypal,creada_en)
            VALUES (?,?,?,?,?,'USD',1.00,'CREATING',UTC_TIMESTAMP(6))`,[idUsuario,plan.id_suscripcion,clave,referencia,PLAN]);
        return buscarOperacion(clave,idUsuario,c);
    });
}
async function vincular(local,remota) {
    return transaccion(async c => {
        await usuario(c,local.id_usuario);
        const [[p]] = await c.execute(`${seleccion} WHERE p.id_paypal_suscripcion = ? FOR UPDATE`,[local.id_paypal_suscripcion]);
        if (!p || p.referencia_cliente !== remota.custom_id || remota.plan_id !== PLAN
            || (p.paypal_subscription_id && p.paypal_subscription_id !== remota.id)) throw fallo('PAYPAL_SUSCRIPCION_NO_COINCIDE');
        if (!p.paypal_subscription_id) await c.execute(`UPDATE paypal_suscripcion SET paypal_subscription_id = ?, estado_paypal = ?
            WHERE id_paypal_suscripcion = ? AND paypal_subscription_id IS NULL`,[remota.id,remota.status,p.id_paypal_suscripcion]);
        return buscarOperacion(p.clave_operacion,p.id_usuario,c);
    });
}
async function comprobarZona(c) {
    const [[r]] = await c.query(`SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ') AS utc,
        DATE_FORMAT(CURRENT_TIMESTAMP(),'%Y-%m-%d %H:%i:%s') AS local`);
    if (horaChile(r.utc) !== r.local) throw fallo('PAYPAL_ZONA_MYSQL_INCOMPATIBLE',503);
    return instante(r.utc);
}
async function sincronizar(local,snapshot) {
    const inicio = Date.now(), tiempos = {};
    const resultado = await transaccion(async c => {
        const u = await usuario(c,local.id_usuario);
        const [[p]] = await c.execute(`${seleccion} WHERE p.id_paypal_suscripcion = ? FOR UPDATE`,[local.id_paypal_suscripcion]);
        if (!p || p.paypal_subscription_id !== snapshot.remota.id) throw fallo('PAYPAL_SUSCRIPCION_NO_COINCIDE');
        const ahora = await comprobarZona(c);
        const remotaFecha = snapshot.remota.update_time || snapshot.remota.create_time;
        if (!remotaFecha) throw fallo('PAYPAL_FECHA_INVALIDA');
        // Un estado obtenido antes de otra sincronización no puede sobrescribirla.
        if (p.actualizadaISO && instante(remotaFecha) < instante(p.actualizadaISO)) throw fallo('PAYPAL_SNAPSHOT_ANTERIOR',503);
        const inicioCobros = Date.now();
        for (const pago of snapshot.cobros) {
            const [[existente]] = await c.execute(`SELECT pc.*,DATE_FORMAT(pc.cobertura_desde,'%Y-%m-%dT%H:%i:%s.%fZ') AS desdeISO,
                DATE_FORMAT(pc.cobertura_hasta,'%Y-%m-%dT%H:%i:%s.%fZ') AS hastaISO FROM paypal_cobro pc
                WHERE paypal_transaction_id = ? FOR UPDATE`,[pago.id]);
            if (existente && String(existente.id_paypal_suscripcion) !== String(p.id_paypal_suscripcion)) throw fallo('PAYPAL_TRANSACCION_AJENA');
            if (existente?.hastaISO && pago.hasta && (+instante(existente.hastaISO) !== +instante(pago.hasta)
                || +instante(existente.desdeISO) !== +instante(pago.desde))) throw fallo('PAYPAL_COBERTURA_NO_VERIFICADA');
            // Reembolsos y reversiones no vuelven a COMPLETED por una consulta antigua.
            const terminal = existente && ['REFUNDED','REVERSED'].includes(existente.estado);
            const estado = terminal ? existente.estado : existente?.estado === 'PARTIAL_REVIEW' && pago.estado === 'COMPLETED'
                ? 'PARTIAL_REVIEW' : pago.estado;
            const desde = existente?.desdeISO || (estado === 'COMPLETED' ? pago.desde : null);
            const hasta = existente?.hastaISO || (estado === 'COMPLETED' ? pago.hasta : null);
            if (existente) await c.execute(`UPDATE paypal_cobro SET estado = ?,verificado_en = UTC_TIMESTAMP(6),cobertura_desde = ?,cobertura_hasta = ?
                WHERE id_paypal_cobro = ?`,[estado,desde ? sqlUTC(desde):null,hasta ? sqlUTC(hasta):null,existente.id_paypal_cobro]);
            else await c.execute(`INSERT INTO paypal_cobro (id_paypal_suscripcion,paypal_transaction_id,moneda,importe,estado,
                ocurrido_en,verificado_en,cobertura_desde,cobertura_hasta) VALUES (?,?,'USD',1.00,?,?,UTC_TIMESTAMP(6),?,?)`,
            [p.id_paypal_suscripcion,pago.id,estado,sqlUTC(pago.ocurrido),desde ? sqlUTC(desde):null,hasta ? sqlUTC(hasta):null]);
        }
        tiempos.cobrosMs = Date.now()-inicioCobros;
        const inicioContrato = Date.now();
        const [cobros] = await c.execute(`SELECT estado,DATE_FORMAT(cobertura_desde,'%Y-%m-%dT%H:%i:%s.%fZ') AS desde,
            DATE_FORMAT(cobertura_hasta,'%Y-%m-%dT%H:%i:%s.%fZ') AS hasta FROM paypal_cobro WHERE id_paypal_suscripcion = ?`,[p.id_paypal_suscripcion]);
        const cobertura = coberturaVigente(cobros,ahora);
        let contrato = p.id_suscripcion_usuario;
        if (contrato) {
            const [[su]] = await c.execute(`SELECT id_suscripcion_usuario FROM suscripcion_usuario
                WHERE id_suscripcion_usuario = ? AND id_usuario = ? AND id_suscripcion = ? AND origen = 'paypal_sandbox' FOR UPDATE`,[contrato,p.id_usuario,p.id_suscripcion]);
            if (!su) throw fallo('PAYPAL_CONTRATO_NO_PROPIO');
            if (cobertura) await c.execute(`UPDATE suscripcion_usuario SET estado = 'activa',fecha_inicio = ?,fecha_fin = ?
                WHERE id_suscripcion_usuario = ? AND origen = 'paypal_sandbox'`,[horaChile(cobertura.desde),horaChile(cobertura.hasta),contrato]);
            else await c.execute("UPDATE suscripcion_usuario SET estado = 'vencida' WHERE id_suscripcion_usuario = ? AND origen = 'paypal_sandbox'",[contrato]);
        } else if (cobertura) {
            const [r] = await c.execute(`INSERT INTO suscripcion_usuario (id_usuario,id_suscripcion,fecha_inicio,fecha_fin,estado,origen)
                VALUES (?,?,?,?,'activa','paypal_sandbox')`,[p.id_usuario,p.id_suscripcion,horaChile(cobertura.desde),horaChile(cobertura.hasta)]);
            contrato = r.insertId;
        }
        await c.execute(`UPDATE paypal_suscripcion SET id_suscripcion_usuario = ?,estado_paypal = ?,pagado_hasta = ?,
            actualizado_paypal_en = ?,sincronizada_en = UTC_TIMESTAMP(6) WHERE id_paypal_suscripcion = ?`,
        [contrato,snapshot.remota.status,cobertura ? sqlUTC(cobertura.hasta):null,sqlUTC(remotaFecha),p.id_paypal_suscripcion]);
        tiempos.contratoMs = Date.now()-inicioContrato;
        const inicioPlan = Date.now();
        const [[vigente]] = await c.execute(`SELECT su.id_suscripcion FROM suscripcion_usuario su JOIN suscripcion s ON s.id_suscripcion = su.id_suscripcion
            WHERE su.id_usuario = ? AND s.codigo = 'masterchef' AND s.activo = TRUE AND su.estado = 'activa'
            AND su.fecha_inicio <= CURRENT_TIMESTAMP AND (su.fecha_fin IS NULL OR su.fecha_fin > CURRENT_TIMESTAMP) LIMIT 1`,[p.id_usuario]);
        if (vigente) {
            if (u.id_suscripcion !== vigente.id_suscripcion) {
                const [actualizacion] = await c.execute('UPDATE usuario SET id_suscripcion = ? WHERE id_usuario = ?',[vigente.id_suscripcion,p.id_usuario]);
                // Cobro, contrato y plan se confirman juntos. No aceptar una
                // activación incompleta si la actualización no alcanzó al usuario.
                if (actualizacion.affectedRows !== 1) throw fallo('PAYPAL_PLAN_NO_ACTUALIZADO',503);
            }
        }
        tiempos.planUsuarioMs = Date.now()-inicioPlan;
        // No rebajar asignaciones: el autorizador existente vuelve a Gratis si
        // no hay contrato vigente, y conserva cualquier contrato independiente.
        return { activa:Boolean(cobertura),hasta:cobertura?.hasta.toISOString() || null,revision:cobros.some(pago => pago.estado === 'PARTIAL_REVIEW'),estado:snapshot.remota.status };
    });
    console.info('[PayPal: persistencia]',{operacion:local.id_paypal_suscripcion,...tiempos,
        transaccionMs:Date.now()-inicio,coberturaVigente:resultado.activa});
    return resultado;
}
async function registrarEvento(evento,huella) {
    return transaccion(async c => {
        const [[anterior]] = await c.execute('SELECT huella_contenido FROM paypal_evento WHERE paypal_event_id = ? FOR UPDATE',[evento.id]);
        if (anterior) {
            if (!Buffer.from(anterior.huella_contenido).equals(huella)) throw fallo('PAYPAL_EVENTO_MODIFICADO',400);
            return;
        }
        await c.execute(`INSERT INTO paypal_evento (paypal_event_id,tipo,recurso_id,huella_contenido,recibido_en,ocurrido_en)
            VALUES (?,?,?,?,UTC_TIMESTAMP(6),?)`,[evento.id,evento.event_type,evento.resource?.id || null,huella,evento.create_time ? sqlUTC(evento.create_time):null]);
    });
}
async function reclamarEvento(id) {
    const [r] = await pool.execute(`UPDATE paypal_evento SET estado = 'procesando',intentos = intentos + 1,bloqueo_hasta = UTC_TIMESTAMP(6) + INTERVAL 2 MINUTE
        WHERE paypal_event_id = ? AND ((estado IN ('pendiente','error') AND (proximo_intento_en IS NULL OR proximo_intento_en <= UTC_TIMESTAMP(6)))
        OR (estado = 'procesando' AND bloqueo_hasta < UTC_TIMESTAMP(6)))`,[id]);
    if (!r.affectedRows) return null;
    const [[fila]] = await pool.execute('SELECT * FROM paypal_evento WHERE paypal_event_id = ?',[id]); return fila;
}
async function cerrarEvento(fila,error) {
    // intentos es el token de la concesión: un trabajador viejo no cierra una concesión nueva.
    await pool.execute(`UPDATE paypal_evento SET estado = ?,procesado_en = ${error ? 'NULL':'UTC_TIMESTAMP(6)'},bloqueo_hasta = NULL,
        proximo_intento_en = ${error ? 'UTC_TIMESTAMP(6) + INTERVAL 5 MINUTE':'NULL'},ultimo_error_codigo = ?
        WHERE paypal_event_id = ? AND estado = 'procesando' AND intentos = ?`,
    [error ? 'error':'procesado',error ? String(error.code || 'PAYPAL_PROCESAMIENTO_FALLIDO').slice(0,80):null,fila.paypal_event_id,fila.intentos]);
}
async function eventosPendientes() {
    const [filas] = await pool.query(`SELECT paypal_event_id FROM paypal_evento WHERE
        (estado IN ('pendiente','error') AND (proximo_intento_en IS NULL OR proximo_intento_en <= UTC_TIMESTAMP(6)))
        OR (estado = 'procesando' AND bloqueo_hasta < UTC_TIMESTAMP(6)) ORDER BY recibido_en LIMIT 10`); return filas;
}
async function contratosPendientes(excluir = []) {
    const enfriando = excluir.filter(id => typeof id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(id));
    const filtro = enfriando.length ? ` AND (p.paypal_subscription_id IS NULL OR p.paypal_subscription_id NOT IN (${enfriando.map(() => '?').join(',')}))`:'';
    const [filas] = await pool.execute(`${seleccion} WHERE ((p.estado_paypal = 'CREATING' AND p.paypal_subscription_id IS NULL
        AND p.creada_en > UTC_TIMESTAMP(6) - INTERVAL 71 HOUR AND p.creada_en < UTC_TIMESTAMP(6) - INTERVAL 2 MINUTE)
        OR (p.paypal_subscription_id IS NOT NULL AND (
        ((p.estado_paypal NOT IN ('CANCELLED','EXPIRED') OR p.pagado_hasta > UTC_TIMESTAMP(6))
            AND (p.sincronizada_en IS NULL OR p.sincronizada_en < UTC_TIMESTAMP(6) - INTERVAL 5 MINUTE))
        OR (p.pagado_hasta IS NOT NULL AND p.pagado_hasta <= UTC_TIMESTAMP(6)
            AND (p.sincronizada_en IS NULL OR p.sincronizada_en < p.pagado_hasta))
        OR (p.id_suscripcion_usuario IS NULL
            AND p.estado_paypal NOT IN ('CANCELLED','EXPIRED')
            AND (p.sincronizada_en IS NULL OR p.sincronizada_en < UTC_TIMESTAMP(6) - INTERVAL 5 SECOND)))))${filtro}
        ORDER BY p.sincronizada_en LIMIT 5`,enfriando); return filas;
}
async function reclamarAvisoCompra(local) {
    // La marca es independiente de los cobros: una renovación no la reinicia.
    // UPDATE condicional: solo una pestaña/sesión puede reclamar el aviso.
    const [r] = await pool.execute(`UPDATE paypal_suscripcion p
        JOIN usuario u ON u.id_usuario = p.id_usuario AND u.id_suscripcion = p.id_suscripcion
        JOIN suscripcion_usuario su ON su.id_suscripcion_usuario = p.id_suscripcion_usuario
            AND su.id_usuario = p.id_usuario AND su.id_suscripcion = p.id_suscripcion
        JOIN suscripcion s ON s.id_suscripcion = p.id_suscripcion
        SET p.compra_notificada_en = UTC_TIMESTAMP(6)
        WHERE p.id_paypal_suscripcion = ? AND p.id_usuario = ? AND p.compra_notificada_en IS NULL
            AND u.activo = TRUE AND s.codigo = 'masterchef' AND s.activo = TRUE
            AND su.origen = 'paypal_sandbox' AND su.estado = 'activa'
            AND su.fecha_inicio <= CURRENT_TIMESTAMP AND (su.fecha_fin IS NULL OR su.fecha_fin > CURRENT_TIMESTAMP)
            AND p.pagado_hasta > UTC_TIMESTAMP(6)
            AND EXISTS (SELECT 1 FROM paypal_cobro pc WHERE pc.id_paypal_suscripcion = p.id_paypal_suscripcion
                AND pc.estado = 'COMPLETED' AND pc.moneda = 'USD' AND pc.importe = 1.00
                AND pc.cobertura_desde <= UTC_TIMESTAMP(6) AND pc.cobertura_hasta > UTC_TIMESTAMP(6))`,
    [local.id_paypal_suscripcion,local.id_usuario]);
    return r.affectedRows === 1;
}
module.exports = { iniciar,buscarOperacion,buscarRemota,buscarCobro,ultima,vincular,sincronizar,registrarEvento,reclamarEvento,cerrarEvento,eventosPendientes,contratosPendientes,reclamarAvisoCompra };

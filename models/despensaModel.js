// Consultas MySQL de la despensa. Cada operación sobre despensa se limita al usuario.
const db = require('../config/db');
const ingredienteModel = require('./ingredienteModel');

const obtenerPorUsuario = async idUsuario => {
    const [filas] = await db.query(`
        SELECT
            d.id_ingrediente,
            i.nombre AS ingrediente,
            d.cantidad,
            d.id_unidad,
            u.nombre AS unidad,
            u.abreviatura,
            u.familia
        FROM despensa d
        INNER JOIN ingrediente i ON i.id_ingrediente = d.id_ingrediente
        INNER JOIN unidad_medida u ON u.id_unidad = d.id_unidad
        WHERE d.id_usuario = ?
          AND i.activo = TRUE AND i.estado IN ('validado', 'pendiente')
        ORDER BY i.nombre ASC
    `, [idUsuario]);
    return filas;
};

const buscarIngredientesCatalogo = async nombres => {
    if (!nombres.length) return [];

    const marcadores = nombres.map(() => '?').join(', ');
    const [filas] = await db.query(`
        SELECT DISTINCT
            i.id_ingrediente,
            i.nombre,
            i.familia_unidad,
            i.estado,
            i.activo
        FROM ingrediente i
        LEFT JOIN ingrediente_alias ia ON ia.id_ingrediente = i.id_ingrediente
        WHERE (
              LOWER(TRIM(i.nombre)) IN (${marcadores})
              OR LOWER(TRIM(ia.alias)) IN (${marcadores})
          )
    `, [...nombres, ...nombres]);
    return filas;
};

const buscarUnidades = async nombres => {
    if (!nombres.length) return [];

    const marcadores = nombres.map(() => '?').join(', ');
    const [filas] = await db.query(`
        SELECT id_unidad, nombre, abreviatura, familia
        FROM unidad_medida
        WHERE LOWER(TRIM(nombre)) IN (${marcadores})
           OR LOWER(TRIM(abreviatura)) IN (${marcadores})
    `, [...nombres, ...nombres]);
    return filas;
};

const obtenerUnidadesPorFamilia = async familia => {
    const [filas] = await db.query(`
        SELECT id_unidad, nombre, abreviatura, familia
        FROM unidad_medida
        WHERE familia = ?
        ORDER BY id_unidad ASC
    `, [familia]);
    return filas;
};

const guardarIngrediente = async ({ idUsuario, idIngrediente, cantidad, idUnidad }) => {
    const [resultado] = await db.query(`
        INSERT INTO despensa (id_usuario, id_ingrediente, cantidad, id_unidad)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            cantidad = VALUES(cantidad),
            id_unidad = VALUES(id_unidad),
            fecha_actualizacion = CURRENT_TIMESTAMP
    `, [idUsuario, idIngrediente, cantidad, idUnidad]);
    return resultado;
};

const prepararIngredienteManual = async ({ nombre, idUnidad }) => {
    const [unidades] = await db.execute('SELECT id_unidad, familia FROM unidad_medida WHERE id_unidad = ?', [idUnidad]);
    if (!unidades.length) throw Object.assign(new Error('La unidad no existe.'), { code: 'UNIT_NOT_FOUND' });
    const ingrediente = await ingredienteModel.buscarManualPorNombre(db, nombre);
    if (ingrediente) {
        const code = ingrediente.estado === 'rechazado' ? 'INGREDIENT_REJECTED'
            : !ingrediente.activo ? 'INGREDIENT_INACTIVE'
            : !['validado', 'pendiente'].includes(ingrediente.estado) ? 'INGREDIENT_INACTIVE'
            : ingrediente.familia_unidad !== unidades[0].familia ? 'UNIT_INCOMPATIBLE' : null;
        if (code) throw Object.assign(new Error('El ingrediente no está disponible con esa unidad.'), { code });
    }
    return ingrediente;
};

const agregarIngredienteManual = async ({ idUsuario, nombre, cantidad, idUnidad, idTipoAlimento }) => {
    const connection = await db.getConnection();
    let iniciada = false;
    try {
        await connection.beginTransaction();
        iniciada = true;

        const [unidades] = await connection.execute(
            'SELECT id_unidad, nombre, abreviatura, familia FROM unidad_medida WHERE id_unidad = ? FOR UPDATE',
            [idUnidad]
        );
        if (!unidades.length) {
            const error = new Error('La unidad indicada no existe.');
            error.code = 'UNIT_NOT_FOUND';
            throw error;
        }

        const unidad = unidades[0];
        const ingrediente = await ingredienteModel.buscarOCrearManualTransaccional(connection, {
            nombre,
            familia: unidad.familia,
            idTipoAlimento,
            permitirPendienteIA: true
        });
        const [existencias] = await connection.execute(
            `SELECT u.familia
             FROM despensa d
             INNER JOIN unidad_medida u ON u.id_unidad = d.id_unidad
             WHERE d.id_usuario = ? AND d.id_ingrediente = ?
             FOR UPDATE`,
            [idUsuario, ingrediente.id_ingrediente]
        );
        if (existencias.length && existencias[0].familia !== unidad.familia) {
            const error = new Error('La unidad guardada en tu despensa no es compatible con la unidad seleccionada. No se reemplazaron los datos.');
            error.code = 'PANTRY_UNIT_INCOMPATIBLE';
            throw error;
        }
        await connection.execute(
            `INSERT INTO despensa (id_usuario, id_ingrediente, cantidad, id_unidad)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                cantidad = VALUES(cantidad),
                id_unidad = VALUES(id_unidad),
                fecha_actualizacion = CURRENT_TIMESTAMP`,
            [idUsuario, ingrediente.id_ingrediente, cantidad, idUnidad]
        );

        await connection.commit();
        iniciada = false;
        return { ingrediente, unidad, cantidad };
    } catch (error) {
        if (iniciada) {
            try { await connection.rollback(); } catch { /* conserva el error original */ }
        }
        throw error;
    } finally {
        connection.release();
    }
};

const decimalAEnteroEscalado = (valor, decimales) => {
    const texto = String(valor);
    const [entero, fraccion = ''] = texto.split('.');
    if (!/^\d+$/.test(entero) || fraccion.length > decimales || !/^\d*$/.test(fraccion)) {
        const error = new Error('La cantidad o el factor de conversión no tiene un formato válido.');
        error.code = 'INVALID_DECIMAL';
        throw error;
    }
    return BigInt(entero) * (10n ** BigInt(decimales)) + BigInt((fraccion + '0'.repeat(decimales)).slice(0, decimales) || '0');
};

const formatearMillesimas = valor => {
    const entero = valor / 1000n;
    const fraccion = String(valor % 1000n).padStart(3, '0').replace(/0+$/, '');
    return fraccion ? `${entero}.${fraccion}` : String(entero);
};

const agregarCantidadTransaccional = async (connection, { idUsuario, idIngrediente, cantidad, idUnidad, familiaIngrediente }) => {
    const [unidades] = await connection.execute(
        'SELECT id_unidad, familia, factor_a_base FROM unidad_medida WHERE id_unidad = ? FOR UPDATE',
        [idUnidad]
    );
    if (!unidades.length) {
        const error = new Error('La unidad indicada no existe.');
        error.code = 'UNIT_NOT_FOUND';
        throw error;
    }
    const unidadCompra = unidades[0];
    if (unidadCompra.familia !== familiaIngrediente) {
        const error = new Error('La unidad no es compatible con el ingrediente.');
        error.code = 'UNIT_INCOMPATIBLE';
        throw error;
    }

    const [existencias] = await connection.execute(
        `SELECT d.cantidad, d.id_unidad, u.familia, u.factor_a_base
         FROM despensa d
         INNER JOIN unidad_medida u ON u.id_unidad = d.id_unidad
         WHERE d.id_usuario = ? AND d.id_ingrediente = ? FOR UPDATE`,
        [idUsuario, idIngrediente]
    );
    if (!existencias.length) {
        await connection.execute(
            `INSERT INTO despensa (id_usuario, id_ingrediente, cantidad, id_unidad)
             VALUES (?, ?, ?, ?)`,
            [idUsuario, idIngrediente, cantidad, idUnidad]
        );
        return { agregado: true, cantidad, idUnidad };
    }

    const existencia = existencias[0];
    if (existencia.familia !== unidadCompra.familia || existencia.familia !== familiaIngrediente) {
        const error = new Error('Las unidades de la compra y de la despensa no se pueden convertir de forma segura.');
        error.code = 'UNIT_INCOMPATIBLE';
        throw error;
    }
    const cantidadCompra = decimalAEnteroEscalado(cantidad, 3);
    const factorCompra = decimalAEnteroEscalado(unidadCompra.factor_a_base, 6);
    const factorExistencia = decimalAEnteroEscalado(existencia.factor_a_base, 6);
    const numerador = cantidadCompra * factorCompra;
    if (numerador % factorExistencia !== 0n) {
        const error = new Error('La conversión requiere más de tres decimales y no se aplicó.');
        error.code = 'CONVERSION_PRECISION';
        throw error;
    }
    const cantidadConvertida = numerador / factorExistencia;
    const cantidadActual = decimalAEnteroEscalado(existencia.cantidad, 3);
    const total = cantidadActual + cantidadConvertida;
    if (total <= 0n || total > 9999999999n) {
        const error = new Error('La cantidad total supera el límite permitido para la despensa.');
        error.code = 'QUANTITY_OUT_OF_RANGE';
        throw error;
    }
    const cantidadTotal = formatearMillesimas(total);
    await connection.execute(
        `UPDATE despensa
         SET cantidad = ?, fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id_usuario = ? AND id_ingrediente = ?`,
        [cantidadTotal, idUsuario, idIngrediente]
    );
    return { agregado: true, cantidad: cantidadTotal, idUnidad: existencia.id_unidad };
};

const eliminarIngrediente = async (idUsuario, idIngrediente) => {
    const [resultado] = await db.query(`
        DELETE FROM despensa
        WHERE id_usuario = ? AND id_ingrediente = ?
    `, [idUsuario, idIngrediente]);
    return resultado.affectedRows;
};

const limpiarPorUsuario = async idUsuario => {
    const [resultado] = await db.query(`
        DELETE FROM despensa
        WHERE id_usuario = ?
    `, [idUsuario]);
    return resultado.affectedRows;
};

module.exports = {
    obtenerPorUsuario,
    buscarIngredientesCatalogo,
    buscarUnidades,
    obtenerUnidadesPorFamilia,
    guardarIngrediente,
    agregarIngredienteManual,
    prepararIngredienteManual,
    agregarCantidadTransaccional,
    eliminarIngrediente,
    limpiarPorUsuario
};

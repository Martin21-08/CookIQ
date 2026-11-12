// Acceso a las tablas existentes de lista de compras y despensa.
// Las operaciones actuales usan el esquema instalado: id_ingrediente es la
// identidad del ítem hasta que se aplique la migración de ingredientes libres.
const db = require('../config/db');
const ingredienteModel = require('./ingredienteModel');
const despensaModel = require('./despensaModel');
const { calcularFaltante } = require('../services/faltantesService');
const { crearValidador } = require('../services/seguridadAlimentariaService');
const validadorProductos = crearValidador({});

const crearError = (code, message) => Object.assign(new Error(message), { code });

const conTransaccion = async callback => {
    const connection = await db.getConnection();
    let iniciada = false;
    try {
        await connection.beginTransaction();
        iniciada = true;
        const resultado = await callback(connection);
        await connection.commit();
        iniciada = false;
        return resultado;
    } catch (error) {
        if (iniciada) {
            try { await connection.rollback(); } catch { /* conserva el error original */ }
        }
        throw error;
    } finally {
        connection.release();
    }
};

// Bloquear la fila de usuario serializa la creación de la lista activa incluso
// cuando todavía no hay una lista que se pueda bloquear.
const obtenerListaActivaTransaccional = async (connection, idUsuario, crear) => {
    const [usuarios] = await connection.execute(
        'SELECT id_usuario FROM usuario WHERE id_usuario = ? FOR UPDATE',
        [idUsuario]
    );
    if (!usuarios.length) throw crearError('USER_NOT_FOUND', 'La cuenta de la sesión ya no existe.');

    const [listas] = await connection.execute(
        `SELECT id_lista, nombre, estado, fecha_creacion
         FROM lista_compra
         WHERE id_usuario = ? AND estado = 'activa'
         ORDER BY id_lista ASC
         LIMIT 2 FOR UPDATE`,
        [idUsuario]
    );
    if (listas.length > 1) {
        throw crearError('ACTIVE_LIST_CONFLICT', 'Tu cuenta tiene más de una lista activa. Se requiere revisar esas listas antes de continuar.');
    }
    if (listas.length === 1) return listas[0];
    if (!crear) return null;

    const [resultado] = await connection.execute(
        "INSERT INTO lista_compra (id_usuario, nombre, estado) VALUES (?, 'Lista de compras', 'activa')",
        [idUsuario]
    );
    return { id_lista: resultado.insertId, nombre: 'Lista de compras', estado: 'activa' };
};

const obtenerListaActiva = async idUsuario => {
    const [listas] = await db.execute(
        `SELECT id_lista, nombre, estado, fecha_creacion
         FROM lista_compra
         WHERE id_usuario = ? AND estado = 'activa'
         ORDER BY id_lista ASC
         LIMIT 2`,
        [idUsuario]
    );
    if (listas.length > 1) {
        throw crearError('ACTIVE_LIST_CONFLICT', 'Tu cuenta tiene más de una lista activa. Se requiere revisar esas listas antes de continuar.');
    }
    return listas[0] || null;
};

const obtenerElementos = async (idUsuario, idLista) => {
    const [filas] = await db.execute(
        `SELECT
            li.id_ingrediente AS id_item,
            li.id_ingrediente,
            NULL AS nombre_personalizado,
            i.nombre AS ingrediente,
            i.familia_unidad AS familia_ingrediente,
            li.cantidad,
            li.id_unidad,
            u.nombre AS unidad,
            u.abreviatura,
            u.familia,
            li.comprado,
            li.fecha_compra
         FROM lista_compra_ingrediente li
         INNER JOIN lista_compra l ON l.id_lista = li.id_lista
         INNER JOIN ingrediente i ON i.id_ingrediente = li.id_ingrediente
         LEFT JOIN unidad_medida u ON u.id_unidad = li.id_unidad
         WHERE l.id_usuario = ? AND l.id_lista = ? AND li.comprado = FALSE
         ORDER BY i.nombre ASC`,
        [idUsuario, idLista]
    );
    return filas;
};

const obtenerUnidades = async () => {
    const [filas] = await db.execute(
        `SELECT id_unidad, nombre, abreviatura, familia, factor_a_base
         FROM unidad_medida
         ORDER BY nombre ASC`
    );
    return filas;
};

const validarIngredienteYUnidad = async (connection, idIngrediente, idUnidad) => {
    const [ingredientes] = await connection.execute(
        `SELECT nombre, familia_unidad
         FROM ingrediente
         WHERE id_ingrediente = ? AND estado IN ('validado', 'pendiente') AND activo = TRUE`,
        [idIngrediente]
    );
    if (!ingredientes.length) throw crearError('INGREDIENT_NOT_FOUND', 'No se encontró un ingrediente activo y permitido del catálogo.');
    if (validadorProductos.evaluar(ingredientes[0].nombre).tipo === 'sustancia_no_apta') {
        throw crearError('INGREDIENT_NOT_ALLOWED', 'El producto no es un ingrediente culinario permitido.');
    }

    if (idUnidad === null) return { familiaIngrediente: ingredientes[0].familia_unidad, unidad: null };

    const [unidades] = await connection.execute(
        'SELECT id_unidad, nombre, abreviatura, familia, factor_a_base FROM unidad_medida WHERE id_unidad = ?',
        [idUnidad]
    );
    if (!unidades.length) throw crearError('UNIT_NOT_FOUND', 'La unidad indicada no existe.');
    if (unidades[0].familia !== ingredientes[0].familia_unidad) {
        throw crearError('UNIT_INCOMPATIBLE', 'La unidad no es compatible con la familia del ingrediente.');
    }
    return { familiaIngrediente: ingredientes[0].familia_unidad, unidad: unidades[0] };
};

const obtenerOPrepararListaActiva = idUsuario => conTransaccion(
    connection => obtenerListaActivaTransaccional(connection, idUsuario, true)
);

const decimalEscalado = (valor, precision) => {
    const texto = String(valor);
    if (!new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`).test(texto)) throw crearError('INVALID_DECIMAL', 'Cantidad o factor decimal no válido.');
    const [entero, fraccion = ''] = texto.split('.');
    return BigInt(entero) * 10n ** BigInt(precision) + BigInt(fraccion.padEnd(precision, '0'));
};

const sumarCantidadLista = async (connection, existente, cantidad, unidadNueva) => {
    if (existente.cantidad === null || existente.id_unidad === null) {
        throw crearError('EXISTING_QUANTITY_UNKNOWN', 'La cantidad anterior no está definida. Usa Guardar cantidad para indicarla antes de acumular.');
    }
    const [unidades] = await connection.execute('SELECT familia, factor_a_base FROM unidad_medida WHERE id_unidad = ?', [existente.id_unidad]);
    if (!unidades.length) throw crearError('UNIT_NOT_FOUND', 'La unidad anterior no existe.');
    if (!unidadNueva || unidades[0].familia !== unidadNueva.familia) throw crearError('UNIT_INCOMPATIBLE', 'No se pueden sumar cantidades de familias distintas.');
    const factorAnterior = decimalEscalado(unidades[0].factor_a_base, 6);
    const factorNuevo = decimalEscalado(unidadNueva.factor_a_base, 6);
    if (factorAnterior <= 0n || factorNuevo <= 0n) throw crearError('INVALID_DECIMAL', 'El factor de conversión no es válido.');
    const numerador = decimalEscalado(cantidad, 3) * factorNuevo;
    if (numerador % factorAnterior !== 0n) throw crearError('CONVERSION_PRECISION', 'La conversión no es exacta con tres decimales.');
    const total = decimalEscalado(existente.cantidad, 3) + numerador / factorAnterior;
    if (total <= 0n || total > 9999999999n) throw crearError('QUANTITY_OUT_OF_RANGE', 'La cantidad total supera el límite permitido.');
    return `${total / 1000n}${total % 1000n ? '.' + String(total % 1000n).padStart(3, '0').replace(/0+$/, '') : ''}`;
};

const guardarEnLista = async (connection, lista, { idIngrediente, cantidad, idUnidad, reabrir = false, conservarExistente = false, acumular = false }) => {
    const { unidad } = await validarIngredienteYUnidad(connection, idIngrediente, idUnidad);

    const [existentes] = await connection.execute(
        `SELECT cantidad, id_unidad, comprado
         FROM lista_compra_ingrediente
         WHERE id_lista = ? AND id_ingrediente = ? FOR UPDATE`,
        [lista.id_lista, idIngrediente]
    );

    // Un POST repetido no duplica ni reinicia una compra ya completada.
    if (existentes.length) {
        if (Boolean(existentes[0].comprado)) {
            if (reabrir) {
                await connection.execute(`UPDATE lista_compra_ingrediente SET cantidad = ?, id_unidad = ?, comprado = FALSE, fecha_compra = NULL WHERE id_lista = ? AND id_ingrediente = ?`,
                    [cantidad, idUnidad, lista.id_lista, idIngrediente]);
                return { lista, creado: true, yaComprado: false, reactivado: true };
            }
            return { lista, creado: false, yaComprado: true };
        }
        if (cantidad !== null && !conservarExistente) {
            const cantidadGuardada = acumular ? await sumarCantidadLista(connection, existentes[0], cantidad, unidad) : cantidad;
            const unidadGuardada = acumular ? existentes[0].id_unidad : idUnidad;
            await connection.execute(
                `UPDATE lista_compra_ingrediente
                 SET cantidad = ?, id_unidad = ?
                 WHERE id_lista = ? AND id_ingrediente = ?`,
                [cantidadGuardada, unidadGuardada, lista.id_lista, idIngrediente]
            );
            return { lista, creado: false, yaComprado: false, actualizado: true, acumulado: acumular };
        }
        return { lista, creado: false, yaComprado: false };
    }

    await connection.execute(
        `INSERT INTO lista_compra_ingrediente
            (id_lista, id_ingrediente, cantidad, id_unidad, comprado, fecha_compra)
         VALUES (?, ?, ?, ?, FALSE, NULL)`,
        [lista.id_lista, idIngrediente, cantidad, idUnidad]
    );
    return { lista, creado: true, yaComprado: false };
};

const agregarIngredienteCatalogo = (idUsuario, datos) => conTransaccion(async connection => {
    const lista = await obtenerListaActivaTransaccional(connection, idUsuario, true);
    return guardarEnLista(connection, lista, datos);
});

const agregarIngredientePorNombre = (idUsuario, { nombre, cantidad, idUnidad, idTipoAlimento, importar = false }) => conTransaccion(async connection => {
    const lista = await obtenerListaActivaTransaccional(connection, idUsuario, true);
    const [unidades] = await connection.execute('SELECT familia FROM unidad_medida WHERE id_unidad = ?', [idUnidad]);
    if (!unidades.length) throw crearError('UNIT_NOT_FOUND', 'La unidad indicada no existe.');
    const ingrediente = await ingredienteModel.buscarOCrearManualTransaccional(connection, {
        nombre, familia: unidades[0].familia, idTipoAlimento, permitirPendienteIA: true
    });
    return { ...await guardarEnLista(connection, lista, { idIngrediente: ingrediente.id_ingrediente, cantidad, idUnidad,
        reabrir: !importar, conservarExistente: importar, acumular: !importar }), idIngrediente: ingrediente.id_ingrediente };
});

// No consulta columnas de la migración pendiente; falla explícitamente hasta aplicarla.
const agregarIngredientePersonalizado = async () => {
    throw crearError('CUSTOM_SCHEMA_REQUIRED', 'Los nombres personalizados requieren una migración de base de datos pendiente.');
};

const actualizarIngredienteCatalogo = (idUsuario, idIngrediente, { cantidad, idUnidad }) => conTransaccion(async connection => {
    const lista = await obtenerListaActivaTransaccional(connection, idUsuario, false);
    if (!lista) return false;
    await validarIngredienteYUnidad(connection, idIngrediente, idUnidad);

    const [filas] = await connection.execute(
        `SELECT comprado FROM lista_compra_ingrediente
         WHERE id_lista = ? AND id_ingrediente = ? FOR UPDATE`,
        [lista.id_lista, idIngrediente]
    );
    if (!filas.length) return false;
    if (Boolean(filas[0].comprado)) throw crearError('ITEM_ALREADY_BOUGHT', 'No se puede editar un elemento ya marcado como comprado.');

    await connection.execute(
        `UPDATE lista_compra_ingrediente
         SET cantidad = ?, id_unidad = ?
         WHERE id_lista = ? AND id_ingrediente = ?`,
        [cantidad, idUnidad, lista.id_lista, idIngrediente]
    );
    return true;
});

const eliminarIngrediente = (idUsuario, idIngrediente) => conTransaccion(async connection => {
    const lista = await obtenerListaActivaTransaccional(connection, idUsuario, false);
    if (!lista) return 0;
    const [resultado] = await connection.execute(
        `DELETE li FROM lista_compra_ingrediente li
         INNER JOIN lista_compra l ON l.id_lista = li.id_lista
         WHERE l.id_usuario = ? AND l.id_lista = ? AND li.id_ingrediente = ? AND li.comprado = FALSE`,
        [idUsuario, lista.id_lista, idIngrediente]
    );
    return resultado.affectedRows;
});

const vaciarElementos = idUsuario => conTransaccion(async connection => {
    const lista = await obtenerListaActivaTransaccional(connection, idUsuario, false);
    if (!lista) return 0;

    const [resultado] = await connection.execute(
        `DELETE li FROM lista_compra_ingrediente li
         INNER JOIN lista_compra l ON l.id_lista = li.id_lista
         WHERE l.id_usuario = ? AND l.id_lista = ? AND l.estado = 'activa' AND li.comprado = FALSE`,
        [idUsuario, lista.id_lista]
    );
    return resultado.affectedRows;
});

const marcarCompradoYTransferir = (idUsuario, idIngrediente) => conTransaccion(async connection => {
    const lista = await obtenerListaActivaTransaccional(connection, idUsuario, false);
    if (!lista) return { encontrado: false };

    const [items] = await connection.execute(
        `SELECT li.id_ingrediente, li.cantidad, li.id_unidad, li.comprado, i.nombre,
                i.familia_unidad, i.estado, i.activo
         FROM lista_compra_ingrediente li
         INNER JOIN ingrediente i ON i.id_ingrediente = li.id_ingrediente
         WHERE li.id_lista = ? AND li.id_ingrediente = ? FOR UPDATE`,
        [lista.id_lista, idIngrediente]
    );
    if (!items.length) return { encontrado: false };
    const item = items[0];
    if (validadorProductos.evaluar(item.nombre).tipo === 'sustancia_no_apta') throw crearError('INGREDIENT_NOT_ALLOWED', 'El producto no es un ingrediente culinario permitido.');
    if (item.estado === 'rechazado') throw crearError('INGREDIENT_REJECTED', 'Este ingrediente fue rechazado.');
    if (!['validado', 'pendiente'].includes(item.estado) || !Boolean(item.activo)) throw crearError('INGREDIENT_INACTIVE', 'Este ingrediente no está habilitado para la despensa.');
    const yaComprado = Boolean(item.comprado);
    if (yaComprado) {
        return { encontrado: true, yaProcesado: true };
    }
    if (item.cantidad === null || item.id_unidad === null) {
        throw crearError('PURCHASE_DATA_REQUIRED', 'Indica una cantidad y una unidad antes de transferir este elemento a la despensa.');
    }

    const [unidadesCompra] = await connection.execute(
        'SELECT id_unidad, familia, factor_a_base FROM unidad_medida WHERE id_unidad = ?',
        [item.id_unidad]
    );
    if (!unidadesCompra.length || unidadesCompra[0].familia !== item.familia_unidad) {
        throw crearError('UNIT_INCOMPATIBLE', 'La unidad de la compra ya no es compatible con el ingrediente.');
    }

    await despensaModel.agregarCantidadTransaccional(connection, {
        idUsuario,
        idIngrediente,
        cantidad: item.cantidad,
        idUnidad: item.id_unidad,
        familiaIngrediente: item.familia_unidad
    });

    const [actualizacion] = await connection.execute(
        `UPDATE lista_compra_ingrediente
         SET comprado = TRUE, fecha_compra = CURRENT_TIMESTAMP
         WHERE id_lista = ? AND id_ingrediente = ? AND comprado = FALSE`,
        [lista.id_lista, idIngrediente]
    );
    if (actualizacion.affectedRows !== 1) throw crearError('PURCHASE_CONFLICT', 'El estado de compra cambió durante la operación.');
    return { encontrado: true, yaProcesado: false };
});

const transferirIngredienteLocalComprado = (idUsuario, { nombre, cantidad, idUnidad, idTipoAlimento }) => conTransaccion(async connection => {
    const lista = await obtenerListaActivaTransaccional(connection, idUsuario, true);

    const [unidades] = await connection.execute(
        'SELECT id_unidad, familia FROM unidad_medida WHERE id_unidad = ? FOR UPDATE',
        [idUnidad]
    );
    if (!unidades.length) throw crearError('UNIT_NOT_FOUND', 'La unidad indicada no existe.');

    const ingrediente = await ingredienteModel.buscarOCrearManualTransaccional(connection, {
        nombre,
        familia: unidades[0].familia,
        idTipoAlimento, permitirPendienteIA: true
    });
    const [itemsExistentes] = await connection.execute(
        `SELECT comprado
         FROM lista_compra_ingrediente
         WHERE id_lista = ? AND id_ingrediente = ? FOR UPDATE`,
        [lista.id_lista, ingrediente.id_ingrediente]
    );
    const yaComprado = itemsExistentes.length && Boolean(itemsExistentes[0].comprado);
    if (yaComprado) return { ingrediente, yaProcesado: true, cantidad, idUnidad, familia: unidades[0].familia };
    if (itemsExistentes.length && !yaComprado) {
        await connection.execute(
            `UPDATE lista_compra_ingrediente
             SET cantidad = ?, id_unidad = ?
             WHERE id_lista = ? AND id_ingrediente = ?`,
            [cantidad, idUnidad, lista.id_lista, ingrediente.id_ingrediente]
        );
    } else if (!itemsExistentes.length) {
        await connection.execute(
            `INSERT INTO lista_compra_ingrediente
                (id_lista, id_ingrediente, cantidad, id_unidad, comprado, fecha_compra)
             VALUES (?, ?, ?, ?, FALSE, NULL)`,
            [lista.id_lista, ingrediente.id_ingrediente, cantidad, idUnidad]
        );
    }

    await despensaModel.agregarCantidadTransaccional(connection, {
        idUsuario,
        idIngrediente: ingrediente.id_ingrediente,
        cantidad,
        idUnidad,
        familiaIngrediente: ingrediente.familia_unidad
    });

    const [actualizacion] = await connection.execute(
        `UPDATE lista_compra_ingrediente
         SET comprado = TRUE, fecha_compra = CURRENT_TIMESTAMP
         WHERE id_lista = ? AND id_ingrediente = ? AND comprado = FALSE`,
        [lista.id_lista, ingrediente.id_ingrediente]
    );
    if (actualizacion.affectedRows !== 1) {
        throw crearError('PURCHASE_CONFLICT', 'El estado de compra cambió durante la operación.');
    }

    return { ingrediente, yaProcesado: false, cantidad, idUnidad, familia: unidades[0].familia };
});

const resolverNombreCompra = async nombre => {
    const exacto = await ingredienteModel.buscarManualPorNombre(db, nombre);
    if (exacto) return exacto.nombre;
    // Equivalencias explícitas, sin recortar plurales de alimentos distintos.
    const grupos = [['papa', 'papas'], ['tomate', 'tomates'], ['cebolla', 'cebollas'], ['huevo', 'huevos']];
    const clave = nombre.toLocaleLowerCase('es-CL');
    const grupo = grupos.find(valores => valores.includes(clave));
    if (!grupo) return nombre;
    for (const variante of grupo) {
        const existente = await ingredienteModel.buscarManualPorNombre(db, variante);
        if (existente) return existente.nombre;
    }
    return grupo[0];
};
const buscarIngredienteCompra = nombre => ingredienteModel.buscarManualPorNombre(db, nombre);

const calcularFaltantesReceta = async (connection, idUsuario, { idReceta, usarDespensa, ingredientesManuales }) => {
    const [recetas] = await connection.execute(`SELECT id_receta FROM receta r WHERE r.id_receta = ?
        AND ((r.id_usuario = ? AND r.estado NOT IN ('rechazada','archivada'))
        OR (r.visibilidad = 'publica' AND r.estado IN ('validada','publicada')))`, [idReceta, idUsuario]);
    if (!recetas.length) throw crearError('RECIPE_NOT_FOUND', 'La receta no existe o no está disponible para tu cuenta.');
    const [ingredientes] = await connection.execute(`SELECT ri.id_ingrediente, i.nombre AS ingrediente,
        i.familia_unidad AS familia_ingrediente, i.estado AS estado_ingrediente, i.activo,
        ri.cantidad, ri.id_unidad, ri.indicacion, u.nombre AS unidad, u.abreviatura, u.familia, u.factor_a_base
        FROM receta_ingrediente ri JOIN ingrediente i ON i.id_ingrediente = ri.id_ingrediente
        LEFT JOIN unidad_medida u ON u.id_unidad = ri.id_unidad WHERE ri.id_receta = ?`, [idReceta]);
    const manuales = new Set();
    for (const nombre of ingredientesManuales) {
        const ingrediente = await ingredienteModel.buscarManualPorNombre(connection, nombre);
        if (ingrediente) manuales.add(ingrediente.id_ingrediente);
    }
    const [existencias] = usarDespensa ? await connection.execute(`SELECT d.id_ingrediente,d.cantidad,u.familia,u.factor_a_base
        FROM despensa d JOIN ingrediente i ON i.id_ingrediente=d.id_ingrediente
        JOIN unidad_medida u ON u.id_unidad=d.id_unidad
        WHERE d.id_usuario=? AND i.activo=TRUE AND i.estado IN ('validado','pendiente')`, [idUsuario]) : [[]];
    const disponibles = new Map(existencias.map(item => [item.id_ingrediente, item]));
    return ingredientes.map(item => calcularFaltante(item, disponibles.get(item.id_ingrediente), manuales.has(item.id_ingrediente))).filter(Boolean);
};
const obtenerFaltantesReceta = (idUsuario, datos) => calcularFaltantesReceta(db, idUsuario, datos);
const agregarFaltantesReceta = (idUsuario, datos) => conTransaccion(async connection => {
    const lista = await obtenerListaActivaTransaccional(connection, idUsuario, true);
    const faltantes = await calcularFaltantesReceta(connection, idUsuario, datos);
    let agregados = 0;
    let duplicados = 0;
    let reactivados = 0;
    for (const item of faltantes) {
        const resultado = await guardarEnLista(connection, lista, { idIngrediente: item.id_ingrediente,
            cantidad: item.cantidad, idUnidad: item.id_unidad, conservarExistente: true, reabrir: true });
        if (resultado.creado) agregados++; else duplicados++;
        if (resultado.reactivado) reactivados++;
    }
    return { id_lista: lista.id_lista, agregados, insertados: agregados - reactivados, reactivados, duplicados, faltantes };
});

module.exports = {
    obtenerListaActiva,
    resolverNombreCompra,
    buscarIngredienteCompra,
    agregarIngredientePorNombre,
    obtenerFaltantesReceta,
    agregarFaltantesReceta,
    obtenerOPrepararListaActiva,
    obtenerElementos,
    obtenerUnidades,
    agregarIngredienteCatalogo,
    agregarIngredientePersonalizado,
    actualizarIngredienteCatalogo,
    eliminarIngrediente,
    vaciarElementos,
    marcarCompradoYTransferir,
    transferirIngredienteLocalComprado
};

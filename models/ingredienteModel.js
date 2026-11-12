// Contiene las consultas MySQL relacionadas con los ingredientes.
const db = require('../config/db');

// Pide todos los ingredientes y los ordena por nombre.
const obtenerTodos = async () => {
    const [filas] = await db.query(`
        SELECT id_ingrediente, nombre
        FROM ingrediente
        WHERE estado = 'validado' AND activo = TRUE
        ORDER BY nombre ASC
    `);
    return filas;
};

const normalizarNombre = valor => String(valor || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-CL');

const normalizarClave = valor => normalizarNombre(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const pluralesConocidos = new Map([
    ['papa', 'papa'], ['papas', 'papa'],
    ['tomate', 'tomate'], ['tomates', 'tomate'],
    ['cebolla', 'cebolla'], ['cebollas', 'cebolla'],
    ['zanahoria', 'zanahoria'], ['zanahorias', 'zanahoria'],
    ['huevo', 'huevo'], ['huevos', 'huevo']
]);

const crearError = (code, message, appCode = null) => Object.assign(
    new Error(message),
    { code, ...(appCode ? { appCode } : {}) }
);

const obtenerTiposAlimento = async () => {
    const [filas] = await db.query(
        'SELECT id_tipo_alimento, nombre FROM tipo_alimento ORDER BY nombre ASC'
    );
    return filas;
};

const obtenerCatalogoSeguridad = async () => {
    const [filas] = await db.query(`
        SELECT i.id_ingrediente, i.nombre, i.estado, i.activo, ia.alias
        FROM ingrediente i
        LEFT JOIN ingrediente_alias ia ON ia.id_ingrediente = i.id_ingrediente
    `);
    return filas;
};

const obtenerClasificacionIngrediente = async nombre => {
    const [filas] = await db.execute(`
        SELECT DISTINCT i.id_ingrediente, t.id_tipo_alimento, t.nombre
        FROM ingrediente i
        INNER JOIN tipo_alimento t ON t.id_tipo_alimento = i.id_tipo_alimento
        WHERE i.activo = TRUE AND i.estado IN ('validado', 'pendiente')
          AND (REGEXP_REPLACE(LOWER(TRIM(i.nombre)), '[[:space:]]+', ' ') = ?
               OR EXISTS (
                   SELECT 1 FROM ingrediente_alias ia WHERE ia.id_ingrediente = i.id_ingrediente
                   AND REGEXP_REPLACE(LOWER(TRIM(ia.alias)), '[[:space:]]+', ' ') = ?
               ))
    `, [normalizarNombre(nombre), normalizarNombre(nombre)]);
    if (filas.length > 1) {
        throw Object.assign(crearError('INGREDIENT_NAME_AMBIGUOUS', 'El ingrediente coincide con varias entradas del catálogo.', 'INGREDIENT_CLASSIFICATION_FAILED'), { ingrediente: nombre });
    }
    return filas[0] || null;
};

// Solo equivalencias explícitas; nunca deduce categorías por similitud.
const variantesTipoAlimento = [
    ['aceite', 'aceites'], ['bebida', 'bebidas'], ['carne', 'carnes'],
    ['cereal', 'cereales'], ['condimento', 'condimentos'], ['fruta', 'frutas'],
    ['fruto seco', 'frutos secos'], ['huevo', 'huevos'], ['lacteo', 'lacteos'],
    ['legumbre', 'legumbres'], ['pescado', 'pescados'], ['verdura', 'verduras']
];

const resolverTipoAlimento = (tipos, valor) => {
    const clave = normalizarClave(valor);
    const exactos = tipos.filter(tipo => normalizarClave(tipo.nombre) === clave);
    if (exactos.length) return exactos.length === 1 ? exactos[0] : null;
    const variantes = variantesTipoAlimento.find(grupo => grupo.includes(clave));
    if (!variantes) return null;
    const coincidencias = tipos.filter(tipo => variantes.includes(normalizarClave(tipo.nombre)));
    return coincidencias.length === 1 ? coincidencias[0] : null;
};

const obtenerReferenciasMedida = async () => {
    const [ingredientes] = await db.query(`
        SELECT i.nombre, i.familia_unidad, GROUP_CONCAT(ia.alias SEPARATOR '|') AS alias
        FROM ingrediente i
        LEFT JOIN ingrediente_alias ia ON ia.id_ingrediente = i.id_ingrediente
        WHERE i.activo = TRUE AND i.estado <> 'rechazado'
        GROUP BY i.id_ingrediente, i.nombre, i.familia_unidad
    `);
    const [unidades] = await db.query('SELECT nombre, abreviatura, familia FROM unidad_medida');
    return { ingredientes, unidades };
};

const resolverOCrearIATransaccional = async (connection, { nombre, familia, tipoAlimento, idTipoAlimento, conservarMedidaReceta = false }) => {
    const nombreVisible = String(nombre || '').trim().replace(/\s+/g, ' ');
    if (!nombreVisible || nombreVisible.length > 150 || /^(?:undefined|null)$/i.test(nombreVisible)) {
        throw crearError('INGREDIENT_NAME_INVALID', 'El ingrediente generado no tiene un nombre válido.', 'INGREDIENT_CLASSIFICATION_FAILED');
    }

    const tipoNormalizado = normalizarNombre(tipoAlimento);
    const tieneIdTipo = idTipoAlimento !== undefined && idTipoAlimento !== null;
    if (tieneIdTipo && (!Number.isSafeInteger(idTipoAlimento) || idTipoAlimento <= 0)) {
        throw crearError('INGREDIENT_TYPE_INVALID', 'El identificador del tipo de alimento no es válido.', 'INGREDIENT_CLASSIFICATION_FAILED');
    }
    if (!tieneIdTipo && !tipoNormalizado) {
        throw crearError('INGREDIENT_TYPE_REQUIRED', 'Falta la clasificación de alimento del ingrediente.', 'INGREDIENT_CLASSIFICATION_FAILED');
    }
    const [tipos] = await connection.execute(
        `SELECT id_tipo_alimento, nombre
         FROM tipo_alimento
         ${tieneIdTipo ? 'WHERE id_tipo_alimento = ?' : ''}
         FOR UPDATE`,
        tieneIdTipo ? [idTipoAlimento] : []
    );
    const tipoResuelto = tieneIdTipo
        ? (tipos.length === 1 ? tipos[0] : null)
        : resolverTipoAlimento(tipos, tipoAlimento);
    if (!tipoResuelto) {
        throw crearError('INGREDIENT_TYPE_NOT_FOUND', 'La clasificación generada no existe en el catálogo de tipos de alimento.', 'INGREDIENT_CLASSIFICATION_FAILED');
    }
    tipos.splice(0, tipos.length, tipoResuelto);

    const nombreClave = normalizarClave(nombreVisible);
    const nombreCanonicoClave = pluralesConocidos.get(nombreClave) || nombreClave;
    const nombreCanonico = nombreCanonicoClave === nombreClave
        ? nombreVisible
        : `${nombreCanonicoClave.charAt(0).toLocaleUpperCase('es-CL')}${nombreCanonicoClave.slice(1)}`;
    const nombresBusqueda = [...new Set([
        normalizarNombre(nombreVisible),
        normalizarNombre(nombreCanonico),
        ...[...pluralesConocidos.entries()]
            .filter(([, canonico]) => canonico === nombreClave || canonico === normalizarClave(nombreCanonico))
            .map(([variante]) => variante)
    ])];
    const buscarCoincidencias = async nombres => {
        const marcadores = nombres.map(() => '?').join(', ');
        const [filas] = await connection.execute(
            `SELECT i.id_ingrediente, i.nombre, i.id_tipo_alimento,
                    t.nombre AS tipo_alimento, i.familia_unidad,
                    i.estado, i.activo
             FROM ingrediente i
             LEFT JOIN tipo_alimento t ON t.id_tipo_alimento = i.id_tipo_alimento
             WHERE REGEXP_REPLACE(LOWER(TRIM(i.nombre)), '[[:space:]]+', ' ') IN (${marcadores})
                OR EXISTS (
                    SELECT 1
                    FROM ingrediente_alias ia
                    WHERE ia.id_ingrediente = i.id_ingrediente
                      AND REGEXP_REPLACE(LOWER(TRIM(ia.alias)), '[[:space:]]+', ' ') IN (${marcadores})
                )
             FOR UPDATE`,
            [...nombres, ...nombres]
        );
        return [...new Map(filas.map(fila => [fila.id_ingrediente, fila])).values()];
    };

    const verificarFamilia = ingrediente => {
        // La indicación cualitativa no cambia ni requiere convertir su ficha.
        if (conservarMedidaReceta && familia == null) return ingrediente;
        if (ingrediente.familia_unidad !== familia) {
            // Una receta conserva su propia medida de peso, volumen o conteo.
            // Esta excepción no habilita conversiones ni cambia la ficha del catálogo.
            const medidaExplicita = conservarMedidaReceta &&
                ['peso', 'volumen', 'unidad'].includes(familia) &&
                ['peso', 'volumen', 'unidad'].includes(ingrediente.familia_unidad);
            if (!medidaExplicita) {
                throw Object.assign(crearError('INGREDIENT_FAMILY_CONFLICT', 'El ingrediente existente tiene una familia de medida diferente.', 'INGREDIENT_CLASSIFICATION_FAILED'), {
                    familiaRecibida: familia,
                    familiaCatalogo: ingrediente.familia_unidad
                });
            }
        }
        return ingrediente;
    };

    const completarTipo = async ingrediente => {
        verificarFamilia(ingrediente);
        if (ingrediente.id_tipo_alimento === null) {
            await connection.execute(
                `UPDATE ingrediente
                 SET id_tipo_alimento = ?
                 WHERE id_ingrediente = ? AND id_tipo_alimento IS NULL`,
                [tipos[0].id_tipo_alimento, ingrediente.id_ingrediente]
            );
            ingrediente.id_tipo_alimento = tipos[0].id_tipo_alimento;
            ingrediente.tipo_alimento = tipos[0].nombre;
        }
        return ingrediente;
    };

    const nombreExacto = normalizarNombre(nombreVisible);
    let coincidencias = await buscarCoincidencias([nombreExacto]);
    if (!coincidencias.length && nombresBusqueda.length > 1) {
        coincidencias = await buscarCoincidencias(nombresBusqueda);
    }
    if (coincidencias.length > 1) {
        throw crearError('INGREDIENT_NAME_AMBIGUOUS', 'El nombre coincide con más de un ingrediente del catálogo.', 'INGREDIENT_CLASSIFICATION_FAILED');
    }
    if (coincidencias.length === 1) {
        return completarTipo(coincidencias[0]);
    }

    if (!['peso', 'volumen', 'unidad'].includes(familia)) {
        throw crearError('INGREDIENT_MEASURE_REQUIRED', 'El ingrediente nuevo requiere una familia de medida verificable; no se asignó una por defecto.', 'INGREDIENT_CLASSIFICATION_FAILED');
    }

    try {
        await connection.execute(
            `INSERT INTO ingrediente
                (nombre, id_tipo_alimento, familia_unidad, creado_por_ia, estado, activo)
             VALUES (?, ?, ?, TRUE, 'pendiente', TRUE)
             ON DUPLICATE KEY UPDATE id_ingrediente = LAST_INSERT_ID(id_ingrediente)`,
            [nombreCanonico, tipos[0].id_tipo_alimento, familia]
        );
        coincidencias = await buscarCoincidencias([normalizarNombre(nombreCanonico)]);
        if (!coincidencias.length && nombresBusqueda.length > 1) {
            coincidencias = await buscarCoincidencias(nombresBusqueda);
        }
        if (coincidencias.length !== 1) {
            throw crearError('INGREDIENT_NAME_AMBIGUOUS', 'No se pudo resolver una única entrada del catálogo.', 'INGREDIENT_CLASSIFICATION_FAILED');
        }
        return await completarTipo(coincidencias[0]);
    } catch (error) {
        if (error.appCode) throw error;
        error.appCode = 'INGREDIENT_CATALOG_INSERT_FAILED';
        throw error;
    }
};

const buscarManualPorNombre = async (connection, nombre, bloquear = false) => {
    const nombreNormalizado = normalizarNombre(nombre);
    const [filas] = await connection.execute(`
        SELECT i.id_ingrediente, i.nombre, i.id_tipo_alimento, i.familia_unidad,
               i.estado, i.activo, i.creado_por_ia
        FROM ingrediente i
        WHERE REGEXP_REPLACE(LOWER(TRIM(i.nombre)), '[[:space:]]+', ' ') = ?
           OR EXISTS (
               SELECT 1 FROM ingrediente_alias ia
               WHERE ia.id_ingrediente = i.id_ingrediente
                 AND REGEXP_REPLACE(LOWER(TRIM(ia.alias)), '[[:space:]]+', ' ') = ?
           )
        ${bloquear ? 'FOR UPDATE' : ''}
    `, [nombreNormalizado, nombreNormalizado]);
    const unicos = [...new Map(filas.map(item => [item.id_ingrediente, item])).values()];
    if (unicos.length > 1) throw crearError('INGREDIENT_AMBIGUOUS', 'El nombre coincide con más de un ingrediente del catálogo.');
    return unicos[0] || null;
};

const buscarOCrearManualTransaccional = async (connection, { nombre, familia, idTipoAlimento, permitirPendienteIA = false }) => {
    const buscarCoincidencias = async () => {
        const ingrediente = await buscarManualPorNombre(connection, nombre, true);
        return ingrediente ? [ingrediente] : [];
    };

    const validarExistente = async ingrediente => {
        if (ingrediente.estado === 'pendiente' && Boolean(ingrediente.creado_por_ia) && !permitirPendienteIA) {
            throw crearError('INGREDIENT_PENDING', 'El ingrediente ya existe y está pendiente de validación.');
        }
        if (ingrediente.estado === 'rechazado') {
            throw crearError('INGREDIENT_REJECTED', 'El ingrediente ya existe y fue rechazado.');
        }
        if (!['validado', 'pendiente'].includes(ingrediente.estado) || !Boolean(ingrediente.activo)) {
            throw crearError('INGREDIENT_INACTIVE', 'El ingrediente existe, pero no está habilitado para la despensa.');
        }
        if (ingrediente.familia_unidad !== familia) {
            throw crearError('UNIT_INCOMPATIBLE', 'El ingrediente existente no admite la familia de unidad seleccionada.');
        }
        if (ingrediente.id_tipo_alimento === null) {
            await comprobarTipo();
            await connection.execute(
                'UPDATE ingrediente SET id_tipo_alimento = ? WHERE id_ingrediente = ? AND id_tipo_alimento IS NULL',
                [idTipoAlimento, ingrediente.id_ingrediente]
            );
            ingrediente.id_tipo_alimento = idTipoAlimento;
        }
        return { ...ingrediente, creado: false };
    };

    const comprobarTipo = async () => {
        if (!Number.isSafeInteger(idTipoAlimento) || idTipoAlimento <= 0) {
            throw crearError('INGREDIENT_CLASSIFICATION_FAILED', 'No se pudo clasificar el ingrediente.');
        }
        const [tipos] = await connection.execute(
            'SELECT id_tipo_alimento FROM tipo_alimento WHERE id_tipo_alimento = ? FOR UPDATE', [idTipoAlimento]
        );
        if (tipos.length !== 1) throw crearError('INGREDIENT_CLASSIFICATION_FAILED', 'La categoría no existe en el catálogo.');
    };

    let coincidencias = await buscarCoincidencias();
    const ingredientesUnicos = [...new Map(coincidencias.map(item => [item.id_ingrediente, item])).values()];
    if (ingredientesUnicos.length > 1) {
        throw crearError('INGREDIENT_AMBIGUOUS', 'El nombre coincide con más de un ingrediente del catálogo.');
    }
    if (ingredientesUnicos.length === 1) return validarExistente(ingredientesUnicos[0]);

    const nombreVisible = String(nombre).trim().replace(/\s+/g, ' ');
    await comprobarTipo();
    try {
        const [resultado] = await connection.execute(
            `INSERT INTO ingrediente (nombre, id_tipo_alimento, familia_unidad, creado_por_ia, estado, activo)
             VALUES (?, ?, ?, FALSE, 'pendiente', TRUE)`,
            [nombreVisible, idTipoAlimento, familia]
        );
        return {
            id_ingrediente: resultado.insertId,
            nombre: nombreVisible,
            id_tipo_alimento: idTipoAlimento,
            familia_unidad: familia,
            estado: 'pendiente',
            activo: true,
            creado: true
        };
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        coincidencias = await buscarCoincidencias();
        const despuesDelConflicto = [...new Map(coincidencias.map(item => [item.id_ingrediente, item])).values()];
        if (despuesDelConflicto.length === 1) return validarExistente(despuesDelConflicto[0]);
        throw crearError('INGREDIENT_NAME_CONFLICT', 'El nombre entró en conflicto con otro registro del catálogo. Revisa el nombre antes de volver a intentar.');
    }
};

module.exports = { 
    obtenerTodos,
    buscarManualPorNombre,
    buscarOCrearManualTransaccional,
    obtenerTiposAlimento,
    obtenerCatalogoSeguridad,
    obtenerClasificacionIngrediente,
    obtenerReferenciasMedida,
    resolverTipoAlimento,
    resolverOCrearIATransaccional

};

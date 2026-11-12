const despensaModel = require('../models/despensaModel');
const ingredienteModel = require('../models/ingredienteModel');

const UNIDADES_EQUIVALENTES = {
    g: ['g', 'gr', 'gramo', 'gramos'],
    kg: ['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'],
    ml: ['ml', 'mililitro', 'mililitros', 'cc'],
    l: ['l', 'lt', 'litro', 'litros'],
    un: ['un', 'unidad', 'unidades'],
    taza: ['taza', 'tazas'],
    cda: ['cda', 'cucharada', 'cucharadas'],
    cdta: ['cdta', 'cucharadita', 'cucharaditas']
};

const tokenUnidad = valor => String(valor || '').trim().toLocaleLowerCase('es-CL');
const normalizarTextoCatalogo = valor => tokenUnidad(valor).replace(/\s+/g, ' ');

const obtenerIdUsuario = req => {
    const valor = req.session?.usuario?.id_usuario;
    const idUsuario = Number(valor);
    return Number.isSafeInteger(idUsuario) && idUsuario > 0 ? idUsuario : null;
};

const buscarUnidadEquivalente = token => {
    const normalizado = tokenUnidad(token);
    return Object.entries(UNIDADES_EQUIVALENTES)
        .find(([, variantes]) => variantes.includes(normalizado))?.[0] || null;
};

const leerCantidad = texto => {
    const cantidad = Number(String(texto).replace(',', '.'));
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 9999999.999) return null;
    const decimales = String(texto).split(/[.,]/)[1] || '';
    if (decimales.length > 3) return null;
    return cantidad;
};

const interpretarEntrada = texto => {
    if (typeof texto !== 'string' || !texto.trim()) return null;
    const entrada = texto.trim().replace(/\s+/g, ' ');
    const numero = '(\\d+(?:[.,]\\d{1,3})?)';
    const palabra = '([\\p{L}]+)';

    // Admite «500g arroz» y «500 g arroz».
    let coincidencia = entrada.match(new RegExp(`^${numero}\\s*${palabra}\\s+(.+)$`, 'u'));
    if (coincidencia && buscarUnidadEquivalente(coincidencia[2])) {
        return {
            cantidadTexto: coincidencia[1],
            unidadToken: coincidencia[2],
            nombre: coincidencia[3]
        };
    }

    // Admite «arroz 500g» y «leche 1 litro».
    coincidencia = entrada.match(new RegExp(`^(.+?)\\s+${numero}\\s*${palabra}$`, 'u'));
    if (coincidencia && buscarUnidadEquivalente(coincidencia[3])) {
        return {
            nombre: coincidencia[1],
            cantidadTexto: coincidencia[2],
            unidadToken: coincidencia[3]
        };
    }

    // «6 huevos» expresa conteo solo si el catálogo confirma familia unidad.
    coincidencia = entrada.match(new RegExp(`^${numero}\\s+(.+)$`, 'u'));
    if (coincidencia) {
        return {
            cantidadTexto: coincidencia[1],
            nombre: coincidencia[2],
            unidadImplicitaConteo: true
        };
    }

    return null;
};

const variantesNombre = nombre => {
    const normalizado = normalizarTextoCatalogo(nombre);
    const variantes = [normalizado];
    // Cubre plurales simples («huevos» → «huevo») sin crear entradas de catálogo.
    if (normalizado.endsWith('s') && normalizado.length > 3) {
        variantes.push(normalizado.slice(0, -1));
    }
    return [...new Set(variantes)];
};

const responderError = (res, status, mensaje) => res.status(status).json({ ok: false, mensaje });

const obtenerDespensa = async (req, res) => {
    const idUsuario = obtenerIdUsuario(req);
    if (!idUsuario) return responderError(res, 401, 'Debes iniciar sesión.');

    try {
        const ingredientes = await despensaModel.obtenerPorUsuario(idUsuario);
        return res.json({ ok: true, ingredientes });
    } catch (error) {
        console.error('Error al consultar la despensa:', error);
        return responderError(res, 500, 'No se pudo consultar la despensa.');
    }
};

const agregarIngrediente = async (req, res) => {
    const idUsuario = obtenerIdUsuario(req);
    if (!idUsuario) return responderError(res, 401, 'Debes iniciar sesión.');

    if (typeof req.body?.nombre === 'string') {
        const nombre = req.body.nombre.trim().replace(/\s+/g, ' ');
        const cantidadTexto = String(req.body?.cantidad ?? '').trim().replace(',', '.');
        const idUnidad = Number(req.body?.id_unidad);
        const cantidad = leerCantidad(cantidadTexto);
        if (nombre.length < 2 || nombre.length > 150 || !/\p{L}/u.test(nombre)) {
            return responderError(res, 400, 'Escribe un nombre de ingrediente válido, de 2 a 150 caracteres.');
        }
        if (!/^\d+(?:\.\d{1,3})?$/.test(cantidadTexto) || cantidad === null) {
            return responderError(res, 400, 'La cantidad debe ser positiva y tener como máximo tres decimales.');
        }
        if (!Number.isSafeInteger(idUnidad) || idUnidad <= 0) {
            return responderError(res, 400, 'Selecciona una unidad de medida válida.');
        }

        try {
            // Lecturas y OpenAI antes de abrir la transacción de la despensa.
            const existente = await despensaModel.prepararIngredienteManual({ nombre, idUnidad });
            let idTipoAlimento = existente?.id_tipo_alimento;
            if (idTipoAlimento === null || idTipoAlimento === undefined) {
                const tiposAlimento = await ingredienteModel.obtenerTiposAlimento();
                if (!tiposAlimento.length) {
                    return responderError(res, 503, 'No hay categorías disponibles para clasificar el ingrediente.');
                }
                const { clasificarIngredienteConOpenAI } = require('../services/openaiService');
                let tipo;
                try {
                    tipo = await clasificarIngredienteConOpenAI({
                        nombre: existente?.nombre || nombre, tiposAlimento
                    });
                } catch (error) {
                    console.error('[Despensa clasificación] No se pudo clasificar:', {
                        ingrediente: nombre, code: error.code || 'CLASSIFICATION_FAILED',
                        httpStatus: error.status || null
                    });
                    const categoriaDesconocida = error.code === 'INGREDIENT_TYPE_NOT_FOUND';
                    return responderError(res, categoriaDesconocida ? 422 : 502, categoriaDesconocida
                        ? 'No se pudo determinar una categoría válida. Revisa el nombre e inténtalo nuevamente. No se guardaron cambios.'
                        : 'No se pudo consultar el servicio de clasificación. Inténtalo nuevamente. No se guardaron cambios.');
                }
                idTipoAlimento = tipo.id_tipo_alimento;
            }
            const resultado = await despensaModel.agregarIngredienteManual({
                idUsuario,
                nombre,
                cantidad: cantidadTexto,
                idUnidad,
                idTipoAlimento
            });
            return res.status(resultado.ingrediente.creado ? 201 : 200).json({
                ok: true,
                mensaje: resultado.ingrediente.creado
                    ? 'Ingrediente guardado en tu despensa, con clasificación pendiente de validación.'
                    : 'Ingrediente guardado en la despensa.',
                ingrediente: {
                    id_ingrediente: resultado.ingrediente.id_ingrediente,
                    ingrediente: resultado.ingrediente.nombre,
                    cantidad: resultado.cantidad,
                    id_unidad: resultado.unidad.id_unidad,
                    unidad: resultado.unidad.nombre,
                    abreviatura: resultado.unidad.abreviatura,
                    familia: resultado.unidad.familia
                }
            });
        } catch (error) {
            const errores = {
                INGREDIENT_REJECTED: [409, 'El ingrediente existe en el catálogo, pero fue rechazado y no puede agregarse a la despensa.'],
                INGREDIENT_INACTIVE: [409, 'El ingrediente existe en el catálogo, pero está inactivo y no puede agregarse a la despensa.'],
                INGREDIENT_AMBIGUOUS: [409, 'El nombre coincide con más de un ingrediente. Especifica un nombre más preciso.'],
                INGREDIENT_NAME_CONFLICT: [409, 'El nombre coincide con otro registro del catálogo. Revisa el nombre antes de intentar nuevamente.'],
                INGREDIENT_CLASSIFICATION_FAILED: [422, 'No se pudo verificar la categoría del ingrediente. No se guardaron cambios.'],
                UNIT_NOT_FOUND: [400, 'La unidad indicada no existe.'],
                UNIT_INCOMPATIBLE: [400, 'La unidad no es compatible con el ingrediente.'],
                PANTRY_UNIT_INCOMPATIBLE: [409, 'La unidad que ya está guardada no es compatible con la seleccionada. No se cambiaron los datos de la despensa.']
            };
            const [status, mensajeError] = errores[error.code] || [500, 'No se pudo guardar el ingrediente.'];
            if (status === 500) console.error('Error al guardar ingrediente en la despensa:', error);
            return responderError(res, status, mensajeError);
        }
    }

    const entrada = interpretarEntrada(req.body?.texto);
    if (!entrada) {
        return responderError(res, 400, 'Escribe ingrediente, cantidad y unidad; por ejemplo, «arroz 500g».');
    }

    const cantidad = leerCantidad(entrada.cantidadTexto);
    if (cantidad === null) {
        return responderError(res, 400, 'La cantidad debe ser positiva y tener como máximo tres decimales.');
    }

    try {
        const ingredientes = await despensaModel.buscarIngredientesCatalogo(variantesNombre(entrada.nombre));
        const ingredientesUnicos = [...new Map(ingredientes.map(item => [item.id_ingrediente, item])).values()];
        if (ingredientesUnicos.length !== 1) {
            return responderError(res, 400, ingredientesUnicos.length
                ? 'El ingrediente coincide con más de una entrada del catálogo.'
                : 'No se encontró un ingrediente con ese nombre.');
        }
        const ingrediente = ingredientesUnicos[0];

        if (!['validado', 'pendiente'].includes(ingrediente.estado)) {
            const mensaje = ingrediente.estado === 'rechazado'
                ? 'Este ingrediente fue rechazado y no se puede agregar a la despensa.'
                : 'Este ingrediente no está habilitado para la despensa.';
            return responderError(res, 409, mensaje);
        }
        if (!Boolean(ingrediente.activo)) {
            return responderError(res, 409, 'Este ingrediente está inactivo y no se puede agregar a la despensa.');
        }

        let unidades;
        if (entrada.unidadImplicitaConteo) {
            if (ingrediente.familia_unidad !== 'unidad') {
                return responderError(res, 400, 'Indica una unidad compatible con ese ingrediente.');
            }
            unidades = await despensaModel.obtenerUnidadesPorFamilia('unidad');
            if (unidades.length !== 1) {
                return responderError(res, 400, 'Indica la unidad explícitamente para evitar ambigüedades.');
            }
        } else {
            const abreviatura = buscarUnidadEquivalente(entrada.unidadToken);
            if (!abreviatura) return responderError(res, 400, 'La unidad indicada no es reconocida.');
            const variantes = UNIDADES_EQUIVALENTES[abreviatura];
            unidades = await despensaModel.buscarUnidades(variantes);
        }

        const unidadesUnicas = [...new Map(unidades.map(item => [item.id_unidad, item])).values()];
        if (unidadesUnicas.length !== 1) {
            return responderError(res, 400, 'La unidad no existe o no se puede resolver de manera inequívoca.');
        }
        const unidad = unidadesUnicas[0];
        if (unidad.familia !== ingrediente.familia_unidad) {
            return responderError(res, 400, 'La unidad no es compatible con la familia de medida del ingrediente.');
        }

        await despensaModel.guardarIngrediente({
            idUsuario,
            idIngrediente: ingrediente.id_ingrediente,
            cantidad,
            idUnidad: unidad.id_unidad
        });

        return res.status(200).json({
            ok: true,
            mensaje: 'Ingrediente guardado en la despensa.',
            ingrediente: {
                id_ingrediente: ingrediente.id_ingrediente,
                nombre: ingrediente.nombre,
                cantidad,
                id_unidad: unidad.id_unidad,
                unidad: unidad.nombre,
                abreviatura: unidad.abreviatura,
                familia: unidad.familia
            }
        });
    } catch (error) {
        console.error('Error al guardar ingrediente en la despensa:', error);
        return responderError(res, 500, 'No se pudo guardar el ingrediente.');
    }
};

const eliminarIngrediente = async (req, res) => {
    const idUsuario = obtenerIdUsuario(req);
    if (!idUsuario) return responderError(res, 401, 'Debes iniciar sesión.');

    const idIngrediente = /^\d+$/.test(req.params.id_ingrediente)
        ? Number(req.params.id_ingrediente)
        : NaN;
    if (!Number.isSafeInteger(idIngrediente) || idIngrediente <= 0) {
        return responderError(res, 400, 'El identificador del ingrediente no es válido.');
    }

    try {
        const filasAfectadas = await despensaModel.eliminarIngrediente(idUsuario, idIngrediente);
        if (!filasAfectadas) return responderError(res, 404, 'El ingrediente no está en tu despensa.');
        return res.json({ ok: true, mensaje: 'Ingrediente eliminado de la despensa.' });
    } catch (error) {
        console.error('Error al eliminar ingrediente de la despensa:', error);
        return responderError(res, 500, 'No se pudo eliminar el ingrediente.');
    }
};

const limpiarDespensa = async (req, res) => {
    const idUsuario = obtenerIdUsuario(req);
    if (!idUsuario) return responderError(res, 401, 'Debes iniciar sesión.');

    try {
        const filasAfectadas = await despensaModel.limpiarPorUsuario(idUsuario);
        return res.json({
            ok: true,
            mensaje: filasAfectadas
                ? 'Se vació tu despensa.'
                : 'Tu despensa ya estaba vacía.'
        });
    } catch (error) {
        console.error('Error al vaciar la despensa:', error);
        return responderError(res, 500, 'No se pudo vaciar la despensa.');
    }
};

module.exports = {
    obtenerDespensa,
    agregarIngrediente,
    eliminarIngrediente,
    limpiarDespensa
};

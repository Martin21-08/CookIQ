const listaCompraModel = require('../models/listaCompraModel');
const ingredienteModel = require('../models/ingredienteModel');
const despensaModel = require('../models/despensaModel');
const { crearValidador } = require('../services/seguridadAlimentariaService');
const { normalizarIngredienteCulinario } = require('../services/ingredientesCulinariosService');

// Las lecturas y la clasificación remota ocurren antes de abrir la transacción.
const prepararNombre = async (nombre, idUnidad) => {
    if (crearValidador({}).evaluar(nombre).tipo === 'sustancia_no_apta') {
        throw Object.assign(new Error('El producto no es un ingrediente culinario permitido.'), { code: 'INGREDIENT_NOT_ALLOWED' });
    }
    nombre = await listaCompraModel.resolverNombreCompra(nombre);
    if (crearValidador({}).evaluar(nombre).tipo === 'sustancia_no_apta') {
        throw Object.assign(new Error('El producto no es un ingrediente culinario permitido.'), { code: 'INGREDIENT_NOT_ALLOWED' });
    }
    const existente = await despensaModel.prepararIngredienteManual({ nombre, idUnidad });
    let idTipoAlimento = existente?.id_tipo_alimento;
    if (!idTipoAlimento) {
        const tiposAlimento = await ingredienteModel.obtenerTiposAlimento();
        const { clasificarIngredienteConOpenAI } = require('../services/openaiService');
        try {
            const tipo = await clasificarIngredienteConOpenAI({ nombre, tiposAlimento });
            idTipoAlimento = tipo.id_tipo_alimento;
        } catch (error) {
            console.error('[Lista clasificación]', { ingrediente: nombre, code: error.code || 'CLASSIFICATION_FAILED' });
            throw Object.assign(new Error('No se pudo clasificar el ingrediente.'), { code: 'INGREDIENT_CLASSIFICATION_FAILED' });
        }
    }
    return { nombre, idTipoAlimento };
};

const leerNombre = valor => {
    if (typeof valor !== 'string') return null;
    const ingredientes = normalizarIngredienteCulinario(valor);
    if (ingredientes.length !== 1) return null; // No repartir una cantidad de compra conjunta.
    const nombre = ingredientes[0].nombre;
    return nombre.length >= 2 && nombre.length <= 150 && /^[\p{L}\s.'’()/-]+$/u.test(nombre) ? nombre : null;
};

const responderErrorModelo = (res, error) => {
    const respuestas = {
        INGREDIENT_NOT_ALLOWED: [400, 'El producto no es un ingrediente culinario permitido.'],
        INGREDIENT_CLASSIFICATION_FAILED: [422, 'No se pudo clasificar el ingrediente. Revisa su nombre e intenta nuevamente. No se guardaron cambios.'],
        INGREDIENT_FAMILY_CONFLICT: [400, 'La unidad no coincide con la familia del ingrediente del catálogo. No se realizaron conversiones.'],
        PANTRY_UNIT_INCOMPATIBLE: [409, 'La unidad guardada en tu despensa no es compatible. No se transfirió la compra.'],
        RECIPE_NOT_FOUND: [404, 'La receta no existe o no está disponible para tu cuenta.'],
        USER_NOT_FOUND: [401, 'La cuenta de la sesión ya no existe.'],
        ACTIVE_LIST_CONFLICT: [409, 'Tu cuenta tiene más de una lista activa. Se requiere revisar esas listas antes de continuar.'],
        INVALID_DECIMAL: [400, 'La cantidad tiene un formato no válido. Usa un número con hasta tres decimales.'],
        EXISTING_QUANTITY_UNKNOWN: [409, 'La cantidad anterior no está definida. Usa el icono Guardar cantidad para indicarla antes de sumar otra compra. No se modificó el elemento.'],
        CUSTOM_SCHEMA_REQUIRED: [409, 'Los ingredientes personalizados requieren una migración de base de datos pendiente.'],
        INGREDIENT_NOT_FOUND: [400, 'El ingrediente no existe o no está activo y permitido en el catálogo.'],
        UNIT_NOT_FOUND: [400, 'La unidad indicada no existe.'],
        UNIT_INCOMPATIBLE: [400, 'La unidad no es compatible con el ingrediente.'],
        ITEM_ALREADY_BOUGHT: [409, 'No se puede editar un elemento ya marcado como comprado.'],
        PURCHASE_DATA_REQUIRED: [409, 'Indica una cantidad y una unidad antes de transferir este elemento a la despensa.'],
        CONVERSION_PRECISION: [409, 'La conversión requiere más de tres decimales y no se aplicó.'],
        QUANTITY_OUT_OF_RANGE: [400, 'La cantidad total supera el límite permitido.'],
        PURCHASE_CONFLICT: [409, 'El estado de compra cambió durante la operación. Inténtalo nuevamente.'],
        INGREDIENT_PENDING: [409, 'Este ingrediente ya existe y está pendiente de validación. No se cambió su estado.'],
        INGREDIENT_REJECTED: [409, 'Este ingrediente ya existe y fue rechazado. No se creó otro registro.'],
        INGREDIENT_INACTIVE: [409, 'Este ingrediente existe, pero no está habilitado para la despensa.'],
        INGREDIENT_AMBIGUOUS: [409, 'El nombre coincide con más de un ingrediente. Especifica un nombre más preciso.'],
        INGREDIENT_NAME_CONFLICT: [409, 'El nombre entró en conflicto con otro registro. Revisa el catálogo e inténtalo nuevamente.']
    };
    const [status, mensaje] = respuestas[error.code] || [500, 'No se pudo completar la operación de la lista de compras.'];
    if (status === 500) console.error('Error de la lista de compras:', error);
    return res.status(status).json({ ok: false, mensaje });
};

const leerId = valor => {
    if (typeof valor !== 'string' || !/^\d+$/.test(valor)) return null;
    const id = Number(valor);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const leerDatosCantidadUnidad = body => {
    const cantidadInformada = body.cantidad !== undefined && body.cantidad !== null && body.cantidad !== '';
    const unidadInformada = body.id_unidad !== undefined && body.id_unidad !== null && body.id_unidad !== '';
    if (cantidadInformada !== unidadInformada) return { error: 'La cantidad y la unidad deben enviarse juntas.' };
    if (!cantidadInformada) return { cantidad: null, idUnidad: null };

    const cantidadTexto = String(body.cantidad);
    if (!/^\d+(?:\.\d{1,3})?$/.test(cantidadTexto)) return { error: 'La cantidad debe ser positiva y tener como máximo tres decimales.' };
    const cantidadNumero = Number(cantidadTexto);
    if (!Number.isFinite(cantidadNumero) || cantidadNumero <= 0 || cantidadNumero > 9999999.999) {
        return { error: 'La cantidad debe estar entre 0 y 9.999.999,999.' };
    }

    const idUnidad = Number(body.id_unidad);
    if (!Number.isSafeInteger(idUnidad) || idUnidad <= 0) return { error: 'El identificador de la unidad no es válido.' };
    return { cantidad: cantidadTexto, idUnidad };
};

const obtenerLista = async (req, res) => {
    try {
        const lista = await listaCompraModel.obtenerListaActiva(req.idUsuarioAutenticado);
        if (!lista) return res.json({ ok: true, lista: null, items: [] });
        const items = await listaCompraModel.obtenerElementos(req.idUsuarioAutenticado, lista.id_lista);
        return res.json({ ok: true, lista, items });
    } catch (error) {
        return responderErrorModelo(res, error);
    }
};

const obtenerUnidades = async (req, res) => {
    try {
        const unidades = await listaCompraModel.obtenerUnidades();
        return res.json({ ok: true, unidades });
    } catch (error) {
        return responderErrorModelo(res, error);
    }
};

const agregarElemento = async (req, res) => {
    if (req.body?.nombre !== undefined) {
        const nombre = leerNombre(req.body.nombre);
        const datos = leerDatosCantidadUnidad(req.body || {});
        if (!nombre || datos.error) return res.status(400).json({ ok: false,
            mensaje: datos.error || 'Escribe un solo ingrediente, de 2 a 150 caracteres. Agrega las combinaciones por separado.' });
        try {
            let resultado;
            let idIngrediente;
            if (datos.cantidad === null && req.body.importar === true) {
                const existente = await listaCompraModel.buscarIngredienteCompra(await listaCompraModel.resolverNombreCompra(nombre));
                if (!existente) return res.status(400).json({ ok: false, mensaje: 'Este ingrediente del respaldo necesita cantidad y unidad. Agrégalo manualmente; el respaldo se conserva.' });
                idIngrediente = existente.id_ingrediente;
                resultado = await listaCompraModel.agregarIngredienteCatalogo(req.idUsuarioAutenticado, {
                    idIngrediente, cantidad: null, idUnidad: null, conservarExistente: true
                });
            } else {
                if (datos.cantidad === null) return res.status(400).json({ ok: false, mensaje: 'Indica la cantidad y la unidad.' });
                const clasificacion = await prepararNombre(nombre, datos.idUnidad);
                resultado = await listaCompraModel.agregarIngredientePorNombre(req.idUsuarioAutenticado, {
                    ...clasificacion, cantidad: datos.cantidad, idUnidad: datos.idUnidad, importar: req.body.importar === true
                });
                idIngrediente = resultado.idIngrediente;
            }
            return res.status(resultado.creado ? 201 : 200).json({ ok: true, id_item: idIngrediente,
                duplicado: !resultado.creado && !resultado.acumulado, actualizado: Boolean(resultado.actualizado), mensaje: resultado.creado ? 'Ingrediente agregado a tu lista de compras.'
                    : req.body.importar === true ? 'El ingrediente ya estaba registrado; se conservó su cantidad, sin duplicarlo.'
                        : 'Cantidad actualizada correctamente.' });
        } catch (error) { return responderErrorModelo(res, error); }
    }
    const nombrePersonalizado = req.body?.nombre_personalizado;
    if (typeof nombrePersonalizado === 'string' && nombrePersonalizado.trim()) {
        try {
            await listaCompraModel.agregarIngredientePersonalizado();
        } catch (error) {
            return responderErrorModelo(res, error);
        }
    }

    const idIngrediente = Number(req.body?.id_ingrediente);
    if (!Number.isSafeInteger(idIngrediente) || idIngrediente <= 0) {
        return res.status(400).json({ ok: false, mensaje: 'Indica un identificador de ingrediente válido del catálogo.' });
    }
    const datos = leerDatosCantidadUnidad(req.body || {});
    if (datos.error) return res.status(400).json({ ok: false, mensaje: datos.error });

    try {
        const resultado = await listaCompraModel.agregarIngredienteCatalogo(req.idUsuarioAutenticado, {
            idIngrediente,
            cantidad: datos.cantidad,
            idUnidad: datos.idUnidad,
            acumular: req.body?.importar !== true,
            conservarExistente: req.body?.importar === true
        });
        const status = resultado.creado ? 201 : 200;
        return res.status(status).json({
            ok: true,
            mensaje: resultado.yaComprado
                ? 'El ingrediente ya está en la lista y marcado como comprado.'
                : resultado.creado ? 'Ingrediente agregado a la lista.' : resultado.acumulado ? 'Cantidad actualizada correctamente.' : 'El ingrediente ya estaba en la lista.',
            id_lista: resultado.lista.id_lista,
            id_item: idIngrediente,
            duplicado: !resultado.creado && !resultado.acumulado,
            actualizado: Boolean(resultado.actualizado)
        });
    } catch (error) {
        return responderErrorModelo(res, error);
    }
};

const actualizarElemento = async (req, res) => {
    const idIngrediente = leerId(req.params.id_item);
    if (!idIngrediente) return res.status(400).json({ ok: false, mensaje: 'El identificador del elemento no es válido.' });
    const datos = leerDatosCantidadUnidad(req.body || {});
    if (datos.error) return res.status(400).json({ ok: false, mensaje: datos.error });

    try {
        const actualizado = await listaCompraModel.actualizarIngredienteCatalogo(
            req.idUsuarioAutenticado,
            idIngrediente,
            { cantidad: datos.cantidad, idUnidad: datos.idUnidad }
        );
        if (!actualizado) return res.status(404).json({ ok: false, mensaje: 'El elemento no existe en tu lista activa.' });
        return res.json({ ok: true, mensaje: 'Elemento actualizado.' });
    } catch (error) {
        return responderErrorModelo(res, error);
    }
};

const eliminarElemento = async (req, res) => {
    const idIngrediente = leerId(req.params.id_item);
    if (!idIngrediente) return res.status(400).json({ ok: false, mensaje: 'El identificador del elemento no es válido.' });
    try {
        const eliminados = await listaCompraModel.eliminarIngrediente(req.idUsuarioAutenticado, idIngrediente);
        if (!eliminados) return res.status(404).json({ ok: false, mensaje: 'El elemento no existe en tu lista activa.' });
        return res.json({ ok: true, mensaje: 'Elemento eliminado de la lista.' });
    } catch (error) {
        return responderErrorModelo(res, error);
    }
};

const vaciarLista = async (req, res) => {
    try {
        const eliminados = await listaCompraModel.vaciarElementos(req.idUsuarioAutenticado);
        return res.json({ ok: true, mensaje: eliminados ? 'Se vació la lista activa.' : 'La lista ya estaba vacía.' });
    } catch (error) {
        return responderErrorModelo(res, error);
    }
};

const marcarComprado = async (req, res) => {
    const idIngrediente = leerId(req.params.id_item);
    if (!idIngrediente) return res.status(400).json({ ok: false, mensaje: 'El identificador del elemento no es válido.' });
    try {
        const resultado = await listaCompraModel.marcarCompradoYTransferir(req.idUsuarioAutenticado, idIngrediente);
        if (!resultado.encontrado) return res.status(404).json({ ok: false, mensaje: 'El elemento no existe en tu lista activa.' });
        return res.json({
            ok: true,
            yaProcesado: Boolean(resultado.yaProcesado),
            mensaje: resultado.yaProcesado
                ? 'Esta compra ya se había procesado; no se volvió a sumar a la despensa.'
                : 'Compra marcada y cantidad transferida a la despensa.'
        });
    } catch (error) {
        return responderErrorModelo(res, error);
    }
};

const transferirIngredienteLocalComprado = async (req, res) => {
    const nombre = typeof req.body?.nombre === 'string'
        ? req.body.nombre.trim().replace(/\s+/g, ' ')
        : '';
    const caracteresNombre = [...nombre];
    if (
        caracteresNombre.length < 2 ||
        caracteresNombre.length > 150 ||
        !/\p{L}/u.test(nombre) ||
        !/^[\p{L}\p{N}\s.'’()/-]+$/u.test(nombre) ||
        /\b\d+(?:[.,]\d+)?\s*(?:kg|kilos?|kilogramos?|g|gr|gramos?|ml|cc|l|lt|litros?|unidades?|u|tazas?|cdas?|cucharadas?|cdtas?|cucharaditas?)\b/i.test(nombre)
    ) {
        return res.status(400).json({ ok: false, mensaje: 'Escribe solo el nombre del ingrediente (de 2 a 150 caracteres), sin cantidad ni unidad.' });
    }

    const cantidadTexto = typeof req.body?.cantidad === 'string' || typeof req.body?.cantidad === 'number'
        ? String(req.body.cantidad).trim().replace(',', '.')
        : '';
    const datos = leerDatosCantidadUnidad({ ...req.body, cantidad: cantidadTexto });
    if (datos.error) return res.status(400).json({ ok: false, mensaje: datos.error });
    if (datos.cantidad === null || datos.idUnidad === null) {
        return res.status(400).json({ ok: false, mensaje: 'Indica una cantidad y una unidad válidas antes de transferir el ingrediente.' });
    }

    try {
        const resultado = await listaCompraModel.transferirIngredienteLocalComprado(
            req.idUsuarioAutenticado,
            { ...await prepararNombre(nombre, datos.idUnidad), cantidad: datos.cantidad, idUnidad: datos.idUnidad }
        );
        return res.json({
            ok: true,
            yaProcesado: Boolean(resultado.yaProcesado),
            mensaje: resultado.yaProcesado
                ? 'Esta compra ya se había procesado; no se volvió a sumar a la despensa.'
                : 'Ingrediente agregado a la despensa.',
            ingrediente: {
                id_ingrediente: resultado.ingrediente.id_ingrediente,
                nombre: resultado.ingrediente.nombre,
                cantidad: resultado.cantidad,
                id_unidad: resultado.idUnidad,
                familia: resultado.familia
            }
        });
    } catch (error) {
        return responderErrorModelo(res, error);
    }
};

const procesarFaltantes = guardar => async (req, res) => {
    const idReceta = leerId(String(req.body?.idReceta ?? ''));
    const manuales = req.body?.ingredientesManuales ?? [];
    if (!idReceta || typeof req.body?.usarDespensa !== 'boolean' || !Array.isArray(manuales)
        || manuales.length > 100 || manuales.some(nombre => typeof nombre !== 'string'
            || normalizarIngredienteCulinario(nombre).some(item => !leerNombre(item.nombre)))) {
        return res.status(400).json({ ok: false, mensaje: 'La receta o los ingredientes disponibles no son válidos.' });
    }
    try {
        const datos = { idReceta, usarDespensa: req.body.usarDespensa,
            ingredientesManuales: manuales.flatMap(normalizarIngredienteCulinario).map(item => item.nombre) };
        const resultado = guardar
            ? await listaCompraModel.agregarFaltantesReceta(req.idUsuarioAutenticado, datos)
            : { faltantes: await listaCompraModel.obtenerFaltantesReceta(req.idUsuarioAutenticado, datos) };
        return res.json({ ok: true, ...resultado });
    } catch (error) { return responderErrorModelo(res, error); }
};

module.exports = {
    calcularFaltantes: procesarFaltantes(false),
    agregarFaltantes: procesarFaltantes(true),
    obtenerLista,
    obtenerUnidades,
    agregarElemento,
    actualizarElemento,
    eliminarElemento,
    vaciarLista,
    marcarComprado,
    transferirIngredienteLocalComprado
};


const ingredienteModel = require('../models/ingredienteModel');
const recetaModel = require('../models/recetaModel');
const historialModel = require('../models/historialModel');
const preferenciasModel = require('../models/preferenciasModel');
const despensaModel = require('../models/despensaModel');
const solicitudesGeneracion = require('../models/solicitudGeneracionModel');
const { responderError: responderErrorSuscripcion } = require('../middlewares/suscripciones');
const { crearValidador } = require('../services/seguridadAlimentariaService');
const confirmacionIntolerancias = require('../services/confirmacionIntoleranciasService');
const { normalizarIngredienteCulinario } = require('../services/ingredientesCulinariosService');

const {
    generarRecetasConOpenAI
} = require('../services/openaiService');

const sanitizarMensajeError = mensaje => {
    const credenciales = [process.env.OPENAI_API_KEY, process.env.MYSQL_PASSWORD]
        .filter(Boolean);
    return credenciales.reduce(
        (texto, credencial) => texto.replaceAll(credencial, '[REDACTED]'),
        String(mensaje || 'Sin mensaje de error')
    ).replace(/(api[-_ ]?key|password|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
};

const quitarTiposDeRespuesta = recetas => recetas.map(receta => ({
    ...receta,
    ingredientes: receta.ingredientes.map(({ tipoAlimento, ...ingrediente }) => ingrediente)
}));


// ==================================================
// 1. LISTAR INGREDIENTES DESDE MYSQL
// ==================================================

const listarIngredientes = async (req, res, next) => {
    try {
        // Consulta los ingredientes guardados en la base de datos.
        const ingredientes = await ingredienteModel.obtenerTodos();

        // Devuelve los ingredientes al frontend.
        return res.json({
            ok: true,
            ingredientes
        });

    } catch (error) {
        next(error);
    }
};


// ==================================================
// 2. GENERAR RECETAS CON OPENAI Y GUARDAR EN MYSQL
// ==================================================

const generarRecetas = async (req, res, next) => {
    const abortController = new AbortController();
    let solicitudGeneracion = null;
    let renovacionSolicitud = null;
    let renovando = null;
    const abortarPorCierre = () => {
        if (!res.writableFinished) abortController.abort();
    };
    const abortarPorSolicitud = () => abortController.abort();
    const limpiarListenersCancelacion = () => {
        req.off('aborted', abortarPorSolicitud);
        res.off('close', abortarPorCierre);
    };
    req.once('aborted', abortarPorSolicitud);
    res.once('close', abortarPorCierre);

    try {
        const { signal } = abortController;
        // Recibe la frase, los ingredientes y los filtros.
        const {
            consulta = '',
            ingredientes: ingredientesRecibidos = [],
            tiempoMaximo = 30,
            porciones = 2,
            dificultad = 'Todas',
            pedirFaltantes = false,
            usarDespensa = false
        } = req.body;
        let ingredientes = ingredientesRecibidos;
        if (typeof usarDespensa !== 'boolean') {
            return res.status(400).json({ ok: false, mensaje: 'La opción de despensa no es válida.' });
        }

        // Comprueba el formato de la frase.
        if (typeof consulta !== 'string') {
            return res.status(400).json({
                ok: false,
                mensaje: 'La búsqueda debe ser un texto válido.'
            });
        }

        // Comprueba el formato de los ingredientes.
        if (!Array.isArray(ingredientes)) {
            return res.status(400).json({
                ok: false,
                mensaje: 'Los ingredientes deben enviarse como una lista.'
            });
        }

        // Evita recibir ingredientes con tipos incorrectos.
        if (
            ingredientes.some(
                ingrediente =>
                    typeof ingrediente !== 'string' ||
                    !ingrediente.trim()
            )
        ) {
            return res.status(400).json({
                ok: false,
                mensaje: 'La lista contiene ingredientes inválidos.'
            });
        }

        // La búsqueda debe contener una frase o ingredientes.
        if (!consulta.trim() && ingredientes.length === 0 && !usarDespensa) {
            return res.status(400).json({
                ok: false,
                mensaje: 'Escribe algo en el buscador o selecciona ingredientes.'
            });
        }

        // Valida el tiempo máximo.
        const tiempo = Number(tiempoMaximo);

        if (!Number.isFinite(tiempo) || tiempo <= 0) {
            return res.status(400).json({
                ok: false,
                mensaje: 'El tiempo máximo debe ser un número positivo.'
            });
        }

        // Valida las porciones.
        const cantidadPorciones = Number(porciones);
        console.info('[Generacion: porciones controlador]', {
            recibidas: typeof req.body.porciones === 'string'
                ? sanitizarMensajeError(req.body.porciones).replace(/[\r\n\t]/g, ' ').slice(0, 80)
                : typeof req.body.porciones === 'number' || req.body.porciones == null
                    ? req.body.porciones : '[tipo no valido]',
            tipoRecibido: typeof req.body.porciones,
            valorPorDefecto: req.body.porciones === undefined,
            conversionNumerica: Number.isFinite(cantidadPorciones) ? cantidadPorciones : null,
            conversionFinita: Number.isFinite(cantidadPorciones),
            enteroPositivo: Number.isInteger(cantidadPorciones) && cantidadPorciones > 0
        });

        if (
            !Number.isInteger(cantidadPorciones) ||
            cantidadPorciones < 1
        ) {
            return res.status(400).json({
                ok: false,
                mensaje: 'La cantidad de porciones no es válida.'
            });
        }

        // Valida la dificultad.
        const dificultadesValidas = [
            'Todas',
            'Fácil',
            'Medio',
            'Difícil'
        ];

        if (!dificultadesValidas.includes(dificultad)) {
            return res.status(400).json({
                ok: false,
                mensaje: 'La dificultad seleccionada no es válida.'
            });
        }

        // Valida la opción de ingredientes faltantes.
        if (typeof pedirFaltantes !== 'boolean') {
            return res.status(400).json({
                ok: false,
                mensaje: 'La opción de ingredientes faltantes no es válida.'
            });
        }

        const idUsuarioSesion = req.session?.usuario?.id_usuario;
        const idUsuario = Number(idUsuarioSesion);
        if (!Number.isSafeInteger(idUsuario) || idUsuario <= 0) {
            return res.status(401).json({ ok: false, mensaje: 'Debes iniciar sesión para generar recetas con tus preferencias.' });
        }

        ingredientes = ingredientes.flatMap(normalizarIngredienteCulinario).map(item => item.nombre);
        let ingredientesObligatorios = [...ingredientes];
        let ingredientesDespensa = [];
        if (usarDespensa) {
            try {
                const despensa = await despensaModel.obtenerPorUsuario(idUsuario);
                ingredientesDespensa = despensa.map(item => item.ingrediente);
            } catch (error) {
                console.error('[MySQL despensa] No se pudo cargar:', error.code || 'ERROR');
                return res.status(503).json({ ok: false, mensaje: 'No se pudo consultar tu despensa. No se generaron recetas.' });
            }
            if (signal.aborted) return;
            const clave = nombre => nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-CL');
            ingredientes = [...new Map([...ingredientes, ...ingredientesDespensa].map(nombre => [clave(nombre), nombre.trim()])).values()];
            if (!consulta.trim() && ingredientes.length === 0) {
                return res.status(400).json({ ok: false, mensaje: 'Tu despensa está vacía. Agrega ingredientes o escribe una búsqueda.' });
            }
        }

        let restricciones;
        // Cantidad tecnica fija, independiente del plan y de los datos del navegador.
        const cantidadObjetivo = 3;
        let vinculosRestricciones = [];
        let catalogoSeguridad = [];
        try {
            restricciones = await preferenciasModel.obtenerRestricciones(idUsuario);
            if (restricciones.alergias.length || restricciones.intolerancias.length) {
                vinculosRestricciones = await preferenciasModel.obtenerVinculosRestricciones(idUsuario);
                catalogoSeguridad = await ingredienteModel.obtenerCatalogoSeguridad();
            }
        } catch (error) {
            console.error('[MySQL preferencias] No se pudieron consultar las restricciones:', error.code || 'ERROR');
            return res.status(503).json({
                ok: false,
                mensaje: 'No se pudieron cargar tus alergias e intolerancias. No se generaron recetas. Inténtalo nuevamente.'
            });
        }
        if (signal.aborted) return;
        const { alergias, intolerancias } = restricciones;
        console.info('[Restricciones generacion]', { alergias: alergias.length, intolerancias: intolerancias.length,
            vinculos: vinculosRestricciones.length });
        console.info('[Generacion: diagnostico cafeina perfil]', {
            fuente: 'MySQL_usuario_sesion',
            comoIntolerancia: intolerancias.some(n => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'cafeina'),
            comoAlergia: alergias.some(n => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'cafeina')
        });
        let validador = crearValidador(restricciones, vinculosRestricciones, [], catalogoSeguridad);
        const solicitadosOriginales = [...ingredientesObligatorios];
        const conflictos = validador.conflictosIntolerancia([
            ...ingredientes, ...validador.ingredientesConsulta(consulta)
        ]);
        let excepcionesIntolerancia = [];
        // Las solicitudes normales intentan adaptacion directamente. Se conserva
        // la validacion de confirmaciones ya emitidas para peticiones en curso.
        if (conflictos.length && req.body.confirmacionIntolerancia) {
            const ordenar = valores => [...valores].map(valor => JSON.stringify(valor)).sort();
            const datosConfirmacion = {
                idUsuario, consulta, ingredientes: ordenar(ingredientesObligatorios),
                despensa: ordenar(ingredientesDespensa), usarDespensa,
                tiempo, cantidadPorciones, dificultad, pedirFaltantes,
                restricciones: { alergias: ordenar(alergias), intolerancias: ordenar(intolerancias) },
                vinculos: ordenar(vinculosRestricciones), conflictos: ordenar(conflictos),
                catalogo: ordenar(catalogoSeguridad)
            };
            const decision = req.body.confirmacionIntolerancia;
            const autorizados = ['evitar', 'continuar'].includes(decision?.accion)
                ? confirmacionIntolerancias.consumir(decision.token, req.sessionID, datosConfirmacion)
                : null;
            if (!autorizados) {
                return res.status(409).json({
                    ok: false, code: 'INTOLERANCIA_CONFIRMACION_REQUERIDA',
                    token: confirmacionIntolerancias.emitir(req.sessionID, datosConfirmacion, conflictos),
                    ingredientes: [...new Map(conflictos.map(item => [
                        item.ingrediente.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(), item.ingrediente
                    ])).values()]
                });
            }
            if (decision.accion === 'continuar') {
                excepcionesIntolerancia = autorizados;
                validador = crearValidador(restricciones, vinculosRestricciones, excepcionesIntolerancia, catalogoSeguridad);
            }
        }
        const excluidos = ingredientes.map(nombre => validador.evaluar(nombre)).filter(item => !validador.permiteGeneracion(item));
        ingredientes = validador.filtrar(ingredientes);
        ingredientesObligatorios = validador.filtrar(ingredientesObligatorios);
        ingredientesDespensa = validador.filtrar(ingredientesDespensa);
        if (!consulta.trim() && ingredientes.length === 0 && excluidos.length) {
            return res.status(422).json({ ok: false, mensaje: 'No quedaron ingredientes compatibles verificables con tus restricciones. Agrega otros ingredientes o cambia la búsqueda.', ingredientesExcluidos: excluidos });
        }
        const textoBusqueda = [consulta.trim(), ...ingredientes.map(ingrediente => ingrediente.trim())]
            .filter(Boolean)
            .join(' | ')
            .slice(0, 500);

        let tiposAlimento;
        let referenciasMedida;
        try {
            tiposAlimento = await ingredienteModel.obtenerTiposAlimento();
            referenciasMedida = await ingredienteModel.obtenerReferenciasMedida();
        } catch (error) {
            console.error('[MySQL tipo_alimento] No se pudo consultar el catálogo:', error.code || 'ERROR');
            return res.status(503).json({
                ok: false,
                mensaje: 'No se pudo consultar el catálogo de tipos de alimento. Inténtalo nuevamente.'
            });
        }
        if (!tiposAlimento.length) {
            return res.status(503).json({
                ok: false,
                mensaje: 'No hay tipos de alimento disponibles para clasificar las recetas.'
            });
        }

        // Reserva después de las validaciones y confirmaciones existentes, antes de OpenAI.
        solicitudGeneracion = await solicitudesGeneracion.reservar(idUsuario, req.datosSolicitudGeneracion);
        if (solicitudGeneracion.repetida) {
            return res.json(await solicitudesGeneracion.recuperar(solicitudGeneracion.id, idUsuario));
        }
        if (signal.aborted) return;
        renovacionSolicitud = setInterval(() => {
            if (renovando || signal.aborted) return;
            renovando = solicitudesGeneracion.renovar(solicitudGeneracion.id, idUsuario)
                .then(vigente => {
                    if (!vigente && !signal.aborted) {
                        abortController.abort();
                        if (!res.headersSent && !res.destroyed) res.status(409).json({ ok: false, code: 'SUSCRIPCION_RESERVA_VENCIDA', mensaje: 'La generación venció. Intenta nuevamente.' });
                    }
                })
                .catch(error => {
                    console.error('[Suscripciones: renovación]', { code: error.code || 'ERROR' });
                    abortController.abort();
                    if (!res.headersSent && !res.destroyed) res.status(503).json({ ok: false, code: 'SUSCRIPCION_NO_DISPONIBLE', mensaje: 'No pudimos mantener la reserva de generación. Intenta nuevamente.' });
                }).finally(() => { renovando = null; });
        }, 30000);
        renovacionSolicitud.unref?.();

        // Llama al servicio que se comunica con OpenAI.
        let recetas = [];
        const pendientesVerificacion = [];
        let advertenciaGeneracion = null;
        const problemasAlimentarios = [];
        const cacheClasificaciones = new Map();
        const diagnosticosGeneracion = [];
        let numeroIntento = 0;
        const registrarResultadoIntento = () => console.info('[Generacion: resultado intento]', {
            intento: numeroIntento,
            recibidas: diagnosticosGeneracion.at(-1)?.recibidas ?? null,
            devueltasPorServicio: diagnosticosGeneracion.at(-1)?.devueltas ?? null,
            aceptadasAcumuladas: recetas.length,
            pendientesAcumuladas: pendientesVerificacion.length,
            rechazosAlimentariosEnIntento: problemasAlimentarios.filter(p => p.intento === numeroIntento).length
        });
        try {
            const solicitarRecetas = async (correccionesSeguridad, cantidadRecetas, correccionesFiltros = [], respuestaVaciaAnterior = false) => {
                numeroIntento++;
                console.info('[Generacion: filtros enviados al servicio]', {
                    intento: numeroIntento, porciones: cantidadPorciones,
                    tiempoMaximo: tiempo, cantidadRecetas,
                    tipoPorciones: typeof cantidadPorciones,
                    dificultad: sanitizarMensajeError(dificultad).replace(/[\r\n\t]/g, ' ').slice(0, 80)
                });
                const candidatas = await generarRecetasConOpenAI({
                intentoGeneracion: numeroIntento,
                cantidadRecetas,
                cacheClasificaciones,
                nombresExcluir: recetas.map(r => r.nombre),
                ingredientesSolicitadosOriginales: solicitadosOriginales,
                planAdaptacion: validador.prepararAdaptacion([
                    ...solicitadosOriginales, ...validador.ingredientesConsulta(consulta),
                    ...correccionesSeguridad.map(item => item.ingrediente)
                ]),
                alternativasVerificadas: validador.alternativasVerificables([
                    ...solicitadosOriginales, ...validador.ingredientesConsulta(consulta),
                    ...correccionesSeguridad.map(item => item.ingrediente)
                ]),
                correccionesSeguridad,
                correccionesFiltros,
                respuestaVaciaAnterior,
                consulta: validador.revisarConsulta(consulta.trim()),
                ingredientes: ingredientes.map(
                    ingrediente => ingrediente.trim()
                ),
                tiempoMaximo: tiempo,
                porciones: cantidadPorciones,
                dificultad,
                alergias,
                intolerancias,
                excepcionesIntolerancia,
                ingredientesCompatiblesVerificados: alergias.length || intolerancias.length ? validador.nombresVerificables() : [],
                tiposAlimento,
                referenciasMedida,
                ingredientesDespensa,
                ingredientesObligatorios,
                pedirFaltantes,
                signal
                });
                const diagnostico = candidatas.diagnosticoGeneracion || { devueltas: candidatas.length };
                diagnosticosGeneracion.push(diagnostico);
                console.info('[Generacion: llegada al controlador]', { intento: numeroIntento, ...diagnostico });
                return candidatas;
            };
            const validarCandidatas = (candidatas, intento) => candidatas.filter((receta, indice) => {
                const diagnostico = validador.diagnosticarReceta(receta);
                const problemas = diagnostico.filter(item => !validador.permiteGeneracion(item));
                const clasificacionPendiente = (receta.ingredientes || []).filter(item => item.clasificacionPendiente === true);
                const propuestaPendiente = !problemas.length && clasificacionPendiente.length > 0;
                problemasAlimentarios.push(...problemas.map(item => ({ ...item, intento, receta: indice + 1, accion: 'descartada' })));
                if (propuestaPendiente) {
                    const { idReceta, id_receta, ...propuesta } = receta;
                    propuesta.verificacionAlimentaria = {
                        estado: 'pendiente',
                        motivo: 'clasificacion',
                        ingredientes: [...new Set(clasificacionPendiente.map(item => item.nombre))],
                        mensaje: 'La clasificacion para el catalogo esta pendiente. No se guardo la propuesta; el registro en MySQL no demuestra compatibilidad alimentaria.'
                    };
                    const indicePendiente = pendientesVerificacion.findIndex(r => r.nombre.trim().toLowerCase() === propuesta.nombre.trim().toLowerCase());
                    if (indicePendiente < 0) pendientesVerificacion.push(propuesta);
                    else pendientesVerificacion[indicePendiente] = propuesta;
                }
                const relevantes = diagnostico.filter(item => !validador.permiteGeneracion(item) || item.intoleranciaAutorizada || item.estado === 'sin_conflicto_identificado');
                console.info('[Seguridad alimentaria recetas]', {
                    intento, receta: indice + 1, aceptada: problemas.length === 0 && !clasificacionPendiente.length,
                    decision: problemas.length ? 'RECHAZO_ALIMENTARIO'
                        : clasificacionPendiente.length ? 'CLASIFICACION_CATALOGO_PENDIENTE' : 'ACEPTADA',
                    ingredientesClasificacionPendiente: clasificacionPendiente.map(item =>
                        sanitizarMensajeError(item.nombre || 'Sin nombre').replace(/[\r\n\t]/g, ' ').slice(0, 150)),
                    resultados: relevantes.map(item => ({
                        ingrediente: sanitizarMensajeError(item.ingrediente || 'Sin nombre').slice(0, 150),
                        restriccion: item.restriccion || item.restriccionesAutorizadas || null,
                        origen: item.origen,
                        origenes: item.origenes,
                        evidencia: item.evidencia || null,
                        detalle: item.motivo || null,
                        motivo: item.estado === 'sin_conflicto_identificado' ? 'DOCUMENTACION_GENERAL_NO_BLOQUEANTE'
                            : item.intoleranciaAutorizada ? 'INTOLERANCIA_AUTORIZADA'
                            : item.estado === 'no_verificable' ? 'COMPATIBILIDAD_NO_VERIFICADA'
                            : item.tipo === 'alergia' ? 'ALERGIA_BLOQUEADA'
                            : item.tipo === 'intolerancia' ? 'INTOLERANCIA_NO_AUTORIZADA' : 'SUSTANCIA_NO_APTA'
                    }))
                });
                return problemas.length === 0 && !clasificacionPendiente.length;
            });
            const claveResultado = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
            const firmaResultado = receta => JSON.stringify([
                receta.ingredientes.map(i => claveResultado(i.nombre)).sort(),
                receta.pasos.map(claveResultado)
            ]);
            const incorporarRecetas = candidatas => {
                for (const receta of candidatas) {
                    if (recetas.length >= cantidadObjetivo) break;
                    if (recetas.some(r => claveResultado(r.nombre) === claveResultado(receta.nombre)
                        || firmaResultado(r) === firmaResultado(receta))) {
                        console.info('[Generacion: duplicado omitido]', { intento: numeroIntento, codigo: 'RECETA_DUPLICADA' });
                        continue;
                    }
                    recetas.push(receta);
                }
            };
            incorporarRecetas(validarCandidatas(await solicitarRecetas([], cantidadObjetivo), 1));
            registrarResultadoIntento();
            if (signal.aborted) return;
            const problemaAdaptable = item => (item.estado === 'incompatible' && item.tipo !== 'sustancia_no_apta')
                || item.estado === 'requiere_adaptacion'
                || item.estado === 'no_verificable' && item.tipo === 'intolerancia' && item.restriccion === 'cafeina';
            const respuestaVacia = diagnosticosGeneracion[0]?.recibidas === 0;
            const codigosFiltros = new Set(['PORCIONES_NO_SOLICITADAS', 'DIFICULTAD_NO_SOLICITADA', 'DIFICULTAD_INVALIDA', 'TIEMPO_INVALIDO_O_EXCEDIDO']);
            const correccionesFiltros = [...new Set(diagnosticosGeneracion.flatMap(d => d.descartes || [])
                .filter(d => codigosFiltros.has(d.codigo)).map(d => d.codigo))]
                .map(codigo => ({ codigo, porciones: cantidadPorciones, dificultad, tiempoMaximo: tiempo }));
            if (numeroIntento < 2 && recetas.length < cantidadObjetivo
                && (respuestaVacia || problemasAlimentarios.some(problemaAdaptable) || correccionesFiltros.length)) {
                const correcciones = [...new Map(problemasAlimentarios.filter(problemaAdaptable).map(item => {
                    const problema = { ingrediente: item.ingrediente, estado: item.estado,
                        motivo: item.motivo || item.estado, tipo: item.tipo, restriccion: item.restriccion };
                    return [JSON.stringify(problema), problema];
                })).values()];
                try {
                    console.info('[Generacion: reintento]', { intento: 2, cantidad: cantidadObjetivo - recetas.length,
                        respuestaVacia, filtros: correccionesFiltros.map(c => c.codigo), correccionesAlimentarias: correcciones.length });
                    incorporarRecetas(validarCandidatas(await solicitarRecetas(correcciones, cantidadObjetivo - recetas.length, correccionesFiltros, respuestaVacia), 2));
                    registrarResultadoIntento();
                } catch (error) {
                    if (signal.aborted) return;
                    if (!recetas.length && !pendientesVerificacion.length) throw error;
                    console.error('[Reintento parcial]', { code: error.code || 'ERROR' });
                    advertenciaGeneracion = 'Se conservaron las recetas validas, pero no se pudo completar la generacion.';
                }
            }

            // Comprobacion final de filtros sobre la seleccion completa. No ajustar
            // cantidades ni etiquetas para hacer pasar una receta incompatible.
            recetas = recetas.filter((receta, indice) => {
                const codigo = Number(receta.porciones) !== cantidadPorciones ? 'PORCIONES_NO_SOLICITADAS'
                    : !Number.isFinite(Number(receta.minutosPreparacion)) || Number(receta.minutosPreparacion) <= 0
                        || Number(receta.minutosPreparacion) > tiempo ? 'TIEMPO_INVALIDO_O_EXCEDIDO'
                    : !['Fácil', 'Medio', 'Difícil'].includes(receta.dificultad) ? 'DIFICULTAD_INVALIDA'
                    : dificultad !== 'Todas' && receta.dificultad !== dificultad ? 'DIFICULTAD_NO_SOLICITADA' : null;
                if (codigo) {
                    const descarte = { etapa: 'filtros', codigo, receta: indice + 1 };
                    diagnosticosGeneracion.push({ descartes: [descarte] });
                    console.info('[Generacion: filtro antes de persistir]', descarte);
                }
                return !codigo;
            });
            const ultimosFiltros = diagnosticosGeneracion.at(-1)?.descartes || [];
            if (recetas.length > 0 && recetas.length < cantidadObjetivo && !advertenciaGeneracion
                && ultimosFiltros.some(d => codigosFiltros.has(d.codigo))) {
                const motivos = [...new Set(ultimosFiltros.filter(d => codigosFiltros.has(d.codigo)).map(d =>
                    d.codigo === 'PORCIONES_NO_SOLICITADAS' ? 'porciones'
                        : d.codigo === 'TIEMPO_INVALIDO_O_EXCEDIDO' ? 'tiempo' : 'dificultad'))];
                advertenciaGeneracion = `Se conservaron las recetas validas. Otras propuestas no cumplieron los filtros de ${motivos.join(', ')} y no se guardaron.`;
            }

        } catch (error) {
            if (signal.aborted) return;
            if (error?.appCode === 'INGREDIENT_CLASSIFICATION_FAILED') {
                console.error('[OpenAI clasificación] Categoría de ingrediente inválida:', {
                    code: sanitizarMensajeError(error.code || 'INGREDIENT_CLASSIFICATION_FAILED').slice(0, 100),
                    httpStatus: error.status || null,
                    ingrediente: sanitizarMensajeError(error.ingrediente || '').slice(0, 150),
                    tipoAlimento: sanitizarMensajeError(error.tipoAlimento || '').slice(0, 150),
                    tipoAlimentoReclasificado: sanitizarMensajeError(error.tipoAlimentoReclasificado ?? 'Sin categoría').slice(0, 150)
                });
                return res.status(422).json({
                    ok: false,
                    mensaje: error.code === 'INGREDIENT_NAME_AMBIGUOUS'
                        ? `No se pudo identificar sin ambigüedad «${sanitizarMensajeError(error.ingrediente || 'ingrediente desconocido').slice(0, 150)}». Usa ingredientes separados. No se guardaron recetas.`
                        : `No se pudo validar la clasificación de «${sanitizarMensajeError(error.ingrediente || 'ingrediente desconocido').slice(0, 150)}». No se guardaron recetas.`
                });
            }
            const statusOriginal = error?.status ?? error?.response?.status ?? null;
            const codigoOriginal = error?.code ?? error?.error?.code ?? statusOriginal;
            const statusOpenAI = Number(statusOriginal ?? codigoOriginal);
            const mensajeOpenAI = sanitizarMensajeError(error?.message || String(error));
            console.error('[OpenAI texto] Falló la generación de recetas:', {
                httpStatus: statusOriginal !== null && Number.isFinite(Number(statusOriginal))
                    ? Number(statusOriginal)
                    : null,
                code: codigoOriginal === null ? null : sanitizarMensajeError(codigoOriginal),
                message: mensajeOpenAI
            });
            const servicioOcupado = statusOpenAI === 503 ||
                /high demand|overload(?:ed)?|resource exhausted|temporarily unavailable|service unavailable|\bUNAVAILABLE\b/i.test(mensajeOpenAI);

            if (servicioOcupado) {
                return res.status(503).json({
                    ok: false,
                    mensaje: 'El servicio de recetas está ocupado. Inténtalo nuevamente en unos minutos.'
                });
            }

            return res.status(502).json({
                ok: false,
                mensaje: 'No se pudieron generar las recetas en este momento. Inténtalo nuevamente más tarde.'
            });
        }

        if (signal.aborted) return;

        // Preferir alternativas compatibles; las propuestas pendientes nunca pasan
        // por guardarGeneradas ni por el registro del historial en MySQL.
        const propuestasPendientes = pendientesVerificacion.filter(p =>
            !recetas.some(r => r.nombre.trim().toLowerCase() === p.nombre.trim().toLowerCase()))
            .slice(0, cantidadObjetivo - recetas.length);
        console.info('[Generacion: antes de persistir]', { compatibles: recetas.length,
            pendientes: propuestasPendientes.length,
            rechazosAlimentarios: problemasAlimentarios.length,
            intentos: numeroIntento });
        if (!recetas.length && propuestasPendientes.length) {
            return res.json({ ok: true, cantidad: propuestasPendientes.length, idBusqueda: null,
                ingredientesUtilizados: ingredientes, ingredientesExcluidos: excluidos,
                advertencia: 'Se muestran propuestas pendientes de verificacion; no se guardaron como recetas compatibles.',
                recetas: quitarTiposDeRespuesta(propuestasPendientes) });
        }

        if (!recetas.length && !problemasAlimentarios.length) {
            const descartes = diagnosticosGeneracion.flatMap(d => d.descartes || []);
            const etiquetas = { normalizacion: 'formato de ingredientes', estructura: 'estructura de las recetas',
                filtros: 'tiempo, porciones o dificultad', estructura_ingredientes: 'cantidades o unidades',
                clasificacion: 'clasificacion de ingredientes', intencion: 'coincidencia con los ingredientes solicitados', seleccion: 'seleccion de resultados' };
            const etiquetasFiltros = { PORCIONES_NO_SOLICITADAS: 'porciones distintas de las solicitadas o no interpretables',
                DIFICULTAD_NO_SOLICITADA: 'dificultad distinta de la seleccionada',
                DIFICULTAD_INVALIDA: 'dificultad no reconocida',
                TIEMPO_INVALIDO_O_EXCEDIDO: 'tiempo invalido o superior al maximo solicitado' };
            const causas = [...new Set(descartes.map(d => etiquetasFiltros[d.codigo] || etiquetas[d.etapa]).filter(Boolean))];
            const vacia = diagnosticosGeneracion.length > 0 && diagnosticosGeneracion.every(d => d.recibidas === 0);
            return res.status(422).json({
                ok: false, code: 'GENERACION_SIN_RESULTADOS',
                mensaje: vacia ? 'El generador devolvio una lista vacia de recetas. Intenta nuevamente.'
                    : causas.length ? `Las propuestas no pudieron utilizarse por: ${causas.join('; ')}. No fue un rechazo por alergias o intolerancias. Intenta nuevamente.`
                    : 'No llegaron recetas procesables a la validacion alimentaria. Intenta nuevamente.'
            });
        }
        if (recetas.length === 0) {
            const faltaInformacion = problemasAlimentarios.some(item => item.estado === 'no_verificable');
            const incompatibles = problemasAlimentarios.some(item => item.estado === 'incompatible');
            const restriccionesImplicadas = [...new Set(problemasAlimentarios
                .filter(item => item.estado === 'incompatible' || item.estado === 'requiere_adaptacion')
                .map(item => item.restriccion).filter(Boolean))];
            const motivoRestricciones = restriccionesImplicadas.length
                ? ` por estas restricciones: ${restriccionesImplicadas.join(', ')}` : '';
            return res.status(422).json({
                ok: false,
                code: faltaInformacion ? 'SEGURIDAD_INFORMACION_INSUFICIENTE' : 'SEGURIDAD_INGREDIENTES_INCOMPATIBLES',
                mensaje: faltaInformacion
                    ? `No se pudo verificar la compatibilidad de algunos ingredientes.${incompatibles ? ' También se detectaron incompatibilidades.' : ''} No se guardaron recetas. Prueba otros ingredientes.`
                    : `No se pudo obtener una version adaptada${motivoRestricciones}. No se guardaron recetas incompatibles. Intenta una nueva generacion.`,
                ingredientesNoVerificados: problemasAlimentarios
            });
        }

        // Conserva la URL de Unsplash en el campo que persiste MySQL.
        const recetasConImagen = recetas.map(receta => ({
            ...receta,
            imagenUrl: receta.imagen?.url || null
        }));

        try {
            // La transacción final comprueba la vigencia; no renovar una fila ya confirmada.
            clearInterval(renovacionSolicitud);
            if (renovando) await renovando;
            if (signal.aborted) return;
            const idsRecetas = await recetaModel.guardarGeneradas(recetasConImagen, {
                idUsuario,
                dificultadSolicitada: dificultad === 'Todas' ? 'Todas' : dificultad,
                minutosMaximos: tiempo,
                porciones: cantidadPorciones,
                idSolicitud: solicitudGeneracion.id,
                signal
            });
            recetasConImagen.forEach((receta, indice) => {
                receta.idReceta = idsRecetas[indice];
            });
            console.info('[Generacion: persistencia confirmada]', { guardadas: idsRecetas.length });
        } catch (error) {
            if (signal.aborted) return;
            if (error.code?.startsWith('SUSCRIPCION_')) return responderErrorSuscripcion(res, error);
            console.error('[MySQL recetas] Falló la transacción de guardado:', {
                code: error?.code || null,
                appCode: error?.appCode || null,
                errno: error?.errno || null,
                ingrediente: sanitizarMensajeError(error?.ingrediente || '').slice(0, 150),
                tipoAlimento: sanitizarMensajeError(error?.tipoAlimento || '').slice(0, 150),
                unidad: sanitizarMensajeError(error?.unidad || '').slice(0, 80),
                familiaRecibida: error?.familiaRecibida || null,
                familiaCatalogo: error?.familiaCatalogo || null,
                message: sanitizarMensajeError(error?.sqlMessage || error?.message)
            });
            if (['INGREDIENT_CATALOG_INSERT_FAILED', 'INGREDIENT_CLASSIFICATION_FAILED'].includes(error?.appCode)) {
                const detalleMedida = ['INGREDIENT_FAMILY_CONFLICT', 'INGREDIENT_UNIT_UNKNOWN'].includes(error.code)
                    ? ` Ingrediente: ${String(error.ingrediente).slice(0, 150)}. Unidad: ${String(error.unidad).slice(0, 80)}. No se realizó ninguna conversión.`
                    : error.code === 'INGREDIENT_MEASURE_REQUIRED'
                    ? ` No se pudo guardar «${sanitizarMensajeError(error.ingrediente || '').slice(0, 150)}»: es nuevo en el catálogo y no tiene una familia de medida verificable. Se conservó la indicación culinaria sin inventar una cantidad ni unidad.`
                    : '';
                return res.json({
                    ok: true,
                    cantidad: recetasConImagen.length + propuestasPendientes.length,
                    idBusqueda: null,
                    ingredientesUtilizados: ingredientes,
                    ingredientesExcluidos: excluidos,
                    advertencia: 'No se pudo validar o registrar un ingrediente en el catalogo. Las recetas se muestran, pero no se guardaron.' + detalleMedida,
                    recetas: quitarTiposDeRespuesta([...recetasConImagen, ...propuestasPendientes])
                });
            }
            return res.status(500).json({
                ok: false,
                mensaje: 'OpenAI generó las recetas, pero no se pudieron guardar. Inténtalo nuevamente más tarde.'
            });
        }

        let idBusqueda = null;
        let advertenciaHistorial = null;
        if (!signal.aborted && idUsuario !== null && recetasConImagen.length > 0) {
            try {
                idBusqueda = await historialModel.registrarBusqueda({
                    idUsuario,
                    textoBusqueda,
                    dificultadSolicitada: dificultad,
                    minutosMaximos: tiempo,
                    porciones: cantidadPorciones
                });
            } catch (error) {
                advertenciaHistorial = 'Las recetas se guardaron, pero no pudimos registrar esta búsqueda en tu historial.';
                console.error('[MySQL historial_busqueda] Falló el INSERT del historial:', {
                    code: error?.code || null,
                    errno: error?.errno || null,
                    message: sanitizarMensajeError(error?.sqlMessage || error?.message)
                });
            }
        }

        if (signal.aborted) return;

        // Devuelve las recetas generadas.
        return res.json({
            ok: true,
            cantidad: recetasConImagen.length + propuestasPendientes.length,
            ...(excluidos.length || problemasAlimentarios.length ? {
                ingredientesExcluidos: excluidos,
                recetasDescartadas: problemasAlimentarios.some(item => item.accion === 'descartada'),
                problemasRecetas: problemasAlimentarios.filter(item => item.accion === 'descartada').map(({ ingrediente, estado, motivo, tipo, restriccion, intento, receta }) =>
                    ({ ingrediente, estado, motivo, tipo, restriccion, intento, receta }))
            } : {}),
            ...(advertenciaGeneracion ? { advertencia: advertenciaGeneracion + (problemasAlimentarios.length ? ' Se excluyeron las recetas incompatibles o no verificables.' : '') } : {}),
            ...(advertenciaHistorial ? { advertenciaHistorial } : {}),
            idBusqueda,
            ingredientesUtilizados: ingredientes,
            recetas: quitarTiposDeRespuesta([...recetasConImagen, ...propuestasPendientes])
        });

    } catch (error) {
        if (abortController.signal.aborted) return;
        if (error.code?.startsWith('SUSCRIPCION_')) return responderErrorSuscripcion(res, error);
        next(error);
    } finally {
        clearInterval(renovacionSolicitud);
        if (renovando) await renovando;
        if (solicitudGeneracion && !solicitudGeneracion.repetida) {
            try {
                await solicitudesGeneracion.finalizar(solicitudGeneracion.id, req.idUsuarioAutenticado, abortController.signal.aborted);
            } catch (error) { console.error('[Suscripciones: cierre]', { code: error.code || 'ERROR' }); }
        }
        limpiarListenersCancelacion();
    }
};


// ==================================================
// 3. EXPORTAR FUNCIONES
// ==================================================

module.exports = {
    listarIngredientes,
    generarRecetas
};

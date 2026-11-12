const { obtenerPlan } = require('../models/suscripcionModel');
const solicitudes = require('../models/solicitudGeneracionModel');
const { parametros, comprobarRepeticion } = require('../services/solicitudesService');

const mensajeAcceso = 'Mi Despensa y Lista de Compras están disponibles con MasterChef. Descubre el plan para acceder.';
function responderError(res, e) {
    if (!e.code?.startsWith('SUSCRIPCION_')) {
        console.error('[Suscripciones] No se pudo comprobar la solicitud', { code: e.code || 'ERROR' });
        return res.status(503).json({ ok: false, code: 'SUSCRIPCION_NO_DISPONIBLE', mensaje: 'No pudimos comprobar tu suscripción. Intenta más tarde.' });
    }
    return res.status(e.status || 409).json({ ok: false, code: e.code, mensaje: e.message });
}
async function cargarPlan(req, res, next) {
    try {
        req.planActual = await obtenerPlan(req.idUsuarioAutenticado);
        res.locals.planActual = req.planActual;
        if (req.path === '/suscripciones') res.locals.avisosSuscripcion = req.flash('suscripcion');
        next();
    } catch (e) { next(e); }
}
async function pagina(req, res, next) {
    try {
        req.planActual = await obtenerPlan(req.idUsuarioAutenticado);
        res.locals.planActual = req.planActual;
        if (req.planActual.masterchef) return next();
        req.flash('suscripcion', mensajeAcceso);
        return res.redirect('/suscripciones');
    } catch (e) {
        console.error('[Suscripciones: página]', { code: e.code || 'ERROR' });
        return res.status(e.status || 503).send('No pudimos comprobar tu plan. Intenta más tarde.');
    }
}
async function api(req, res, next) {
    try {
        req.planActual = await obtenerPlan(req.idUsuarioAutenticado);
        if (!req.planActual.masterchef) return res.status(403).json({ ok: false, code: 'SUSCRIPCION_MASTERCHEF_REQUERIDO', mensaje: mensajeAcceso, redirigir: '/suscripciones' });
        return next();
    } catch (e) { return responderError(res,e); }
}
async function generacion(req, res, next) {
    try {
        req.planActual = await obtenerPlan(req.idUsuarioAutenticado);
        if (req.body?.usarDespensa === true && !req.planActual.masterchef) return res.status(403).json({ ok: false, code: 'SUSCRIPCION_MASTERCHEF_REQUERIDO', mensaje: mensajeAcceso });
        req.datosSolicitudGeneracion = parametros(req);
        res.set('Idempotency-Key', req.datosSolicitudGeneracion.clave);
        res.set('Cache-Control', 'no-store');
        const anterior = await solicitudes.buscar(req.idUsuarioAutenticado, req.datosSolicitudGeneracion.clave);
        if (anterior) {
            comprobarRepeticion(anterior, req.datosSolicitudGeneracion.huella);
            return res.json(await solicitudes.recuperar(anterior.id_solicitud, req.idUsuarioAutenticado));
        }
        next();
    } catch (e) { return responderError(res,e); }
}
module.exports = { pagina, api, cargarPlan, generacion, responderError };

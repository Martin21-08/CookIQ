const registros = require('../services/registroService');
function comprobarOrigen(req) {
    const origen = req.get('origin');
    if (origen && origen !== `${req.protocol}://${req.get('host')}`) throw Object.assign(new Error('La solicitud debe realizarse desde CookIQ.'), { status:403 });
}
function responderError(res, error) {
    console.error('[Registro: preferencias]', { code:error.code || 'REGISTRO_FALLIDO' });
    return res.status(error.status || (error.code === 'ER_DUP_ENTRY' ? 409:503)).json({ ok:false, error:error.status ? error.message
        : error.code === 'ER_DUP_ENTRY' ? 'El correo o teléfono ya está registrado. Si completaste el registro, inicia sesión; no se crearon preferencias parciales.'
            : 'No se pudo completar el registro. Tus selecciones se mantienen; intenta nuevamente.' });
}
function estado(req,res) { res.set('Cache-Control','no-store'); return res.json(registros.estado(req)); }
function borrador(req,res) {
    try { comprobarOrigen(req); res.set('Cache-Control','no-store'); return res.json(registros.guardarBorrador(req)); }
    catch (error) { return responderError(res,error); }
}
async function finalizar(req,res) {
    try {
        comprobarOrigen(req);
        const resultado = await registros.finalizar(req);
        if (registros.marcarNotificado(req)) {
            req.flash('success','Tu cuenta y tus preferencias se guardaron correctamente. Ya puedes iniciar sesión.');
            await new Promise((resolve,reject) => req.session.save(error => error ? reject(error):resolve()));
        }
        res.set('Cache-Control','no-store');
        return res.json(resultado);
    } catch (error) { return responderError(res,error); }
}
module.exports = { estado, finalizar, borrador, comprobarOrigen };

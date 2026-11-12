const modelo = require('../models/paypalModel');
const { obtenerPlan } = require('../models/suscripcionModel');
const { crearCliente,fallo,uuid,identificador,configuracion,csrf,validarCsrf,instante,
    enlaceAprobacion,huellaEvento,validarSuscripcion,comprobanteAviso,validarComprobanteAviso } = require('../services/paypalService');

function crearControlador({ db = modelo, cliente = crearCliente(), planUsuario = obtenerPlan, reloj = () => Date.now() } = {}) {
    // Límite técnico local de verificación, independiente de las cuotas de recetas.
    // Agrupar solicitudes simultáneas y aplicar espera también si PayPal falla.
    const verificaciones = new Map();
    const intervaloPendiente = dato => [5000,10000,20000,30000,60000][Math.min(dato.pendientes || 0,4)];
    const mensajes = {
        PAYPAL_CONFIGURACION_PENDIENTE:'PayPal Sandbox está pendiente de configurar. No se inició ningún cobro.',
        PAYPAL_MASTERCHEF_VIGENTE:'Ya tienes MasterChef vigente. No necesitas contratarlo otra vez.',
        PAYPAL_ASIGNACION_MANUAL:'Tu asignación MasterChef necesita revisión administrativa. No se modificó ni se inició una compra.',
        PAYPAL_CREACION_REQUIERE_REVISION:'La contratación anterior necesita revisión antes de crear otra. No se inició una compra adicional.',
        PAYPAL_CSRF_INVALIDO:'Recarga la página e intenta nuevamente desde la dirección configurada para CookIQ.',
        PAYPAL_OPERACION_AJENA:'No se encontró una contratación asociada a tu cuenta.',
        PAYPAL_COBERTURA_NO_VERIFICADA:'Aún no pudimos confirmar el periodo pagado. No se activaron beneficios adicionales.',
        PAYPAL_ZONA_MYSQL_INCOMPATIBLE:'La zona horaria requiere revisión antes de activar el contrato.',
        PAYPAL_CANCELACION_NO_DISPONIBLE:'No hay una suscripción PayPal cancelable en esta operación.'
    };
    const registrar = error => console.error('[PayPal Sandbox]',{ code:error.code || 'PAYPAL_ERROR',
        http:error.paypalHttpStatus || null,tipo:error.paypalTipo || null });
    function responder(res,error) {
        registrar(error);
        return res.status(error.status || 503).json({ ok:false,code:error.code?.startsWith('PAYPAL_') ? error.code:'PAYPAL_NO_DISPONIBLE',
            mensaje:mensajes[error.code] || 'No pudimos completar la verificación con PayPal Sandbox. Intenta nuevamente. No se confirmó una activación.' });
    }
    function listo() {
        const c = cliente.config();
        if (!c.listaParaContratar) throw fallo('PAYPAL_CONFIGURACION_PENDIENTE',503);
        return c;
    }
    function proteger(req) {
        const c = listo();
        if (req.get('origin') !== c.origen || !validarCsrf(c,req.get('x-paypal-csrf'),req.sessionID,req.idUsuarioAutenticado)) throw fallo('PAYPAL_CSRF_INVALIDO',403);
    }
    async function propia(req) {
        const clave = req.body?.operacion || req.query?.operacion;
        if (!uuid(clave)) throw fallo('PAYPAL_OPERACION_AJENA',404);
        const local = await db.buscarOperacion(clave,req.idUsuarioAutenticado);
        if (!local) throw fallo('PAYPAL_OPERACION_AJENA',404); return local;
    }
    async function sincronizar(local,{ forzar = false } = {}) {
        if (!local.paypal_subscription_id) return { activa:false,estado:local.estado_paypal,hasta:null,revision:false };
        const clave = local.paypal_subscription_id, ahora = reloj(), anterior = verificaciones.get(clave);
        if (anterior?.promesa) return anterior.promesa;
        if (!forzar && anterior && anterior.proxima > ahora) {
            if (anterior.error) throw anterior.error;
            return anterior.resultado;
        }
        for (const [id,dato] of verificaciones) if (!dato.promesa && dato.proxima < ahora-300000) verificaciones.delete(id);
        const dato = { proxima:ahora+5000,fallos:anterior?.fallos || 0,
            pendientes:anterior?.pendientes || 0,retornoRevisado:anterior?.retornoRevisado || false };
        dato.promesa = (async () => {
            try {
                const inicioVerificacion = reloj();
                const snapshot = await cliente.verificar(local);
                const inicioGuardado = reloj();
                dato.resultado = await db.sincronizar(local,snapshot);
                dato.fallos = 0;
                const intervalo = dato.resultado.activa ? 60000:intervaloPendiente(dato);
                if (!dato.resultado.activa) dato.pendientes++;
                dato.proxima = reloj()+intervalo;
                console.info('[PayPal: verificación]',{ operacion:local.id_paypal_suscripcion,estado:snapshot.remota.status,
                    ...(snapshot.diagnostico || {}),cobrosValidados:snapshot.cobros.length,
                    coberturaVigente:dato.resultado.activa,verificacionMs:inicioGuardado-inicioVerificacion,
                    persistenciaMs:reloj()-inicioGuardado,proximaConsultaSegundos:intervalo/1000 });
                return dato.resultado;
            } catch (e) {
                dato.fallos++; dato.error = e;
                dato.proxima = reloj()+Math.min(300000,30000*2**Math.min(dato.fallos-1,4));
                throw e;
            } finally { dato.promesa = null; }
        })();
        verificaciones.set(clave,dato);
        return dato.promesa;
    }
    function programar(local,{ retorno = false } = {}) {
        const anterior = verificaciones.get(local.paypal_subscription_id);
        if (anterior?.promesa) { if (retorno) anterior.retornoRevisado = true; return; }
        const inmediata = retorno && !anterior?.retornoRevisado && !anterior?.error && !anterior?.resultado?.activa;
        if (anterior && anterior.proxima > reloj() && !inmediata) return;
        // No esperar a PayPal dentro del retorno ni hacer bucles de reintento HTTP.
        void sincronizar(local,{forzar:inmediata}).catch(registrar);
        if (retorno) { const tarea = verificaciones.get(local.paypal_subscription_id); if (tarea) tarea.retornoRevisado = true; }
    }
    async function configuracionPublica(req,res) {
        try {
            const c = cliente.config(), plan = await planUsuario(req.idUsuarioAutenticado), local = await db.ultima(req.idUsuarioAutenticado);
            res.set('Cache-Control','no-store');
            return res.json({ ok:true,preparado:c.listaParaContratar,pendiente:c.lista,origen:c.origen,masterchef:plan.masterchef,
                csrf:c.secret ? csrf(c,req.sessionID,req.idUsuarioAutenticado):null,
                operacion:local?.clave_operacion || null,estado:local?.estado_paypal || null,
                pendienteActivacion:!plan.masterchef && Boolean(local) && !['CANCELLED','EXPIRED'].includes(local.estado_paypal),
                modoLocal:c.modoLocal,
                mensaje:!c.listaParaContratar ? 'Contratación Sandbox pendiente de configuración.'
                    : c.modoLocal ? 'Prueba local: USD $1.00 mensual ficticio. Sin webhook; se verifica mediante API mientras CookIQ está ejecutándose.'
                    : 'Entorno de prueba: USD $1.00 mensual ficticio.' });
        } catch (e) { return responder(res,e); }
    }
    async function contratar(req,res) {
        try {
            proteger(req);
            const clave = req.get('Idempotency-Key');
            if (!uuid(clave)) throw fallo('PAYPAL_CLAVE_INVALIDA',400);
            let local = await db.iniciar(req.idUsuarioAutenticado,clave.toLowerCase());
            let remota;
            if (local.paypal_subscription_id) remota = await cliente.suscripcion(local.paypal_subscription_id);
            else {
                // PayPal conserva la idempotencia 72 h. Un resultado ambiguo más
                // antiguo requiere revisión; no crear otro contrato a ciegas.
                if (Date.now()-instante(local.creadaISO) > 71*3600000) throw fallo('PAYPAL_CREACION_REQUIERE_REVISION');
                const creada = await cliente.crear(local);
                if (!identificador(creada.id)) throw fallo('PAYPAL_RESPUESTA_INVALIDA',503);
                remota = await cliente.suscripcion(creada.id);
                local = await db.vincular(local,remota);
            }
            validarSuscripcion(remota,local);
            res.set('Cache-Control','no-store');
            return res.json({ ok:true,operacion:local.clave_operacion,estado:remota.status,
                comprobanteAviso:!local.id_suscripcion_usuario && !['CANCELLED','EXPIRED'].includes(remota.status)
                    ? comprobanteAviso(cliente.config(),local,reloj()):null,
                aprobacion:enlaceAprobacion(remota),mensaje:'La aprobación por sí sola no activa MasterChef: se verificará el cobro.' });
        } catch (e) { return responder(res,e); }
    }
    async function estado(req,res) {
        try {
            listo();
            const local = await propia(req);
            const espera = local.id_suscripcion_usuario ? 60000:5000;
            if (local.paypal_subscription_id && (!local.sincronizadaISO || reloj()-instante(local.sincronizadaISO)>=espera)) programar(local);
            const plan = await planUsuario(req.idUsuarioAutenticado);
            const fresca = await db.buscarOperacion(local.clave_operacion,req.idUsuarioAutenticado);
            const tarea = verificaciones.get(local.paypal_subscription_id);
            const revision = Boolean(tarea?.resultado?.revision);
            const pendiente = !plan.masterchef && !['CANCELLED','EXPIRED'].includes(fresca.estado_paypal);
            const reintentar = tarea?.promesa ? 2:Math.max(2,Math.ceil(((tarea?.proxima || reloj()+5000)-reloj())/1000));
            res.set('Cache-Control','no-store');
            return res.json({ ok:true,masterchef:plan.masterchef,estado:fresca.estado_paypal,revision,
                pendienteActivacion:pendiente,reintentarEnSegundos:reintentar,
                estadoVerificacion:tarea?.error ? 'error_temporal':tarea?.promesa ? 'verificando':pendiente ? 'pendiente':'finalizada',
                mensaje:revision ? 'Se registró un reembolso parcial pendiente de revisión. No se concedió cobertura adicional; se conservan los derechos independientes vigentes.'
                    : plan.masterchef ? 'MasterChef está disponible. Ya puedes acceder a Mi Despensa y Lista de Compras.'
                    : ['CANCELLED','EXPIRED'].includes(fresca.estado_paypal) ? 'La suscripción no tiene beneficios vigentes.'
                    : tarea?.error ? 'PayPal no pudo completar la consulta. Tu contratación continúa pendiente; volveremos a verificarla automáticamente. No vuelvas a comprar.'
                    : 'Estamos verificando tu compra de MasterChef. Esto puede tardar unos momentos. No necesitas realizar otro pago.' });
        } catch (e) { return responder(res,e); }
    }
    async function retorno(req,res) {
        let clave = '';
        const inicio = reloj();
        try { listo(); const local = await propia(req); clave = local.clave_operacion; programar(local,{retorno:true}); }
        catch (e) { registrar(e); }
        // No confiar en subscription_id ni ba_token que lleguen por query string.
        console.info('[PayPal: retorno]',{duracionMs:reloj()-inicio,verificacionProgramada:Boolean(clave)});
        return res.redirect(`/suscripciones?paypal=retorno${clave ? `&operacion=${encodeURIComponent(clave)}`:''}`);
    }
    function cancelado(req,res) {
        return res.redirect('/suscripciones?paypal=cancelado');
    }
    async function notificarCompra(req,res) {
        try {
            proteger(req);
            const local = await propia(req);
            if (!validarComprobanteAviso(cliente.config(),local,req.body?.comprobanteAviso,reloj())) throw fallo('PAYPAL_COMPROBANTE_INVALIDO',403);
            const entregada = await db.reclamarAvisoCompra(local);
            if (entregada) {
                req.flash('success','¡Compra realizada con éxito! 🎉 Tu suscripción MasterChef se ha activado correctamente. Ya puedes disfrutar de todos sus beneficios.');
                await new Promise((resolve,reject) => req.session.save(error => error ? reject(error):resolve()));
            }
            res.set('Cache-Control','no-store');
            return res.json({ok:true,notificada:entregada});
        } catch (e) { return responder(res,e); }
    }
    async function cancelar(req,res) {
        try {
            proteger(req); const local = await propia(req);
            if (!local.paypal_subscription_id) throw fallo('PAYPAL_CANCELACION_NO_DISPONIBLE');
            const remota = await cliente.suscripcion(local.paypal_subscription_id); validarSuscripcion(remota,local);
            if (['ACTIVE','SUSPENDED'].includes(remota.status)) await cliente.cancelar(remota.id);
            else if (remota.status !== 'CANCELLED') throw fallo('PAYPAL_CANCELACION_NO_DISPONIBLE');
            await sincronizar(local,{forzar:true});
            return res.json({ ok:true,mensaje:'Se cancelaron las futuras renovaciones PayPal. Se conserva cualquier periodo pagado vigente y los derechos administrativos independientes.' });
        } catch (e) { return responder(res,e); }
    }
    async function procesarEvento(id) {
        const fila = await db.reclamarEvento(id);
        if (!fila) return;
        try {
            const evento = await cliente.evento(id);
            if (evento.id !== id || evento.event_type !== fila.tipo || !huellaEvento(evento).equals(Buffer.from(fila.huella_contenido))) throw fallo('PAYPAL_EVENTO_MODIFICADO');
            const tipo = evento.event_type;
            if (tipo.startsWith('BILLING.SUBSCRIPTION.') || ['PAYMENT.SALE.COMPLETED','PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED'].includes(tipo)) {
                const recurso = evento.resource || {};
                let local = tipo.startsWith('BILLING.SUBSCRIPTION.') ? await db.buscarRemota(recurso.id) : null;
                if (!local && identificador(recurso.billing_agreement_id)) local = await db.buscarRemota(recurso.billing_agreement_id);
                const venta = tipo === 'PAYMENT.SALE.REFUNDED' ? recurso.sale_id : recurso.id;
                if (!local && identificador(venta)) local = await db.buscarCobro(venta);
                if (!local) throw fallo('PAYPAL_EVENTO_SIN_OPERACION');
                // El evento orienta la búsqueda; no es prueba suficiente para ampliar cobertura.
                await sincronizar(local,{forzar:true});
            }
            await db.cerrarEvento(fila,null);
        } catch (e) { registrar(e); await db.cerrarEvento(fila,e); }
    }
    async function webhook(req,res) {
        try {
            listo(); const e = req.body;
            if (!e || !identificador(e.id) || typeof e.event_type !== 'string' || e.event_type.length>100
                || !identificador(e.resource?.id)) throw fallo('PAYPAL_EVENTO_INVALIDO',400);
            await cliente.firma(req.headers,e);
            await db.registrarEvento(e,huellaEvento(e));
            // El evento ya está almacenado: recuperable aunque se interrumpa el procesamiento.
            await procesarEvento(e.id);
            return res.sendStatus(200);
        } catch (e) { return responder(res,e); }
    }
    let temporizador = null, trabajando = false;
    async function recuperar() {
        if (trabajando || !cliente.config().listaParaContratar) return;
        trabajando = true;
        try {
            // Los eventos pendientes ya fueron autenticados al recibirse. Si no
            // hay webhook configurado, la reconciliación de contratos basta.
            if (cliente.config().webhook) for (const e of await db.eventosPendientes()) await procesarEvento(e.paypal_event_id);
            const enfriando = [...verificaciones].filter(([,v]) => v.promesa || v.proxima > reloj()).map(([id]) => id);
            for (const local of await db.contratosPendientes(enfriando)) {
                try {
                    if (!local.paypal_subscription_id) {
                        const creada = await cliente.crear(local);
                        if (!identificador(creada.id)) throw fallo('PAYPAL_RESPUESTA_INVALIDA',503);
                        await db.vincular(local,await cliente.suscripcion(creada.id));
                    } else await sincronizar(local);
                } catch (e) { registrar(e); }
            }
        } catch (e) { registrar(e); } finally { trabajando = false; }
    }
    function iniciarRecuperacion() {
        if (!temporizador && cliente.config().listaParaContratar) {
            temporizador = setInterval(recuperar,5000); temporizador.unref?.();
            setImmediate(recuperar);
        }
    }
    return { configuracionPublica,contratar,estado,retorno,cancelado,cancelar,notificarCompra,webhook,procesarEvento,recuperar,iniciarRecuperacion };
}
module.exports = { crearControlador };

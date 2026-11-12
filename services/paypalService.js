const { createHash, createHmac, randomUUID, timingSafeEqual } = require('node:crypto');

const BASE = 'https://api-m.sandbox.paypal.com';
const PLAN = 'P-6LK42541B10601933NLVSXCY';
const PRODUCTO = 'PROD-70S428872E529332L';
const fallo = (code, status = 409) => Object.assign(new Error(code), { code, status });
const uuid = valor => typeof valor === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
// Comprobante de intención de compra, independiente de la sesión de Express.
// Solo se emite antes de la primera activación; no concede beneficios.
function comprobanteAviso(config,local,emitido = Date.now()) {
    const datos = `${local.id_usuario}:${local.clave_operacion}:${emitido}`;
    return `${emitido}.${createHmac('sha256',config.secret).update(`aviso-compra:${datos}`).digest('hex')}`;
}
function validarComprobanteAviso(config,local,valor,ahora = Date.now()) {
    if (typeof valor !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(valor)) return false;
    const emitido = Number(valor.split('.')[0]);
    if (emitido > ahora || ahora-emitido > 7*86400000) return false;
    return timingSafeEqual(Buffer.from(valor),Buffer.from(comprobanteAviso(config,local,emitido)));
}
const identificador = valor => typeof valor === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(valor);
const estable = valor => Array.isArray(valor) ? valor.map(estable) : valor && typeof valor === 'object'
    ? Object.fromEntries(Object.keys(valor).sort().map(k => [k, estable(valor[k])])) : valor;
const huellaEvento = evento => createHash('sha256').update(JSON.stringify(estable({ id:evento.id,
    event_type:evento.event_type, create_time:evento.create_time, resource:evento.resource }))).digest();
function centavos(valor) {
    const texto = String(valor);
    if (!/^\d+(?:\.\d{1,8})?$/.test(texto)) throw fallo('PAYPAL_IMPORTE_INVALIDO');
    const [entero, fraccion = ''] = texto.split('.');
    if (/[1-9]/.test(fraccion.slice(2))) throw fallo('PAYPAL_IMPORTE_INVALIDO');
    return BigInt(entero) * 100n + BigInt(fraccion.padEnd(2,'0').slice(0,2));
}
function instante(valor) {
    if (typeof valor !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(valor)
        || !Number.isFinite(Date.parse(valor))) throw fallo('PAYPAL_FECHA_INVALIDA');
    return new Date(valor);
}
const sqlUTC = valor => instante(valor instanceof Date ? valor.toISOString() : valor).toISOString().slice(0,23).replace('T',' ');
function horaChile(valor) {
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone:'America/Santiago',
        year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' })
        .formatToParts(instante(valor instanceof Date ? valor.toISOString() : valor)).map(p => [p.type,p.value]));
    return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}:${partes.second}`;
}
function sumarMeses(ancla, meses) {
    const fecha = new Date(ancla);
    const dia = fecha.getUTCDate();
    fecha.setUTCDate(1); fecha.setUTCMonth(fecha.getUTCMonth()+meses);
    const ultimo = new Date(Date.UTC(fecha.getUTCFullYear(),fecha.getUTCMonth()+1,0)).getUTCDate();
    fecha.setUTCDate(Math.min(dia,ultimo)); return fecha;
}
function coberturaVigente(cobros, ahora = new Date()) {
    const intervalos = cobros.filter(c => ['COMPLETED','PARTIAL_REVIEW'].includes(c.estado) && c.desde && c.hasta)
        .map(c => ({ desde:instante(c.desde),hasta:instante(c.hasta) })).sort((a,b) => a.desde-b.desde);
    let cobertura = null;
    for (const i of intervalos) {
        if (!cobertura && i.desde <= ahora && i.hasta > ahora) cobertura = { ...i };
        else if (cobertura && i.desde <= cobertura.hasta && i.hasta > cobertura.hasta) cobertura.hasta = i.hasta;
    }
    return cobertura;
}
function configuracion(env = process.env) {
    const faltantes = ['PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_SANDBOX_CLIENT_SECRET','PAYPAL_SANDBOX_PLAN_ID',
        'PAYPAL_SANDBOX_BASE_URL'].filter(k => !env[k]?.trim());
    let url = null, modoLocal = false;
    try {
        url = new URL(env.PAYPAL_SANDBOX_BASE_URL);
        modoLocal = url.origin === 'http://localhost:3000' && env.NODE_ENV !== 'production';
        if ((!modoLocal && (url.protocol !== 'https:' || (url.port && url.port !== '443')))
            || url.username || url.password || url.search || url.hash || url.pathname !== '/') { url = null; modoLocal = false; }
    } catch { /* Exigir una dirección explícita; no confiar en Host/Origin del navegador. */ }
    const lista = [...faltantes];
    if (!url && !lista.includes('PAYPAL_SANDBOX_BASE_URL')) lista.push('PAYPAL_SANDBOX_BASE_URL');
    if (!modoLocal && !env.PAYPAL_SANDBOX_WEBHOOK_ID?.trim()) lista.push('PAYPAL_SANDBOX_WEBHOOK_ID');
    if (env.PAYPAL_SANDBOX_PLAN_ID && env.PAYPAL_SANDBOX_PLAN_ID !== PLAN) lista.push('PLAN_SANDBOX_NO_AUTORIZADO');
    return { lista, listaParaContratar:lista.length === 0, origen:url?.origin || null, modoLocal,
        client:env.PAYPAL_SANDBOX_CLIENT_ID, secret:env.PAYPAL_SANDBOX_CLIENT_SECRET,
        webhook:env.PAYPAL_SANDBOX_WEBHOOK_ID, plan:PLAN };
}
function csrf(config, sesion, usuario, ahora = Date.now()) {
    if (!config.secret) throw fallo('PAYPAL_CONFIGURACION_PENDIENTE',503);
    const parte = `${Math.floor(ahora/1000)+1800}.${randomUUID()}`;
    return `${parte}.${createHmac('sha256',config.secret).update(`${sesion}|${usuario}|${parte}`).digest('hex')}`;
}
function validarCsrf(config, token, sesion, usuario, ahora = Date.now()) {
    if (!config.secret || typeof token !== 'string' || !/^\d+\.[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(token)) return false;
    const [vence,nonce,firma] = token.split('.');
    if (Number(vence) < ahora/1000 || Number(vence) > ahora/1000+1801) return false;
    const esperada = createHmac('sha256',config.secret).update(`${sesion}|${usuario}|${vence}.${nonce}`).digest();
    return timingSafeEqual(esperada,Buffer.from(firma,'hex'));
}
function validarPlan(plan) {
    const ciclos = plan.billing_cycles || [], c = ciclos[0];
    if (plan.id !== PLAN || plan.product_id !== PRODUCTO || plan.status !== 'ACTIVE' || ciclos.length !== 1
        || c.tenure_type !== 'REGULAR' || c.frequency?.interval_unit !== 'MONTH'
        || Number(c.frequency?.interval_count) !== 1 || Number(c.total_cycles) !== 0
        || c.pricing_scheme?.fixed_price?.currency_code !== 'USD' || centavos(c.pricing_scheme.fixed_price.value) !== 100n
        || centavos(plan.payment_preferences?.setup_fee?.value || '0') !== 0n
        || plan.quantity_supported === true || Number(plan.taxes?.percentage || 0) !== 0) throw fallo('PAYPAL_PLAN_NO_COINCIDE');
    return true;
}
function validarSuscripcion(remota, local) {
    if (remota.id !== local.paypal_subscription_id || remota.plan_id !== PLAN || local.paypal_plan_id !== PLAN
        || remota.custom_id !== local.referencia_cliente || local.moneda !== 'USD' || centavos(local.importe) !== 100n
        || Number(remota.quantity || 1) !== 1 || !['APPROVAL_PENDING','APPROVED','ACTIVE','SUSPENDED','CANCELLED','EXPIRED'].includes(remota.status)) {
        throw fallo('PAYPAL_SUSCRIPCION_NO_COINCIDE');
    }
}
// Solo una transacción confirmada, asociada por PayPal a esta suscripción, puede aportar cobertura.
function evaluarCobros(remota, transacciones, ventas, ahora = new Date()) {
    const ciclo = remota.billing_info?.cycle_executions?.find(c => c.tenure_type === 'REGULAR');
    const completados = Number(ciclo?.cycles_completed);
    const ultima = remota.billing_info?.last_payment;
    return transacciones.map(t => {
        if (!identificador(t.id)) throw fallo('PAYPAL_TRANSACCION_INVALIDA');
        const venta = ventas.get(t.id);
        if (!venta || venta.id !== t.id || venta.billing_agreement_id !== remota.id) throw fallo('PAYPAL_COBRO_NO_VINCULADO');
        const bruto = t.amount_with_breakdown?.gross_amount;
        if (bruto?.currency_code !== 'USD' || centavos(bruto.value) !== 100n
            || venta.amount?.currency !== 'USD' || centavos(venta.amount.total) !== 100n) throw fallo('PAYPAL_COBRO_NO_COINCIDE');
        const fecha = instante(t.time);
        if (fecha > new Date(+ahora+60000)) throw fallo('PAYPAL_FECHA_INVALIDA');
        const estadoVenta = String(venta.state).toLowerCase();
        const estado = estadoVenta === 'refunded' ? 'REFUNDED' : estadoVenta === 'reversed' ? 'REVERSED'
            : estadoVenta === 'partially_refunded' ? 'PARTIAL_REVIEW'
            : estadoVenta === 'completed' && t.status === 'COMPLETED' ? 'COMPLETED' : 'UNCONFIRMED';
        const cobro = { id:t.id, moneda:'USD',importe:'1.00',estado,ocurrido:fecha.toISOString(),desde:null,hasta:null };
        if (estado === 'COMPLETED' && ultima && Number.isSafeInteger(completados) && completados > 0
            && ultima.amount?.currency_code === 'USD' && centavos(ultima.amount.value) === 100n
            && Math.abs(instante(ultima.time)-fecha) <= 60000) {
            // PayPal puede programar el próximo cobro a una hora distinta de
            // start_time. Usar su fecha verificada, sin inventar 30 días ni
            // conceder otro ciclo cuando una renovación anterior haya fallado.
            if (remota.billing_info.next_billing_time) {
                const ancla = instante(remota.start_time);
                const hasta = instante(remota.billing_info.next_billing_time);
                const inicioCiclo = sumarMeses(ancla,completados-1);
                const desde = new Date(Math.max(+fecha,+inicioCiclo));
                const limite = sumarMeses(fecha,1);
                if (hasta <= desde || hasta > new Date(+limite+2*86400000)) throw fallo('PAYPAL_COBERTURA_NO_VERIFICADA');
                cobro.desde = desde.toISOString(); cobro.hasta = hasta.toISOString();
            }
            // Si una cancelación ya eliminó next_billing_time, conservar solo
            // la cobertura previamente verificada y almacenada, nunca inferirla.
        }
        return cobro;
    });
}
function crearCliente({ env = process.env, fetchImpl = globalThis.fetch, reloj = () => Date.now() } = {}) {
    let token = null, vence = 0, obteniendo = null;
    const config = () => configuracion(env);
    async function acceso() {
        if (token && vence > reloj()+60000) return token;
        if (obteniendo) return obteniendo;
        obteniendo = (async () => {
            const c = config();
            if (!c.client || !c.secret) throw fallo('PAYPAL_CONFIGURACION_PENDIENTE',503);
            const r = await fetchImpl(`${BASE}/v1/oauth2/token`,{ method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
                headers:{ Authorization:`Basic ${Buffer.from(`${c.client}:${c.secret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded' },body:'grant_type=client_credentials' });
            const d = await r.json();
            if (!r.ok || !d.access_token || String(d.token_type).toLowerCase() !== 'bearer' || !(Number(d.expires_in)>0)) throw fallo('PAYPAL_AUTENTICACION_FALLIDA',503);
            token = d.access_token; vence = reloj()+Number(d.expires_in)*1000; return token;
        })();
        try { return await obteniendo; } finally { obteniendo = null; }
    }
    async function api(ruta,{ method='GET', body, clave } = {}) {
        if (!ruta.startsWith('/v1/') || ruta.includes('://')) throw fallo('PAYPAL_RUTA_INVALIDA');
        const headers = { Authorization:`Bearer ${await acceso()}`,Accept:'application/json' };
        if (body) headers['Content-Type'] = 'application/json';
        if (body) headers.Prefer = 'return=representation';
        if (clave) headers['PayPal-Request-Id'] = clave;
        let r;
        try { r = await fetchImpl(BASE+ruta,{ method,headers,body:body ? JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000) }); }
        catch { throw fallo('PAYPAL_NO_DISPONIBLE',503); }
        if (r.status === 401) { token = null; vence = 0; }
        if (!r.ok) {
            const detalle = await r.json().catch(() => ({}));
            const e = fallo(r.status === 404 ? 'PAYPAL_RECURSO_NO_ENCONTRADO':'PAYPAL_NO_DISPONIBLE',503);
            e.paypalHttpStatus = r.status;
            e.paypalTipo = /^[A-Z_]{1,80}$/.test(detalle.name || '') ? detalle.name : null;
            throw e;
        }
        return r.status === 204 ? {} : r.json();
    }
    const plan = async () => { const d = await api(`/v1/billing/plans/${PLAN}`); validarPlan(d); return d; };
    const suscripcion = id => { if (!identificador(id)) throw fallo('PAYPAL_ID_INVALIDO',400); return api(`/v1/billing/subscriptions/${id}`); };
    async function crear(local) {
        await plan();
        const c = config();
        if (!c.listaParaContratar) throw fallo('PAYPAL_CONFIGURACION_PENDIENTE',503);
        return api('/v1/billing/subscriptions',{ method:'POST',clave:local.clave_operacion,body:{ plan_id:PLAN,custom_id:local.referencia_cliente,
            application_context:{ brand_name:'CookIQ',shipping_preference:'NO_SHIPPING',user_action:'SUBSCRIBE_NOW',
                return_url:`${c.origen}/api/paypal/retorno?operacion=${local.clave_operacion}`,
                cancel_url:`${c.origen}/api/paypal/cancelado?operacion=${local.clave_operacion}` } } });
    }
    async function transacciones(local) {
        const resultado = [], inicio = instante(local.creadaISO), ahora = new Date(reloj());
        for (let desde = inicio, ventanas = 0; desde <= ahora; ventanas++) {
            if (ventanas > 120) throw fallo('PAYPAL_HISTORIAL_REQUIERE_REVISION');
            const hasta = new Date(Math.min(+desde+30*86400000,+ahora));
            const d = await api(`/v1/billing/subscriptions/${local.paypal_subscription_id}/transactions?start_time=${encodeURIComponent(desde.toISOString())}&end_time=${encodeURIComponent(hasta.toISOString())}`);
            if (!Array.isArray(d.transactions) || Number(d.total_pages || 1) > 1
                || Number(d.total_items || 0) > d.transactions.length) throw fallo('PAYPAL_HISTORIAL_INCOMPLETO');
            resultado.push(...d.transactions); if (+hasta === +ahora) break; desde = hasta;
        }
        return [...new Map(resultado.map(t => [t.id,t])).values()];
    }
    async function verificar(local) {
        const inicio = reloj();
        await plan();
        const trasPlan = reloj();
        const remota = await suscripcion(local.paypal_subscription_id); validarSuscripcion(remota,local);
        const trasSuscripcion = reloj();
        const recibidas = await transacciones(local);
        const trasTransacciones = reloj();
        const ts = recibidas.filter(t => ['COMPLETED','REFUNDED','PARTIALLY_REFUNDED','REVERSED'].includes(t.status)), ventas = new Map();
        for (const t of ts) {
            if (!identificador(t.id)) throw fallo('PAYPAL_TRANSACCION_INVALIDA');
            ventas.set(t.id,await api(`/v1/payments/sale/${t.id}`));
        }
        const cobros = evaluarCobros(remota,ts,ventas,new Date(reloj()));
        return { remota,cobros,diagnostico:{ recibidas:recibidas.length,
            pendientes:recibidas.filter(t => t.status === 'PENDING').length,
            completadas:cobros.filter(c => c.estado === 'COMPLETED').length,
            conCobertura:cobros.filter(c => c.desde && c.hasta).length,
            planMs:trasPlan-inicio,suscripcionMs:trasSuscripcion-trasPlan,
            transaccionesMs:trasTransacciones-trasSuscripcion,detalleCobrosMs:reloj()-trasTransacciones } };
    }
    async function firma(headers,evento) {
        const c = config();
        if (!c.webhook) throw fallo('PAYPAL_CONFIGURACION_PENDIENTE',503);
        const campos = {auth_algo:'paypal-auth-algo',cert_url:'paypal-cert-url',transmission_id:'paypal-transmission-id',
            transmission_sig:'paypal-transmission-sig',transmission_time:'paypal-transmission-time'};
        const body = { webhook_id:c.webhook,webhook_event:evento };
        for (const [k,h] of Object.entries(campos)) {
            if (typeof headers[h] !== 'string' || !headers[h] || headers[h].length > 2048) throw fallo('PAYPAL_FIRMA_INVALIDA',400);
            body[k] = headers[h];
        }
        let certificado;
        try { certificado = new URL(body.cert_url); } catch { throw fallo('PAYPAL_FIRMA_INVALIDA',400); }
        if (certificado.protocol !== 'https:' || !['api.paypal.com','api.sandbox.paypal.com','api-m.sandbox.paypal.com'].includes(certificado.hostname)
            || !certificado.pathname.startsWith('/v1/notifications/certs/') || certificado.username || certificado.password) throw fallo('PAYPAL_FIRMA_INVALIDA',400);
        const d = await api('/v1/notifications/verify-webhook-signature',{method:'POST',body});
        if (d.verification_status !== 'SUCCESS') throw fallo('PAYPAL_FIRMA_INVALIDA',400);
    }
    const evento = id => { if (!identificador(id)) throw fallo('PAYPAL_EVENTO_INVALIDO',400); return api(`/v1/notifications/webhooks-events/${id}`); };
    const cancelar = id => { if (!identificador(id)) throw fallo('PAYPAL_ID_INVALIDO',400); return api(`/v1/billing/subscriptions/${id}/cancel`,{method:'POST',body:{reason:'Cancelación solicitada por el titular desde CookIQ Sandbox.'}}); };
    return { config,api,plan,suscripcion,crear,verificar,firma,evento,cancelar };
}
function enlaceAprobacion(remota) {
    const link = remota.links?.find(l => l.rel === 'approve')?.href;
    if (!link) return null;
    const u = new URL(link);
    if (u.protocol !== 'https:' || u.hostname !== 'www.sandbox.paypal.com' || u.username || u.password || (u.port && u.port !== '443')) throw fallo('PAYPAL_ENLACE_INVALIDO');
    return u.href;
}
module.exports = { BASE,PLAN,PRODUCTO,fallo,uuid,identificador,centavos,instante,sqlUTC,horaChile,coberturaVigente,
    configuracion,csrf,validarCsrf,validarPlan,validarSuscripcion,evaluarCobros,crearCliente,enlaceAprobacion,huellaEvento,
    comprobanteAviso,validarComprobanteAviso };

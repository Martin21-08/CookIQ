const { randomBytes, timingSafeEqual } = require('node:crypto');
const modelo = require('../models/registroModel');
const fallo = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
function normalizarIds(valor) {
    if (!Array.isArray(valor) || valor.length > 200) throw fallo('La selección de preferencias no es válida.');
    const ids = valor.map(id => {
        if (!(typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)))) throw fallo('La selección contiene un identificador inválido.');
        const numero = Number(id);
        if (!Number.isSafeInteger(numero) || numero <= 0) throw fallo('La selección contiene un identificador inválido.');
        return numero;
    });
    return [...new Set(ids)];
}
function crearServicio({ persistir = modelo.crearConPreferencias, reloj = () => Date.now(), programar = setTimeout } = {}) {
    const pendientes = new Map();
    const caducidad = 15 * 60 * 1000;
    function obtener(req) {
        const token = req.session?.registroPendiente;
        const p = pendientes.get(token);
        if (!p || p.sesion !== req.sessionID || p.vence <= reloj()) {
            if (p?.vence <= reloj()) pendientes.delete(token);
            if (req.session) delete req.session.registroPendiente;
            return null;
        }
        return p;
    }
    function preparar(req, tipo, datos) {
        if (req.session.usuario) throw fallo('Cierra tu sesión antes de registrar otra cuenta.', 409);
        const anterior = obtener(req);
        if (anterior?.promesa) throw fallo('El registro se está guardando. Espera un momento.', 409);
        if (anterior) pendientes.delete(anterior.token);
        const token = randomBytes(32).toString('hex');
        const p = { token, tipo, datos, sesion:req.sessionID, vence:reloj()+caducidad };
        pendientes.set(token, p);
        req.session.registroPendiente = token;
        programar(() => { pendientes.delete(token); }, caducidad).unref?.();
        return { ok:true, pendiente:true, token, tipo, vence:p.vence, revision:0 };
    }
    function estado(req) {
        const p = obtener(req);
        return p ? { ok:true, pendiente:!p.completado, completado:Boolean(p.completado), token:p.token, tipo:p.tipo, revision:p.revision || 0, seleccion:p.seleccion || {alergias:[],intolerancias:[]} }
            : { ok:true, pendiente:false };
    }
    function autorizado(req) {
        const p = obtener(req), recibido = req.body?.token;
        if (!p || typeof recibido !== 'string' || !/^[a-f0-9]{64}$/.test(recibido)
            || !timingSafeEqual(Buffer.from(p.token), Buffer.from(recibido))) throw fallo('El registro pendiente venció o no corresponde a esta sesión. Vuelve a completar tus datos.', 403);
        return p;
    }
    function guardarBorrador(req) {
        const p = autorizado(req);
        if (p.completado || p.promesa) return {ok:true};
        const revision = req.body.revision;
        if (!Number.isSafeInteger(revision) || revision <= 0) throw fallo('La revisión del borrador no es válida.');
        if (revision <= (p.revision || 0)) return {ok:true};
        p.seleccion = { alergias:normalizarIds(req.body.alergias), intolerancias:normalizarIds(req.body.intolerancias) };
        p.revision = revision;
        return {ok:true};
    }
    async function finalizar(req) {
        const p = autorizado(req);
        if (p.completado) return p.completado;
        if (req.session.usuario) throw fallo('Cierra tu sesión antes de finalizar otra cuenta.', 409);
        if (p.promesa) return p.promesa;
        p.seleccion = { alergias:normalizarIds(req.body.alergias), intolerancias:normalizarIds(req.body.intolerancias) };
        if (req.body.revision !== undefined) {
            if (!Number.isSafeInteger(req.body.revision) || req.body.revision <= 0) throw fallo('La revisión del registro no es válida.');
            p.revision = Math.max(p.revision || 0, req.body.revision);
        }
        p.promesa = Promise.resolve().then(async () => {
            try {
                await persistir(p.tipo, p.datos, p.seleccion);
                p.completado = { ok:true, redirect:'/usuarios/login' };
                delete p.datos; // No conservar el hash ni los datos después del commit.
                return p.completado;
            } finally { p.promesa = null; }
        });
        return p.promesa;
    }
    function marcarNotificado(req) {
        const p = obtener(req);
        if (!p?.completado || p.notificado) return false;
        p.notificado = true; return true;
    }
    return { preparar, estado, finalizar, guardarBorrador, marcarNotificado };
}
module.exports = { ...crearServicio(), crearServicio, normalizarIds };

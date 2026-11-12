const { randomBytes, createHash } = require('crypto');
const pendientes = new Map();
const vigencia = 5 * 60 * 1000;

const huella = datos => createHash('sha256').update(JSON.stringify(datos)).digest('hex');
const emitir = (sesion, datos, conflictos) => {
    const ahora = Date.now();
    for (const [token, entrada] of pendientes) {
        if (entrada.expira <= ahora || entrada.sesion === sesion) pendientes.delete(token);
    }
    // Límite de memoria; una confirmación desplazada deberá solicitarse de nuevo.
    if (pendientes.size >= 1000) pendientes.delete(pendientes.keys().next().value);
    const token = randomBytes(32).toString('hex');
    pendientes.set(token, { sesion, huella: huella(datos), conflictos, expira: ahora + vigencia });
    return token;
};

const consumir = (token, sesion, datos) => {
    if (typeof token !== 'string') return null;
    const entrada = pendientes.get(token);
    if (!entrada || entrada.sesion !== sesion) return null;
    pendientes.delete(token);
    if (entrada.expira <= Date.now() || entrada.huella !== huella(datos)) return null;
    return entrada.conflictos;
};

module.exports = { emitir, consumir };

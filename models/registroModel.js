const db = require('../config/db');
const usuarios = require('./userModel');
const google = require('./firebaseModel');
const preferencias = require('./preferenciasModel');
const catalogos = require('./catalogomodel');

async function crearConPreferencias(tipo, datos, seleccion) {
    const conexion = await db.getConnection();
    try {
        await conexion.beginTransaction();
        const alergias = await catalogos.obtenerAlergias(conexion);
        const intolerancias = await catalogos.obtenerIntolerancias(conexion);
        for (const [ids, filas, columna] of [[seleccion.alergias, alergias, 'id_alergia'], [seleccion.intolerancias, intolerancias, 'id_intolerancia']]) {
            const permitidos = new Set(filas.map(fila => Number(fila[columna])));
            if (ids.some(id => !permitidos.has(id))) throw Object.assign(new Error('Selecciona opciones vigentes del catálogo.'), { status:400 });
        }
        const id = tipo === 'google'
            ? (await google.crearUsuarioGoogle(datos, conexion)).id_usuario
            : await usuarios.crearUsuario(datos, conexion);
        await preferencias.guardarPreferencias(id, seleccion.alergias, seleccion.intolerancias, conexion);
        await conexion.commit();
        return id;
    } catch (error) {
        try { await conexion.rollback(); } catch { /* Conservar el fallo original. */ }
        throw error;
    } finally { conexion.release(); }
}
module.exports = { crearConPreferencias };

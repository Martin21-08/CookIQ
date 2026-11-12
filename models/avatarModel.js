const db = require('../config/db');
const obtener = async id => {
    const [filas] = await db.execute('SELECT correo, foto_perfil_ruta FROM usuario WHERE id_usuario = ?', [id]);
    return filas[0] || null;
};
const actualizar = async (id, archivo) => {
    const conexion = await db.getConnection();
    try {
        await conexion.beginTransaction();
        const [filas] = await conexion.execute('SELECT foto_perfil_ruta FROM usuario WHERE id_usuario = ? FOR UPDATE', [id]);
        if (!filas.length) throw Object.assign(new Error('Usuario inexistente.'), { code: 'AVATAR_USER_NOT_FOUND' });
        await conexion.execute('UPDATE usuario SET foto_perfil_ruta = ? WHERE id_usuario = ?', [archivo, id]);
        await conexion.commit();
        return filas[0].foto_perfil_ruta;
    } catch (error) { await conexion.rollback(); throw error; }
    finally { conexion.release(); }
};
module.exports = { obtener, actualizar };

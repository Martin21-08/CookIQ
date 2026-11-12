const db = require('../config/db');

// La misma política de acceso que utilizan las recetas de favoritos.
const conRecetaAccesible = async (idUsuario, idReceta, operacion) => {
    const conexion = await db.getConnection();
    try {
        await conexion.beginTransaction();
        const [recetas] = await conexion.execute(
            `SELECT r.id_receta FROM receta r
             WHERE r.id_receta = ? AND (
                 (r.id_usuario = ? AND r.estado NOT IN ('rechazada', 'archivada'))
                 OR (r.visibilidad = 'publica' AND r.estado IN ('validada', 'publicada'))
             ) FOR SHARE`,
            [idReceta, idUsuario]
        );
        if (!recetas.length) throw Object.assign(new Error('Receta no accesible'), { code: 'RECIPE_NOT_FOUND' });
        const resultado = await operacion(conexion);
        await conexion.commit();
        return resultado;
    } catch (error) {
        try { await conexion.rollback(); } catch { /* conserva el error original */ }
        throw error;
    } finally {
        conexion.release();
    }
};

const seleccionar = async (conexion, idUsuario, idReceta, soloPropia = false) => {
    const [filas] = await conexion.execute(
        `SELECT r.id_resena, r.id_receta, r.estrellas, r.comentario, r.fecha_resena,
                u.nombres AS autor, (r.id_usuario = ?) AS propia
         FROM resena r INNER JOIN usuario u ON u.id_usuario = r.id_usuario
         WHERE r.id_receta = ? ${soloPropia ? 'AND r.id_usuario = ?' : ''}
         ORDER BY r.fecha_resena DESC, r.id_resena DESC`,
        soloPropia ? [idUsuario, idReceta, idUsuario] : [idUsuario, idReceta]
    );
    return filas.map(fila => ({ ...fila, propia: Number(fila.propia) === 1 }));
};

module.exports = {
    obtener: (idUsuario, idReceta) => conRecetaAccesible(idUsuario, idReceta,
        conexion => seleccionar(conexion, idUsuario, idReceta)),

    guardar: (idUsuario, idReceta, estrellas, comentario) => conRecetaAccesible(idUsuario, idReceta, async conexion => {
        // UNIQUE(id_usuario, id_receta) evita duplicados incluso con solicitudes simultáneas.
        await conexion.execute(
            `INSERT INTO resena (id_usuario, id_receta, estrellas, comentario)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE estrellas = VALUES(estrellas),
                 comentario = VALUES(comentario), fecha_resena = CURRENT_TIMESTAMP`,
            [idUsuario, idReceta, estrellas, comentario]
        );
        const filas = await seleccionar(conexion, idUsuario, idReceta, true);
        return filas[0];
    }),

    eliminar: (idUsuario, idReceta) => conRecetaAccesible(idUsuario, idReceta, async conexion => {
        const [resultado] = await conexion.execute(
            'DELETE FROM resena WHERE id_usuario = ? AND id_receta = ?',
            [idUsuario, idReceta]
        );
        return resultado.affectedRows > 0;
    })
};

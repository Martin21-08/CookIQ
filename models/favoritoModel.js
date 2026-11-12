const pool = require('../config/db');

const validarId = id => Number.isSafeInteger(id) && id > 0;

const condicionAcceso = `
  ((r.id_usuario = ? AND r.estado NOT IN ('rechazada', 'archivada'))
   OR (r.visibilidad = 'publica' AND r.estado IN ('validada', 'publicada')))
`;

const FavoritoModel = {
  obtenerPorUsuario: async idUsuario => {
    if (!validarId(idUsuario)) throw new Error('INVALID_USER_ID');

    const [recetas] = await pool.execute(
      `SELECT f.id_receta AS idReceta, r.nombre, r.descripcion,
              r.minutos_preparacion AS tiempo,
              r.cantidad_porciones AS porciones,
              r.imagen_url AS imagenUrl, d.nombre AS dificultad,
              f.fecha_agregado AS fechaAgregado
       FROM favorito f
       INNER JOIN receta r ON r.id_receta = f.id_receta
       LEFT JOIN dificultad d ON d.id_dificultad = r.id_dificultad
       WHERE f.id_usuario = ? AND ${condicionAcceso}
       ORDER BY f.fecha_agregado DESC, f.id_receta DESC`,
      [idUsuario, idUsuario]
    );

    if (!recetas.length) return recetas;
    const ids = recetas.map(receta => receta.idReceta);
    const marcadores = ids.map(() => '?').join(', ');
    const [pasos] = await pool.execute(
      `SELECT id_receta AS idReceta, descripcion
       FROM paso_receta
       WHERE id_receta IN (${marcadores})
       ORDER BY id_receta, numero_paso`,
      ids
    );
    const [ingredientes] = await pool.execute(
      `SELECT ri.id_receta AS idReceta, ri.cantidad, ri.indicacion,
              i.nombre, u.abreviatura AS unidadAbreviatura,
              u.nombre AS unidadNombre
       FROM receta_ingrediente ri
       INNER JOIN ingrediente i ON i.id_ingrediente = ri.id_ingrediente
       LEFT JOIN unidad_medida u ON u.id_unidad = ri.id_unidad
       WHERE ri.id_receta IN (${marcadores})
       ORDER BY ri.id_receta, i.nombre`,
      ids
    );

    const pasosPorReceta = new Map();
    pasos.forEach(paso => {
      const lista = pasosPorReceta.get(paso.idReceta) || [];
      lista.push(paso.descripcion);
      pasosPorReceta.set(paso.idReceta, lista);
    });
    const ingredientesPorReceta = new Map();
    ingredientes.forEach(ingrediente => {
      const lista = ingredientesPorReceta.get(ingrediente.idReceta) || [];
      lista.push({
        nombre: ingrediente.nombre,
        cantidad: ingrediente.cantidad,
        unidad: ingrediente.unidadAbreviatura || ingrediente.unidadNombre || null,
        indicacion: ingrediente.indicacion
      });
      ingredientesPorReceta.set(ingrediente.idReceta, lista);
    });

    return recetas.map(receta => ({
      ...receta,
      pasos: pasosPorReceta.get(receta.idReceta) || [],
      ingredientes: ingredientesPorReceta.get(receta.idReceta) || []
    }));
  },

  obtenerEstado: async (idUsuario, idReceta) => {
    if (!validarId(idUsuario) || !validarId(idReceta)) throw new Error('INVALID_ID');
    const [filas] = await pool.execute(
      `SELECT EXISTS (
         SELECT 1
         FROM favorito f
         WHERE f.id_usuario = ? AND f.id_receta = r.id_receta
       ) AS favorito
       FROM receta r
       WHERE r.id_receta = ? AND ${condicionAcceso}
       LIMIT 1`,
      [idUsuario, idReceta, idUsuario]
    );
    if (!filas.length) return null;
    return Number(filas[0].favorito) === 1;
  },

  agregar: async (idUsuario, idReceta) => {
    if (!validarId(idUsuario) || !validarId(idReceta)) throw new Error('INVALID_ID');
    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      const [recetas] = await conexion.execute(
        `SELECT r.id_receta
         FROM receta r
         WHERE r.id_receta = ? AND ${condicionAcceso}
         FOR UPDATE`,
        [idReceta, idUsuario]
      );
      if (!recetas.length) {
        await conexion.rollback();
        return { accesible: false, existente: false };
      }

      const [favoritosExistentes] = await conexion.execute(
        'SELECT id_receta FROM favorito WHERE id_usuario = ? AND id_receta = ? FOR UPDATE',
        [idUsuario, idReceta]
      );
      if (favoritosExistentes.length) {
        await conexion.commit();
        return { accesible: true, existente: true };
      }

      await conexion.execute(
        'INSERT INTO favorito (id_usuario, id_receta) VALUES (?, ?)',
        [idUsuario, idReceta]
      );
      await conexion.commit();
      return { accesible: true, existente: false };
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva el error original */ }
      throw error;
    } finally {
      conexion.release();
    }
  },

  eliminar: async (idUsuario, idReceta) => {
    if (!validarId(idUsuario) || !validarId(idReceta)) throw new Error('INVALID_ID');
    const [resultado] = await pool.execute(
      'DELETE FROM favorito WHERE id_usuario = ? AND id_receta = ?',
      [idUsuario, idReceta]
    );
    return resultado.affectedRows > 0;
  }
};

module.exports = FavoritoModel;

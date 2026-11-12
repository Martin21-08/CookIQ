const pool = require('../config/db');

const HistorialModel = {
  registrarBusqueda: async ({ idUsuario, textoBusqueda, dificultadSolicitada, minutosMaximos, porciones }) => {
    if (!Number.isInteger(idUsuario) || idUsuario < 1) {
      throw new Error('La sesión contiene un identificador de usuario inválido.');
    }

    // "Todas" no representa una fila del catálogo: se almacena como NULL,
    // permitido por la FK id_dificultad y su acción ON DELETE SET NULL.
    let idDificultad = null;
    if (dificultadSolicitada && dificultadSolicitada !== 'Todas') {
      const [filas] = await pool.execute(
        'SELECT id_dificultad FROM dificultad WHERE nombre = ? LIMIT 1',
        [dificultadSolicitada]
      );
      if (!filas.length) throw new Error('No existe la dificultad solicitada en el catálogo.');
      idDificultad = filas[0].id_dificultad;
    }

    const [resultado] = await pool.execute(
      `INSERT INTO historial_busqueda
        (id_usuario, texto_busqueda, id_dificultad, minutos_maximos, cantidad_porciones)
       VALUES (?, ?, ?, ?, ?)`,
      [idUsuario, textoBusqueda || null, idDificultad, minutosMaximos, porciones]
    );
    return resultado.insertId;
  },

  obtenerPorUsuario: async idUsuario => {
    const [filas] = await pool.execute(
      `SELECT h.id_busqueda, h.texto_busqueda, h.id_dificultad,
              d.nombre AS dificultad, h.minutos_maximos,
              h.cantidad_porciones, h.fecha_busqueda
       FROM historial_busqueda h
       LEFT JOIN dificultad d ON d.id_dificultad = h.id_dificultad
       WHERE h.id_usuario = ?
       ORDER BY h.fecha_busqueda DESC, h.id_busqueda DESC`,
      [idUsuario]
    );
    return filas;
  },

  eliminarPorUsuario: async idUsuario => {
    if (!Number.isInteger(idUsuario) || idUsuario < 1) {
      throw new Error('El identificador del usuario no es válido.');
    }

    const [resultado] = await pool.execute(
      'DELETE FROM historial_busqueda WHERE id_usuario = ?',
      [idUsuario]
    );
    return resultado.affectedRows;
  },

  eliminarBusquedaPorUsuario: async (idUsuario, idBusqueda) => {
    if (!Number.isInteger(idUsuario) || idUsuario < 1 || !Number.isInteger(idBusqueda) || idBusqueda < 1) {
      throw new Error('El identificador del usuario o de la búsqueda no es válido.');
    }

    const [resultado] = await pool.execute(
      'DELETE FROM historial_busqueda WHERE id_busqueda = ? AND id_usuario = ?',
      [idBusqueda, idUsuario]
    );
    return resultado.affectedRows > 0;
  },

  eliminarRecetaVistaPorUsuario: async (idUsuario, idHistorial) => {
    if (!Number.isInteger(idUsuario) || idUsuario < 1 || !Number.isInteger(idHistorial) || idHistorial < 1) {
      throw new Error('El identificador del usuario o de la receta vista no es válido.');
    }

    const [resultado] = await pool.execute(
      `DELETE FROM historial_receta
       WHERE id_historial = ? AND id_usuario = ? AND tipo_interaccion = 'vista'`,
      [idHistorial, idUsuario]
    );
    return resultado.affectedRows > 0;
  },

  registrarRecetaVista: async (idUsuario, idReceta) => {
    if (!Number.isInteger(idUsuario) || idUsuario < 1 || !Number.isInteger(idReceta) || idReceta < 1) {
      throw new Error('El identificador del usuario o de la receta no es v\u00e1lido.');
    }

    const [resultado] = await pool.execute(
      `INSERT INTO historial_receta (id_usuario, id_receta, tipo_interaccion)
       SELECT ?, r.id_receta, 'vista'
       FROM receta r
       WHERE r.id_receta = ? AND r.id_usuario = ?`,
      [idUsuario, idReceta, idUsuario]
    );
    return resultado.affectedRows > 0;
  },

  obtenerRecetasVistasPorUsuario: async idUsuario => {
    if (!Number.isInteger(idUsuario) || idUsuario < 1) {
      throw new Error('El identificador del usuario no es v\u00e1lido.');
    }

    const [recetas] = await pool.execute(
      `SELECT h.id_historial, h.id_receta, h.fecha_interaccion,
              r.nombre, r.descripcion, r.minutos_preparacion AS minutosPreparacion,
              r.cantidad_porciones AS porciones, r.imagen_url AS imagenUrl,
              d.nombre AS dificultad
       FROM historial_receta h
       INNER JOIN receta r ON r.id_receta = h.id_receta
       LEFT JOIN dificultad d ON d.id_dificultad = r.id_dificultad
       WHERE h.id_usuario = ? AND h.tipo_interaccion = 'vista'
       ORDER BY h.fecha_interaccion DESC, h.id_historial DESC`,
      [idUsuario]
    );

    if (!recetas.length) return recetas;

    const idsRecetas = [...new Set(recetas.map(receta => receta.id_receta))];
    const marcadores = idsRecetas.map(() => '?').join(', ');
    const [pasos] = await pool.execute(
      `SELECT id_receta, descripcion
       FROM paso_receta
       WHERE id_receta IN (${marcadores})
       ORDER BY id_receta, numero_paso`,
      idsRecetas
    );
    const [ingredientes] = await pool.execute(
      `SELECT ri.id_receta, ri.cantidad, ri.indicacion,
              i.nombre, u.abreviatura AS unidadAbreviatura, u.nombre AS unidadNombre
       FROM receta_ingrediente ri
       INNER JOIN ingrediente i ON i.id_ingrediente = ri.id_ingrediente
       LEFT JOIN unidad_medida u ON u.id_unidad = ri.id_unidad
       WHERE ri.id_receta IN (${marcadores})
       ORDER BY ri.id_receta, i.nombre`,
      idsRecetas
    );

    const pasosPorReceta = new Map();
    pasos.forEach(paso => {
      const lista = pasosPorReceta.get(paso.id_receta) || [];
      lista.push(paso.descripcion);
      pasosPorReceta.set(paso.id_receta, lista);
    });
    const ingredientesPorReceta = new Map();
    ingredientes.forEach(ingrediente => {
      const lista = ingredientesPorReceta.get(ingrediente.id_receta) || [];
      lista.push({
        nombre: ingrediente.nombre,
        cantidad: ingrediente.cantidad,
        unidad: ingrediente.unidadAbreviatura || ingrediente.unidadNombre || '',
        indicacion: ingrediente.indicacion
      });
      ingredientesPorReceta.set(ingrediente.id_receta, lista);
    });

    return recetas.map(receta => ({
      ...receta,
      tiempo: receta.minutosPreparacion,
      icono: '\ud83c\udf7d\ufe0f',
      pasos: pasosPorReceta.get(receta.id_receta) || [],
      ingredientes: ingredientesPorReceta.get(receta.id_receta) || []
    }));
  },

  eliminarHistorialCompletoPorUsuario: async idUsuario => {
    if (!Number.isInteger(idUsuario) || idUsuario < 1) {
      throw new Error('El identificador del usuario no es v\u00e1lido.');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [busquedas] = await connection.execute(
        'DELETE FROM historial_busqueda WHERE id_usuario = ?',
        [idUsuario]
      );
      const [recetas] = await connection.execute(
        `DELETE FROM historial_receta
         WHERE id_usuario = ? AND tipo_interaccion = 'vista'`,
        [idUsuario]
      );
      await connection.commit();
      return {
        busquedasEliminadas: busquedas.affectedRows,
        recetasEliminadas: recetas.affectedRows
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserva el error original si falla el rollback.
      }
      throw error;
    } finally {
      connection.release();
    }
  }
};

module.exports = HistorialModel;

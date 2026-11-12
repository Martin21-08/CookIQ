const pool = require('../config/db'); // Ajusta la ruta si es necesario para llegar a tu db.js
const ingredienteModel = require('./ingredienteModel');
const solicitudGeneracionModel = require('./solicitudGeneracionModel');
const { normalizarRecetaCulinaria, identidadCompuestaAmbigua } = require('../services/ingredientesCulinariosService');

const normalizarTexto = valor => String(valor || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const aliasUnidades = {
  g: 'gramo', gramos: 'gramo', gr: 'gramo',
  kg: 'kilogramo', kilos: 'kilogramo', kilogramos: 'kilogramo',
  ml: 'mililitro', mililitros: 'mililitro',
  l: 'litro', litros: 'litro',
  un: 'unidad', u: 'unidad', unidades: 'unidad',
  tazas: 'taza',
  cda: 'cucharada', cdas: 'cucharada', cucharadas: 'cucharada',
  cdta: 'cucharadita', cdtas: 'cucharadita', cucharaditas: 'cucharadita'
};

const buscarUnidad = (unidades, valor) => {
  const normalizada = normalizarTexto(valor);
  const nombreCanonico = aliasUnidades[normalizada] || normalizada;
  return unidades.find(unidad => (
    normalizarTexto(unidad.nombre) === nombreCanonico ||
    normalizarTexto(unidad.abreviatura) === normalizada
  )) || null;
};

const RecetaModel = {
  // 1. Crear una nueva receta
  crear: async (datosReceta) => {
    const { titulo, descripcion, tiempo_preparacion, porciones, usuario_id } = datosReceta;
    const query = `
      INSERT INTO recetas (titulo, descripcion, tiempo_preparacion, porciones, usuario_id)
      VALUES (?, ?, ?, ?, ?)
    `;
    const [resultado] = await pool.execute(query, [titulo, descripcion, tiempo_preparacion, porciones, usuario_id]);
    return resultado.insertId; // Retorna el ID de la receta recién creada
  },

  // 2. Obtener todas las recetas
  obtenerTodas: async () => {
    const query = 'SELECT * FROM recetas';
    const [filas] = await pool.execute(query);
    return filas;
  },

  // 3. Obtener una receta específica por su ID
  obtenerPorId: async (id) => {
    const query = 'SELECT * FROM recetas WHERE id = ?';
    const [filas] = await pool.execute(query, [id]);
    return filas[0] || null; // Retorna la receta o null si no existe
  },

  // 4. Actualizar una receta
  actualizar: async (id, datosActualizados) => {
    const { titulo, descripcion, tiempo_preparacion, porciones } = datosActualizados;
    const query = `
      UPDATE recetas 
      SET titulo = ?, descripcion = ?, tiempo_preparacion = ?, porciones = ?
      WHERE id = ?
    `;
    const [resultado] = await pool.execute(query, [titulo, descripcion, tiempo_preparacion, porciones, id]);
    return resultado.affectedRows > 0;
  },

  // 5. Eliminar una receta
  eliminar: async (id) => {
    const query = 'DELETE FROM recetas WHERE id = ?';
    const [resultado] = await pool.execute(query, [id]);
    return resultado.affectedRows > 0;
  },

  // Persiste recetas generadas por OpenAI y todas sus relaciones en el esquema actual.
  guardarGeneradas: async (recetas, { idUsuario = null, dificultadSolicitada, minutosMaximos, porciones, signal, idSolicitud = null }) => {
    const comprobarCancelacion = () => {
      if (!signal?.aborted) return;
      const error = new Error('La solicitud fue cancelada.');
      error.name = 'AbortError';
      throw error;
    };
    comprobarCancelacion();
    const connection = await pool.getConnection();
    let transaccionIniciada = false;
    const idsRecetas = [];
    try {
      comprobarCancelacion();
      if (idSolicitud !== null) await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();
      transaccionIniciada = true;
      if (idSolicitud !== null) await solicitudGeneracionModel.prepararConfirmacion(connection, idSolicitud, idUsuario);

      if (idUsuario !== null && (!Number.isInteger(idUsuario) || idUsuario < 1)) {
        throw new Error('La sesión contiene un identificador de usuario inválido.');
      }
      let dificultadSolicitadaId = null;
      if (dificultadSolicitada && dificultadSolicitada !== 'Todas') {
        const [dificultades] = await connection.execute(
          'SELECT id_dificultad FROM dificultad WHERE nombre = ? LIMIT 1',
          [dificultadSolicitada]
        );
        if (!dificultades.length) throw new Error('No existe la dificultad solicitada en el catálogo.');
        dificultadSolicitadaId = dificultades[0].id_dificultad;
      }
      const [unidades] = await connection.execute(
        'SELECT id_unidad, nombre, abreviatura, familia FROM unidad_medida'
      );
      for (const original of recetas) {
        const receta = normalizarRecetaCulinaria(original);
        comprobarCancelacion();
        const [dificultadesReceta] = await connection.execute(
          'SELECT id_dificultad FROM dificultad WHERE nombre = ? LIMIT 1',
          [receta.dificultad]
        );
        if (!dificultadesReceta.length) throw new Error('La dificultad generada no existe en el catálogo.');

        const [resultadoReceta] = await connection.execute(
          `INSERT INTO receta
            (id_usuario, nombre, descripcion, id_dificultad, minutos_preparacion,
             cantidad_porciones, origen, generada_por_ia, visibilidad, estado, imagen_url)
           VALUES (?, ?, ?, ?, ?, ?, 'ia', 1, 'privada', 'generada', ?)`,
          [
            idUsuario,
            receta.nombre,
            receta.descripcion || null,
            dificultadesReceta[0].id_dificultad,
            Number(receta.minutosPreparacion),
            Number(receta.porciones),
            receta.imagenUrl || null
          ]
        );
        const idReceta = resultadoReceta.insertId;
        idsRecetas.push(idReceta);

        let idGeneracion = null;
        if (idUsuario !== null) {
          const [resultadoGeneracion] = await connection.execute(
            `INSERT INTO generacion_ia
              (id_usuario, id_receta, tipo, modelo, dificultad_solicitada,
               minutos_maximos_solicitados, porciones_solicitadas, estado)
             VALUES (?, ?, 'generada_nueva', 'gpt-4o-mini', ?, ?, ?, 'exito')`,
            [idUsuario, idReceta, dificultadSolicitadaId, minutosMaximos, porciones]
          );
          idGeneracion = resultadoGeneracion.insertId;
        }

        for (let indice = 0; indice < receta.pasos.length; indice += 1) {
          await connection.execute(
            'INSERT INTO paso_receta (id_receta, numero_paso, descripcion) VALUES (?, ?, ?)',
            [idReceta, indice + 1, receta.pasos[indice]]
          );
        }

        const ingredientesPorId = new Map();
        for (const ingrediente of receta.ingredientes) {
          const nombre = String(ingrediente.nombre || '').trim().replace(/\s+/g, ' ');
          if (!nombre) throw new Error('Una receta contiene un ingrediente sin nombre.');
          const unidad = buscarUnidad(unidades, ingrediente.unidad);
          const cualitativo = ingrediente.cantidad === null && ingrediente.unidad === null
            && typeof ingrediente.indicacion === 'string' && ingrediente.indicacion.trim();
          if (ingrediente.indicacion != null && (typeof ingrediente.indicacion !== 'string' || ingrediente.indicacion.length > 255)) {
            throw new Error('La indicación culinaria debe tener como máximo 255 caracteres.');
          }
          if (!cualitativo && (!unidad || !Number.isFinite(Number(ingrediente.cantidad)) || Number(ingrediente.cantidad) <= 0)) {
            throw Object.assign(new Error('La unidad generada no existe en el catálogo de medidas.'), {
              code: 'INGREDIENT_UNIT_UNKNOWN', appCode: 'INGREDIENT_CLASSIFICATION_FAILED',
              ingrediente: nombre, unidad: ingrediente.unidad, tipoAlimento: ingrediente.tipoAlimento
            });
          }
          const familia = cualitativo ? null : unidad.familia;
          let ingredienteCatalogo;
          try {
            if (identidadCompuestaAmbigua(nombre) && !await ingredienteModel.buscarManualPorNombre(connection, nombre)) {
              throw Object.assign(new Error('No se pudo identificar la expresión culinaria sin ambigüedad.'), { code: 'INGREDIENT_NAME_AMBIGUOUS' });
            }
            ingredienteCatalogo = await ingredienteModel.resolverOCrearIATransaccional(connection, {
              nombre,
              familia,
              tipoAlimento: ingrediente.tipoAlimento,
              conservarMedidaReceta: true
            });
          } catch (error) {
            if (!error.appCode) error.appCode = 'INGREDIENT_CATALOG_INSERT_FAILED';
            error.ingrediente = nombre;
            error.tipoAlimento = ingrediente.tipoAlimento;
            error.unidad = ingrediente.unidad;
            throw error;
          }
          const idIngrediente = ingredienteCatalogo.id_ingrediente;
          const dato = {
            cantidad: cualitativo ? null : Number(ingrediente.cantidad),
            unidad,
            indicacion: ingrediente.indicacion || null,
            unidadOriginal: String(ingrediente.unidad || '').trim()
          };
          const grupo = ingredientesPorId.get(idIngrediente) || [];
          grupo.push(dato);
          ingredientesPorId.set(idIngrediente, grupo);
        }

        for (const [idIngrediente, grupo] of ingredientesPorId) {
          const unidadUnica = grupo[0].unidad;
          const mismaUnidad = Boolean(unidadUnica) && grupo.every(dato => dato.cantidad !== null && dato.unidad?.id_unidad === unidadUnica.id_unidad);
          const cantidad = mismaUnidad ? grupo.reduce((total, dato) => total + dato.cantidad, 0) : null;
          const indicacion = grupo.map(dato => [
            !mismaUnidad && dato.cantidad !== null ? `${dato.cantidad} ${dato.unidadOriginal}`.trim() : '',
            dato.indicacion
          ].filter(Boolean).join(' ')).filter(Boolean).join('; ') || null;
          if (indicacion && indicacion.length > 255) throw new Error('Las indicaciones culinarias combinadas superan 255 caracteres.');

          await connection.execute(
            `INSERT INTO receta_ingrediente (id_receta, id_ingrediente, cantidad, id_unidad, indicacion)
             VALUES (?, ?, ?, ?, ?)`,
            [idReceta, idIngrediente, cantidad, mismaUnidad ? unidadUnica.id_unidad : null, indicacion]
          );

          if (idGeneracion !== null) {
            await connection.execute(
              `INSERT INTO generacion_ia_ingrediente (id_generacion, id_ingrediente, cantidad, id_unidad)
               VALUES (?, ?, ?, ?)`,
              [idGeneracion, idIngrediente, cantidad, mismaUnidad ? unidadUnica.id_unidad : null]
            );
          }
        }
      }

      // No confirmes recetas si la petición se canceló durante la transacción.
      comprobarCancelacion();
      if (idSolicitud !== null) {
        const contexto = await solicitudGeneracionModel.prepararConfirmacion(connection, idSolicitud, idUsuario);
        await solicitudGeneracionModel.confirmar(connection, idSolicitud, idUsuario, idsRecetas, contexto);
        comprobarCancelacion();
      }
      await connection.commit();
      transaccionIniciada = false;
      return idsRecetas;
    } catch (error) {
      if (transaccionIniciada) {
        try {
          await connection.rollback();
        } catch {
          // Conserva el error original si también falla el rollback.
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }
};

module.exports = RecetaModel;

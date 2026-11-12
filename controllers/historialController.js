const historialModel = require('../models/historialModel');

const listarHistorial = async (req, res, next) => {
  try {
    const idUsuario = Number(req.session?.usuario?.id_usuario);
    if (!Number.isInteger(idUsuario) || idUsuario < 1) {
      return res.status(401).json({ ok: false, mensaje: 'Debes iniciar sesión para consultar el historial.' });
    }
    const busquedas = await historialModel.obtenerPorUsuario(idUsuario);
    return res.json({ ok: true, busquedas });
  } catch (error) {
    return next(error);
  }
};

const listarRecetasVistas = async (req, res, next) => {
  try {
    const idUsuario = Number(req.session?.usuario?.id_usuario);
    if (!Number.isInteger(idUsuario) || idUsuario < 1) {
      return res.status(401).json({ ok: false, mensaje: 'Debes iniciar sesi\u00f3n para consultar las recetas vistas.' });
    }
    const recetas = await historialModel.obtenerRecetasVistasPorUsuario(idUsuario);
    return res.json({ ok: true, recetas });
  } catch (error) {
    return next(error);
  }
};

const registrarRecetaVista = async (req, res, next) => {
  const idUsuario = Number(req.session?.usuario?.id_usuario);
  if (!Number.isInteger(idUsuario) || idUsuario < 1) {
    return res.status(401).json({ ok: false, mensaje: 'Debes iniciar sesi\u00f3n para guardar una receta vista.' });
  }

  const idReceta = Number(req.body?.idReceta);
  if (!Number.isInteger(idReceta) || idReceta < 1) {
    return res.status(400).json({ ok: false, mensaje: 'El identificador de la receta no es v\u00e1lido.' });
  }

  const idBusqueda = req.body?.idBusqueda == null ? null : Number(req.body.idBusqueda);
  if (idBusqueda !== null && (!Number.isInteger(idBusqueda) || idBusqueda < 1)) {
    return res.status(400).json({ ok: false, mensaje: 'El identificador de la b\u00fasqueda no es v\u00e1lido.' });
  }

  try {
    const registrada = await historialModel.registrarRecetaVista(idUsuario, idReceta, idBusqueda);
    if (!registrada) {
      return res.status(404).json({ ok: false, mensaje: 'No se encontr\u00f3 una receta o b\u00fasqueda propia con esos identificadores.' });
    }
    return res.status(201).json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

const eliminarHistorial = async (req, res) => {
  const idUsuario = Number(req.session?.usuario?.id_usuario);
  if (!Number.isInteger(idUsuario) || idUsuario < 1) {
    return res.status(401).json({ ok: false, mensaje: 'Debes iniciar sesión para borrar tu historial.' });
  }

  try {
    const resultado = await historialModel.eliminarHistorialCompletoPorUsuario(idUsuario);
    return res.json({
      ok: true,
      eliminadas: resultado.busquedasEliminadas,
      recetasEliminadas: resultado.recetasEliminadas
    });
  } catch (error) {
    console.error('[MySQL historial] Falló el DELETE del historial:', {
      code: error?.code || null,
      errno: error?.errno || null,
      message: error?.sqlMessage || error?.message || 'Error desconocido'
    });
    return res.status(500).json({
      ok: false,
      mensaje: 'No se pudo borrar el historial. Inténtalo nuevamente más tarde.'
    });
  }
};

const eliminarBusqueda = async (req, res) => {
  const idUsuario = Number(req.session?.usuario?.id_usuario);
  if (!Number.isSafeInteger(idUsuario) || idUsuario < 1) {
    return res.status(401).json({ ok: false, mensaje: 'Debes iniciar sesión para eliminar una búsqueda.' });
  }

  const idBusqueda = Number(req.params.idBusqueda);
  if (!Number.isSafeInteger(idBusqueda) || idBusqueda < 1) {
    return res.status(400).json({ ok: false, mensaje: 'El identificador de la búsqueda no es válido.' });
  }

  try {
    const eliminada = await historialModel.eliminarBusquedaPorUsuario(idUsuario, idBusqueda);
    if (!eliminada) {
      return res.status(404).json({ ok: false, mensaje: 'No se encontró esa búsqueda en tu historial.' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('[MySQL historial] No se pudo eliminar la búsqueda:', error?.code || error?.message || error);
    return res.status(500).json({ ok: false, mensaje: 'No se pudo eliminar la búsqueda. Inténtalo nuevamente más tarde.' });
  }
};

const eliminarRecetaVista = async (req, res) => {
  const idUsuario = Number(req.session?.usuario?.id_usuario);
  if (!Number.isSafeInteger(idUsuario) || idUsuario < 1) {
    return res.status(401).json({ ok: false, mensaje: 'Debes iniciar sesión para eliminar una receta vista.' });
  }

  const idHistorial = Number(req.params.idHistorial);
  if (!Number.isSafeInteger(idHistorial) || idHistorial < 1) {
    return res.status(400).json({ ok: false, mensaje: 'El identificador de la receta vista no es válido.' });
  }

  try {
    const eliminada = await historialModel.eliminarRecetaVistaPorUsuario(idUsuario, idHistorial);
    if (!eliminada) {
      return res.status(404).json({ ok: false, mensaje: 'No se encontró esa receta vista en tu historial.' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('[MySQL historial] No se pudo eliminar la receta vista:', error?.code || error?.message || error);
    return res.status(500).json({ ok: false, mensaje: 'No se pudo quitar la receta del historial. Inténtalo nuevamente más tarde.' });
  }
};

module.exports = {
  listarHistorial,
  listarRecetasVistas,
  registrarRecetaVista,
  eliminarBusqueda,
  eliminarRecetaVista,
  eliminarHistorial
};

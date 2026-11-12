const favoritoModel = require('../models/favoritoModel');

const obtenerIdReceta = req => {
  const parametro = String(req.params.idReceta || '');
  if (!/^[1-9]\d*$/.test(parametro)) return null;
  const idReceta = Number(parametro);
  return Number.isSafeInteger(idReceta) && idReceta > 0 ? idReceta : null;
};

const responderErrorInterno = (res, error, operacion) => {
  console.error(`[Favoritos] Error al ${operacion}:`, error?.code || 'ERROR_INTERNO');
  return res.status(500).json({ ok: false, mensaje: 'No se pudo completar la operación de favoritos. Inténtalo nuevamente.' });
};

const listar = async (req, res) => {
  try {
    const favoritos = await favoritoModel.obtenerPorUsuario(req.idUsuarioAutenticado);
    return res.json({ ok: true, favoritos });
  } catch (error) {
    return responderErrorInterno(res, error, 'consultar');
  }
};

const consultarEstado = async (req, res) => {
  const idReceta = obtenerIdReceta(req);
  if (!idReceta) return res.status(400).json({ ok: false, mensaje: 'El identificador de la receta no es válido.' });
  try {
    const favorito = await favoritoModel.obtenerEstado(req.idUsuarioAutenticado, idReceta);
    if (favorito === null) return res.status(404).json({ ok: false, mensaje: 'No se encontró una receta accesible con ese identificador.' });
    return res.json({ ok: true, favorito });
  } catch (error) {
    return responderErrorInterno(res, error, 'consultar el estado');
  }
};

const agregar = async (req, res) => {
  const idReceta = obtenerIdReceta(req);
  if (!idReceta) return res.status(400).json({ ok: false, mensaje: 'El identificador de la receta no es válido.' });
  try {
    const resultado = await favoritoModel.agregar(req.idUsuarioAutenticado, idReceta);
    if (!resultado.accesible) return res.status(404).json({ ok: false, mensaje: 'No se encontró una receta accesible con ese identificador.' });
    return res.status(resultado.existente ? 200 : 201).json({
      ok: true,
      favorito: true,
      existente: resultado.existente
    });
  } catch (error) {
    return responderErrorInterno(res, error, 'agregar');
  }
};

const quitar = async (req, res) => {
  const idReceta = obtenerIdReceta(req);
  if (!idReceta) return res.status(400).json({ ok: false, mensaje: 'El identificador de la receta no es válido.' });
  try {
    const eliminado = await favoritoModel.eliminar(req.idUsuarioAutenticado, idReceta);
    return res.json({ ok: true, eliminado });
  } catch (error) {
    return responderErrorInterno(res, error, 'quitar');
  }
};

module.exports = { listar, consultarEstado, agregar, quitar };

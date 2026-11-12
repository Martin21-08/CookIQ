const resenaModel = require('../models/resenaModel');

const datosSesionYReceta = (req, res) => {
    const idUsuario = Number(req.session?.usuario?.id_usuario);
    if (!Number.isSafeInteger(idUsuario) || idUsuario <= 0) {
        res.status(401).json({ ok: false, mensaje: 'Debes iniciar sesión.' });
        return null;
    }
    const parametro = req.params.idReceta;
    const idReceta = typeof parametro === 'string' && /^\d+$/.test(parametro) ? Number(parametro) : NaN;
    if (!Number.isSafeInteger(idReceta) || idReceta <= 0 || idReceta > 2147483647) {
        res.status(400).json({ ok: false, mensaje: 'El identificador de la receta no es válido.' });
        return null;
    }
    return { idUsuario, idReceta };
};

const responderError = (res, error) => {
    if (error.code === 'RECIPE_NOT_FOUND') {
        return res.status(404).json({ ok: false, mensaje: 'La receta no existe o no está disponible para tu cuenta.' });
    }
    console.error('Error del módulo de reseñas:', error.code || 'ERROR');
    return res.status(500).json({ ok: false, mensaje: 'No se pudo completar la operación de reseñas. Inténtalo nuevamente.' });
};

module.exports = {
    obtener: async (req, res) => {
        const datos = datosSesionYReceta(req, res);
        if (!datos) return;
        try {
            const resenas = await resenaModel.obtener(datos.idUsuario, datos.idReceta);
            res.set('Cache-Control', 'no-store');
            return res.json({ ok: true, resenas });
        } catch (error) { return responderError(res, error); }
    },

    guardar: async (req, res) => {
        const datos = datosSesionYReceta(req, res);
        if (!datos) return;
        const estrellas = req.body?.estrellas;
        if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) {
            return res.status(400).json({ ok: false, mensaje: 'Selecciona una calificación entera entre 1 y 5 estrellas.' });
        }
        const comentario = typeof req.body?.comentario === 'string' ? req.body.comentario.trim() : '';
        if (!comentario || [...comentario].length > 2000) {
            return res.status(400).json({ ok: false, mensaje: 'Escribe un comentario de entre 1 y 2000 caracteres.' });
        }
        try {
            const resena = await resenaModel.guardar(datos.idUsuario, datos.idReceta, estrellas, comentario);
            return res.json({ ok: true, resena, mensaje: 'Reseña guardada.' });
        } catch (error) { return responderError(res, error); }
    },

    eliminar: async (req, res) => {
        const datos = datosSesionYReceta(req, res);
        if (!datos) return;
        try {
            const eliminada = await resenaModel.eliminar(datos.idUsuario, datos.idReceta);
            if (!eliminada) return res.status(404).json({ ok: false, mensaje: 'No tienes una reseña para esta receta.' });
            return res.json({ ok: true, mensaje: 'Tu reseña fue eliminada.' });
        } catch (error) { return responderError(res, error); }
    }
};

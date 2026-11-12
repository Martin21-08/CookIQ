const express = require('express');
const requiereSesion = require('../middlewares/requiereSesion');
const controlador = require('../controllers/avatarController');
const router = express.Router();
router.use(requiereSesion, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/avatar', controlador.obtener);
router.get('/foto', controlador.imagen);
router.put('/foto', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), controlador.subir);
router.delete('/foto', controlador.eliminar);
router.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ ok: false, mensaje: 'La foto debe pesar como máximo 2 MB.' });
    next(error);
});
module.exports = router;

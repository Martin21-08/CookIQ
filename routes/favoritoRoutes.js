const express = require('express');
const requiereSesion = require('../middlewares/requiereSesion');
const favoritoController = require('../controllers/favoritoController');

const router = express.Router();
router.use(requiereSesion);

router.get('/', favoritoController.listar);
router.get('/:idReceta/estado', favoritoController.consultarEstado);
router.post('/:idReceta', favoritoController.agregar);
router.delete('/:idReceta', favoritoController.quitar);

module.exports = router;

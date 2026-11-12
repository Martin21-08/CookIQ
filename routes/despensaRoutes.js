const express = require('express');
const router = express.Router();
const despensaController = require('../controllers/despensaController');
const requiereSesion = require('../middlewares/requiereSesion');
const suscripciones = require('../middlewares/suscripciones');

router.use(requiereSesion, suscripciones.api);

router.get('/', despensaController.obtenerDespensa);
router.post('/', despensaController.agregarIngrediente);
router.delete('/', despensaController.limpiarDespensa);
router.delete('/:id_ingrediente', despensaController.eliminarIngrediente);

module.exports = router;

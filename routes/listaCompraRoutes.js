const express = require('express');
const router = express.Router();
const requiereSesion = require('../middlewares/requiereSesion');
const listaCompraController = require('../controllers/listaCompraController');
const suscripciones = require('../middlewares/suscripciones');

router.use(requiereSesion, suscripciones.api);

router.get('/', listaCompraController.obtenerLista);
router.get('/unidades', listaCompraController.obtenerUnidades);
router.post('/faltantes/calcular', listaCompraController.calcularFaltantes);
router.post('/faltantes', listaCompraController.agregarFaltantes);
router.post('/items/local/comprado', listaCompraController.transferirIngredienteLocalComprado);
router.post('/items', listaCompraController.agregarElemento);
router.patch('/items/:id_item', listaCompraController.actualizarElemento);
router.delete('/items/:id_item', listaCompraController.eliminarElemento);
router.delete('/items', listaCompraController.vaciarLista);
router.patch('/items/:id_item/comprado', listaCompraController.marcarComprado);

module.exports = router;

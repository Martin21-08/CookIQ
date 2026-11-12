const express = require('express');
const historialController = require('../controllers/historialController');

const router = express.Router();
router.get('/', historialController.listarHistorial);
router.get('/recetas-vistas', historialController.listarRecetasVistas);
router.post('/recetas-vistas', historialController.registrarRecetaVista);
router.delete('/busquedas/:idBusqueda', historialController.eliminarBusqueda);
router.delete('/recetas-vistas/:idHistorial', historialController.eliminarRecetaVista);
router.delete('/', historialController.eliminarHistorial);

module.exports = router;

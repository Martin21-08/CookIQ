// Relaciona cada página del sitio con la vista que debe mostrar.
const express = require('express');
const router = express.Router();
const viewsController = require('../controllers/viewsController');
const requiereSesion = require('../middlewares/requiereSesion');
const suscripciones = require('../middlewares/suscripciones');
router.get('/descubre', require('../controllers/informacionController').mostrar);

router.get('/login', (req, res) => res.redirect('/usuarios/login'));
router.get('/register', (req, res) => res.redirect('/usuarios/registro'));
// Estas páginas muestran su vista; sus cambios interactivos se manejan en el navegador.
router.get('/lobby', requiereSesion.pagina, suscripciones.cargarPlan, viewsController.mostrarLobby);
router.get('/despensa', requiereSesion.pagina, suscripciones.pagina, viewsController.mostrarDespensa);
router.get('/favoritos', requiereSesion.pagina, suscripciones.cargarPlan, viewsController.mostrarFavoritos);
router.get('/historial', requiereSesion.pagina, suscripciones.cargarPlan, viewsController.mostrarHistorial);
router.get('/perfil', requiereSesion.pagina, suscripciones.cargarPlan, viewsController.mostrarPerfil);
router.get('/suscripciones', requiereSesion.pagina, suscripciones.cargarPlan, viewsController.mostrarSuscripciones);
// El enlace de registro solicita esta URL; el controlador responde con la vista Terminos.
router.get('/usuarios/terminos', viewsController.mostrarTerminos);

module.exports = router;

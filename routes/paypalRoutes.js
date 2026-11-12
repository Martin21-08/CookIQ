const router = require('express').Router();
const requiereSesion = require('../middlewares/requiereSesion');
const { crearControlador } = require('../controllers/paypalController');
const paypal = crearControlador();

// PayPal no tiene una sesión de usuario; la autenticidad se comprueba por firma.
router.post('/webhook',paypal.webhook);
router.get('/retorno',requiereSesion.pagina,paypal.retorno);
router.get('/cancelado',requiereSesion.pagina,paypal.cancelado);
router.use(requiereSesion);
router.get('/configuracion',paypal.configuracionPublica);
router.get('/estado',paypal.estado);
router.post('/suscripciones',paypal.contratar);
router.post('/cancelar',paypal.cancelar);
router.post('/notificacion-compra',paypal.notificarCompra);
paypal.iniciarRecuperacion();
module.exports = router;

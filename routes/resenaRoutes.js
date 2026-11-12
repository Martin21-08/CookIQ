const router = require('express').Router();
const requiereSesion = require('../middlewares/requiereSesion');
const resenaController = require('../controllers/resenaController');

router.use(requiereSesion);
router.get('/:idReceta/resenas', resenaController.obtener);
router.put('/:idReceta/resenas/mia', resenaController.guardar);
router.delete('/:idReceta/resenas/mia', resenaController.eliminar);

module.exports = router;

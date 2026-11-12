const express = require('express');

const router = express.Router();

const firebaseController =
    require('../controllers/FirebaseController');

const validarFirebase =
    require('../middlewares/validarFirebase');


/*
 * Configuración pública de Firebase
 */
router.get(
    '/firebase-config',
    firebaseController.obtenerConfiguracionFirebase
);


/*
 * Login con Google
 */
router.post(
    '/firebase/google',
    validarFirebase,
    firebaseController.loginGoogle
);

/*
 * Registro con Google tras completar los datos del modelo usuario.
 */
router.post(
    '/firebase/google/registro',
    validarFirebase,
    firebaseController.registrarGoogle
);


/*
 * Obtener sesión actual
 */
router.get(
    '/firebase/sesion',
    firebaseController.obtenerSesion
);


/*
 * Cerrar sesión
 */
router.post(
    '/firebase/logout',
    firebaseController.cerrarSesion
);


router.put(
    '/firebase/perfil',
    firebaseController.actualizarPerfil
);

module.exports = router;

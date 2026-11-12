const firebaseModel = require('../models/firebaseModel');
const registroService = require('../services/registroService');
const { comprobarOrigen } = require('./registroController');

/**
 * Entrega al frontend la configuración pública
 * necesaria para inicializar Firebase.
 */
function obtenerConfiguracionFirebase(req, res) {
    const configuracion = {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    };

    const faltantes = Object.entries(configuracion)
        .filter(([_, valor]) => !valor)
        .map(([nombre]) => nombre);

    if (faltantes.length > 0) {
        return res.status(500).json({
            error: 'Firebase no está configurado correctamente.',
            faltantes
        });
    }

    res.json(configuracion);
}


/**
 * Inicia sesión solo si el correo verificado ya existe en CookIQ.
 */
async function loginGoogle(req, res) {
    try {
        const { googleId, correo } = req.firebaseGoogleUser;
        let usuario = await firebaseModel.buscarPorCorreo(correo);

        if (!usuario) {
            return res.status(404).json({
                ok: false,
                error: 'Este Gmail no está registrado. Regístrate con Google para crear una cuenta.'
            });
        }

        const usuarioConGoogleId = await firebaseModel.buscarPorGoogleId(googleId);
        if (usuarioConGoogleId && usuarioConGoogleId.id_usuario !== usuario.id_usuario) {
            return res.status(409).json({
                ok: false,
                error: 'Esta cuenta de Google ya está vinculada a otro usuario.'
            });
        }

        if (usuario.google_id && usuario.google_id !== googleId) {
            return res.status(409).json({
                ok: false,
                error: 'El Gmail ya está registrado con otra cuenta de Google.'
            });
        }

        if (!usuario.google_id) {
            usuario = await firebaseModel.vincularGoogleId(usuario.id_usuario, googleId);
        }

        req.session.usuario = usuario;
        req.flash('success', 'Inicio de sesión exitoso con Google');
        req.session.fotoGoogle = req.firebaseGoogleUser.fotoGoogle || null;
        req.session.fotoGoogleUsuarioId = usuario.id_usuario;

        return res.json({
            ok: true,
            usuario
        });

    } catch (error) {

        console.error('Error en inicio de sesión con Google:', error);

        res.status(500).json({
            ok: false,
            error: 'No se pudo iniciar sesión con Google. Inténtalo nuevamente.'
        });
    }
}


/**
 * Registra una cuenta nueva después de que la persona completa sus datos.
 */
async function registrarGoogle(req, res) {
    try {
        comprobarOrigen(req);
        const { googleId, correo } = req.firebaseGoogleUser;
        const nombres = String(req.body.nombres || '').trim();
        const apellidos = String(req.body.apellidos || '').trim();
        const telefonoIngresado = String(req.body.telefono || '').trim();
        const telefono = telefonoIngresado
            ? telefonoIngresado.replace(/[\s()-]/g, '')
            : null;
        const terminosAceptados = ['Terminos', 'on', true].includes(req.body.Terminos);

        if (!nombres || !apellidos) {
            return res.status(400).json({
                ok: false,
                error: 'Debes ingresar tu nombre y apellido.'
            });
        }

        if (!terminosAceptados) {
            return res.status(400).json({
                ok: false,
                error: 'Debes aceptar los términos y condiciones para registrarte.'
            });
        }

        if (telefono && !/^\+569\d{8}$/.test(telefono)) {
            return res.status(400).json({
                ok: false,
                error: 'El teléfono debe tener formato +56 9 1234 5678.'
            });
        }

        const usuarioExistente = await firebaseModel.buscarPorCorreo(correo);
        if (usuarioExistente) {
            return res.status(409).json({
                ok: false,
                error: 'Este Gmail ya está registrado. Inicia sesión con Google.'
            });
        }

        const googleIdExistente = await firebaseModel.buscarPorGoogleId(googleId);
        if (googleIdExistente) {
            return res.status(409).json({
                ok: false,
                error: 'Esta cuenta de Google ya está registrada. Inicia sesión con Google.'
            });
        }

        const pendiente = registroService.preparar(req, 'google', {
            nombres, apellidos, correo, telefono, googleId
        });
        return res.status(202).json(pendiente);
    } catch (error) {
        console.error('Error en registro con Google:', {
            code: error.code || 'UNKNOWN',
            message: error.message || 'Sin detalle'
        });

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                ok: false,
                error: 'El Gmail o teléfono ya está registrado.'
            });
        }

        return res.status(error.status || 500).json({
            ok: false,
            error: error.status ? error.message : 'No se pudo guardar el registro con Google. Inténtalo nuevamente.'
        });
    }
}


/**
 * Devuelve el usuario que actualmente tiene
 * una sesión de CookIQ.
 */
async function obtenerSesion(req, res) {

    if (!req.session.usuario) {
        return res.status(401).json({
            ok: false,
            usuario: null
        });
    }

    const usuario =
        await firebaseModel.buscarPorId(
            req.session.usuario.id_usuario
        );

    if (!usuario) {

        req.session.destroy(() => {});

        return res.status(401).json({
            ok: false,
            usuario: null
        });
    }

    res.json({
        ok: true,
        usuario
    });
}


/**
 * Actualiza únicamente los datos personales de la cuenta de la sesión actual.
 */
async function actualizarPerfil(req, res) {
    const idUsuario = Number(req.session?.usuario?.id_usuario);
    if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
        return res.status(401).json({
            ok: false,
            error: 'Debes iniciar sesión.'
        });
    }

    const { nombres, apellidos, correo, telefono } = req.body || {};
    if ([nombres, apellidos, correo, telefono].some(valor => typeof valor !== 'string')) {
        return res.status(400).json({
            ok: false,
            error: 'Los datos personales enviados no son válidos.'
        });
    }

    if (![nombres, apellidos, correo, telefono].every(valor => valor.trim())) {
        return res.status(400).json({
            ok: false,
            error: 'Nombre, apellido, correo y teléfono son obligatorios.'
        });
    }

    if (!/^\+569\d{8}$/.test(telefono.trim())) {
        return res.status(400).json({
            ok: false,
            error: 'El teléfono debe tener el formato +569 seguido de ocho dígitos.'
        });
    }

    try {
        const usuario = await firebaseModel.actualizarPerfil(idUsuario, {
            nombres: nombres.trim(),
            apellidos: apellidos.trim(),
            correo: correo.trim(),
            telefono: telefono.trim()
        });

        if (!usuario) {
            return res.status(404).json({
                ok: false,
                error: 'No se encontró la cuenta de la sesión actual.'
            });
        }

        req.session.usuario = usuario;
        return res.json({
            ok: true,
            usuario: {
                id_usuario: usuario.id_usuario,
                nombres: usuario.nombres,
                apellidos: usuario.apellidos,
                correo: usuario.correo,
                telefono: usuario.telefono
            }
        });
    } catch (error) {
        console.error('Error al actualizar datos personales:', {
            code: error.code || 'UNKNOWN'
        });

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                ok: false,
                error: 'El correo o teléfono ya está asociado a otra cuenta.'
            });
        }

        return res.status(500).json({
            ok: false,
            error: 'No se pudieron guardar los datos personales.'
        });
    }
}


/**
 * Cierra la sesión de CookIQ.
 */
function cerrarSesion(req, res) {

    req.session.destroy((error) => {

        if (error) {

            return res.status(500).json({
                ok: false,
                error: 'No se pudo cerrar la sesión.'
            });
        }

        res.json({
            ok: true
        });
    });
}


module.exports = {
    obtenerConfiguracionFirebase,
    loginGoogle,
    registrarGoogle,
    obtenerSesion,
    actualizarPerfil,
    cerrarSesion
};

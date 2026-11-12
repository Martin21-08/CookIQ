// Protege rutas API usando exclusivamente la identidad guardada en la sesión.
const adjuntarUsuarioAutenticado = req => {
    const idUsuario = Number(req.session?.usuario?.id_usuario);
    if (!Number.isSafeInteger(idUsuario) || idUsuario <= 0) return false;
    req.idUsuarioAutenticado = idUsuario;
    return true;
};

const requiereSesion = (req, res, next) => {
    if (!adjuntarUsuarioAutenticado(req)) {
        return res.status(401).json({
            ok: false,
            mensaje: 'Debes iniciar sesión.'
        });
    }
    return next();
};

// La misma comprobación sirve para navegaciones HTML sin responder JSON al navegador.
requiereSesion.pagina = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!adjuntarUsuarioAutenticado(req)) return res.redirect('/usuarios/login');
    return next();
};

module.exports = requiereSesion;

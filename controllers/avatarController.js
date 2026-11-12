const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const modelo = require('../models/avatarModel');
const directorio = path.resolve(process.env.AVATAR_STORAGE_DIR || path.join(__dirname, '..', 'storage', 'avatars'));
const rutaSegura = archivo => typeof archivo === 'string' && /^[a-f0-9-]{36}\.webp$/.test(archivo) ? path.join(directorio, archivo) : null;
const quitarArchivo = async archivo => {
    const ruta = rutaSegura(archivo);
    if (!ruta) return;
    for (let intento = 0; intento < 4; intento++) {
        try { await fs.unlink(ruta); return; } catch (error) {
            if (error.code === 'ENOENT') return;
            if (['EBUSY', 'EPERM'].includes(error.code) && intento < 3) {
                await new Promise(resolve => setTimeout(resolve, 50 * (intento + 1)));
            } else { console.error('[Avatar limpieza]', { code: error.code }); return; }
        }
    }
};
const responderError = (res, error) => {
    console.error('[Avatar]', { code: error.code || 'AVATAR_ERROR' });
    const status = error.code === 'ER_BAD_FIELD_ERROR' ? 503 : error.code === 'AVATAR_USER_NOT_FOUND' ? 401 : 500;
    return res.status(status).json({ ok: false, mensaje: status === 503 ? 'El almacenamiento de fotos todavía no está habilitado.' : 'No se pudo actualizar o consultar tu foto de perfil. Inténtalo nuevamente.' });
};
const obtener = async (req, res) => {
    try {
        const usuario = await modelo.obtener(req.idUsuarioAutenticado);
        if (!usuario) return res.status(401).json({ ok: false, mensaje: 'La cuenta ya no existe.' });
        return res.json({ ok: true, correo: usuario.correo, personalizada: Boolean(rutaSegura(usuario.foto_perfil_ruta)),
            fotoUrl: rutaSegura(usuario.foto_perfil_ruta) ? '/api/perfil/foto' : null,
            fotoGoogle: req.session.fotoGoogleUsuarioId === req.idUsuarioAutenticado ? req.session.fotoGoogle || null : null });
    } catch (error) { return responderError(res, error); }
};
const imagen = async (req, res) => {
    try {
        const usuario = await modelo.obtener(req.idUsuarioAutenticado);
        const ruta = rutaSegura(usuario?.foto_perfil_ruta);
        if (!ruta) return res.sendStatus(404);
        await fs.access(ruta);
        res.set('X-Content-Type-Options', 'nosniff');
        return res.sendFile(ruta);
    } catch (error) { return error.code === 'ENOENT' ? res.sendStatus(404) : responderError(res, error); }
};
const subir = async (req, res) => {
    let contenido;
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false, mensaje: 'Selecciona una imagen JPG, PNG o WebP.' });
    try {
        const imagen = sharp(req.body, { limitInputPixels: 16777216, failOn: 'warning' });
        const datos = await imagen.metadata();
        const tipos = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
        if (!tipos[datos.format] || !req.is(tipos[datos.format]) || (datos.pages || 1) > 1) throw new Error('Formato no permitido.');
        contenido = await imagen.rotate().resize(512, 512, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    } catch { return res.status(400).json({ ok: false, mensaje: 'La imagen no es válida. Usa JPG, PNG o WebP sin animación y de hasta 16 megapíxeles.' }); }
    const archivo = `${randomUUID()}.webp`;
    try {
        await fs.mkdir(directorio, { recursive: true });
        await fs.writeFile(rutaSegura(archivo), contenido, { flag: 'wx' });
        const anterior = await modelo.actualizar(req.idUsuarioAutenticado, archivo);
        await quitarArchivo(anterior);
        return res.json({ ok: true, mensaje: 'Tu foto de perfil se actualizó correctamente.' });
    } catch (error) { await quitarArchivo(archivo); return responderError(res, error); }
};
const eliminar = async (req, res) => {
    try {
        const anterior = await modelo.actualizar(req.idUsuarioAutenticado, null);
        await quitarArchivo(anterior);
        return res.json({ ok: true, mensaje: 'Tu foto de perfil se eliminó correctamente.' });
    } catch (error) { return responderError(res, error); }
};
module.exports = { obtener, imagen, subir, eliminar };

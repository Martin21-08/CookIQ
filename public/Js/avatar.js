(() => {
    const raiz = document.getElementById('perfilAvatar');
    if (!raiz) return;
    const imagen = raiz.querySelector('[data-avatar-imagen]');
    const iniciales = raiz.querySelector('[data-avatar-iniciales]');
    const selector = raiz.querySelector('[data-avatar-archivo]');
    const menu = raiz.querySelector('details');
    const eliminar = raiz.querySelector('[data-avatar-eliminar]');
    let ocupado = false;
    let datos = { correo: raiz.dataset.correo, fotoGoogle: null, personalizada: false };
    const pintar = () => {
        const correo = String(datos.correo || '').toLowerCase();
        const partes = correo.split('@')[0].split(/[._-]+/).filter(Boolean);
        iniciales.textContent = partes.slice(0, 2).map(parte => [...parte][0]).join('').toUpperCase() || '?';
        const colores = ['#704b9e', '#88513e', '#386d65', '#555a96'];
        const hash = [...correo].reduce((total, letra) => (total * 31 + letra.codePointAt(0)) >>> 0, 0);
        raiz.querySelector('.perfil-avatar').style.backgroundColor = colores[hash % colores.length];
        imagen.hidden = true; iniciales.hidden = false;
        const mostrar = (url, alternativa) => {
            if (!url) return;
            imagen.onerror = () => { imagen.hidden = true; iniciales.hidden = false; if (alternativa) mostrar(alternativa, null); };
            imagen.onload = () => { imagen.hidden = false; iniciales.hidden = true; };
            imagen.src = url;
        };
        mostrar(datos.personalizada ? `${datos.fotoUrl}?v=${Date.now()}` : datos.fotoGoogle, datos.personalizada ? datos.fotoGoogle : null);
        eliminar.disabled = ocupado || !datos.personalizada;
    };
    const api = async (url, opciones = {}) => {
        const respuesta = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...opciones });
        const resultado = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok || !resultado.ok) throw new Error(resultado.mensaje || 'No se pudo actualizar tu foto de perfil. Inténtalo nuevamente.');
        return resultado;
    };
    const cargar = async () => { datos = await api('/api/perfil/avatar'); pintar(); };
    const bloquear = valor => {
        ocupado = valor;
        raiz.querySelector('[data-avatar-subir]').disabled = valor;
        eliminar.disabled = valor || !datos.personalizada;
    };
    raiz.querySelector('[data-avatar-subir]').onclick = () => { if (!ocupado) { menu.open = false; selector.click(); } };
    document.addEventListener('click', evento => { if (!menu.contains(evento.target)) menu.open = false; });
    menu.addEventListener('keydown', evento => { if (evento.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); } });
    selector.onchange = async () => {
        const archivo = selector.files[0];
        if (!archivo || ocupado) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type) || archivo.size > 2 * 1024 * 1024) {
            mostrarNotificacionCookIQ('Selecciona una imagen JPG, PNG o WebP de hasta 2 MB.', 'error'); selector.value = ''; return;
        }
        bloquear(true);
        const previa = URL.createObjectURL(archivo);
        try {
            if (!await confirmarAccionCookIQ({ mensaje: '¿Quieres guardar esta imagen como tu nueva foto de perfil?', textoConfirmar: 'Sí, guardar foto', imagenPrevia: previa })) return;
            await api('/api/perfil/foto', { method: 'PUT', headers: { 'Content-Type': archivo.type }, body: archivo });
            try { await cargar(); } catch { mostrarNotificacionCookIQ('La foto se guardó, pero no se pudo actualizar el avatar. Recarga la página.', 'advertencia'); return; }
            mostrarNotificacionCookIQ('Tu foto de perfil se actualizó correctamente.', 'exito');
        } catch (error) { mostrarNotificacionCookIQ(error.message, 'error'); }
        finally { URL.revokeObjectURL(previa); selector.value = ''; bloquear(false); }
    };
    eliminar.onclick = async () => {
        if (ocupado || !datos.personalizada) return;
        menu.open = false; bloquear(true);
        try {
            if (!await confirmarAccionCookIQ({ mensaje: '¿Estás seguro de que deseas eliminar tu foto de perfil?' })) return;
            await api('/api/perfil/foto', { method: 'DELETE' });
            datos.personalizada = false; datos.fotoUrl = null; pintar();
            mostrarNotificacionCookIQ('Tu foto de perfil se eliminó correctamente.', 'exito');
        } catch (error) { mostrarNotificacionCookIQ(error.message, 'error'); }
        finally { bloquear(false); }
    };
    pintar();
    cargar().catch(error => mostrarNotificacionCookIQ(error.message, 'advertencia'));
})();

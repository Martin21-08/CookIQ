// Registro pendiente: datos sensibles solo en el servidor, nunca en localStorage.
(() => {
    const dialogo = document.getElementById('personalizacionRegistro');
    const registro = document.getElementById('formRegistro');
    if (!dialogo || !registro) return;
    const porId = id => document.getElementById(id);
    const mensaje = porId('mensajePreferenciasRegistro');
    const seleccion = porId('seleccionPreferenciasRegistro');
    const confirmacion = porId('confirmacionPreferenciasRegistro');
    let pendiente, ocupado = false, catalogosListos = false;
    const informar = (texto, error = false) => { mensaje.textContent = texto; mensaje.setAttribute('role', error ? 'alert':'status'); };
    async function api(url, datos, keepalive = false) {
        const r = await fetch(url, { credentials:'same-origin', cache:'no-store', keepalive,
            ...(datos ? { method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json'}, body:JSON.stringify(datos) }:{}) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) throw new Error(d.error || d.mensaje || 'No se pudo completar el registro. Intenta nuevamente.');
        return d;
    }
    function pintar(id, nombre, filas, columna, marcados = []) {
        const contenedor = porId(id);
        contenedor.replaceChildren();
        for (const fila of filas) {
            const etiqueta = document.createElement('label'), casilla = document.createElement('input'), texto = document.createElement('span');
            casilla.type = 'checkbox'; casilla.name = nombre; casilla.value = String(fila[columna]);
            casilla.checked = marcados.map(Number).includes(Number(fila[columna]));
            texto.textContent = fila.nombre;
            etiqueta.append(casilla, texto); contenedor.append(etiqueta);
        }
    }
    async function cargarCatalogos() {
        informar('Cargando las opciones de tu alimentación…');
        porId('recargarCatalogosRegistro').hidden = true;
        porId('confirmarPreferenciasRegistro').disabled = true;
        try {
            const d = await api('/catalogos');
            if (!Array.isArray(d.alergias) || !Array.isArray(d.intolerancias)) throw new Error('No se pudieron cargar las opciones.');
            pintar('registroAlergias','alergias',d.alergias,'id_alergia',pendiente.seleccion?.alergias);
            pintar('registroIntolerancias','intolerancias',d.intolerancias,'id_intolerancia',pendiente.seleccion?.intolerancias);
            catalogosListos = true; porId('confirmarPreferenciasRegistro').disabled = false; informar('');
        } catch (e) { catalogosListos = false; informar(e.message,true); porId('recargarCatalogosRegistro').hidden = false; }
    }
    async function abrir(datos) {
        if (datos.completado) { window.location.assign('/usuarios/login'); return; }
        pendiente = datos;
        seleccion.hidden = false; confirmacion.hidden = true;
        if (!dialogo.open) dialogo.showModal();
        porId('tituloPersonalizacionRegistro').focus();
        await cargarCatalogos();
    }
    window.CookIQRegistro = { abrir };
    const idsSeleccionados = nombre => [...dialogo.querySelectorAll(`input[name="${nombre}"]:checked`)].map(c => Number(c.value));
    async function guardarBorrador(keepalive = false) {
        if (!pendiente || ocupado || !catalogosListos) return;
        pendiente.revision = (pendiente.revision || 0)+1;
        try {
            await api('/usuarios/registro/borrador', {token:pendiente.token,revision:pendiente.revision,
                alergias:idsSeleccionados('alergias'),intolerancias:idsSeleccionados('intolerancias')},keepalive);
        } catch {
            if (!keepalive && !ocupado) informar('No pudimos conservar el borrador. Mantén esta ventana abierta y confirma para volver a intentar el guardado.',true);
        }
    }
    porId('formPreferenciasRegistro').addEventListener('change', evento => {
        if (['alergias','intolerancias'].includes(evento.target.name)) void guardarBorrador();
    });
    window.addEventListener('pagehide', () => { if (dialogo.open) void guardarBorrador(true); });
    dialogo.addEventListener('cancel', e => { e.preventDefault(); informar('Confirma tus preferencias para finalizar, o utiliza Volver a Descubre. No se ha perdido tu selección.'); });
    porId('recargarCatalogosRegistro').addEventListener('click', cargarCatalogos);
    porId('formPreferenciasRegistro').addEventListener('submit', e => {
        e.preventDefault(); if (ocupado || !catalogosListos) return;
        seleccion.hidden = true; confirmacion.hidden = false;
        porId('tituloConfirmacionPreferencias').focus();
    });
    porId('cancelarConfirmacionPreferencias').addEventListener('click', () => {
        if (ocupado) return;
        confirmacion.hidden = true; seleccion.hidden = false; porId('confirmarPreferenciasRegistro').focus();
    });
    porId('guardarPreferenciasRegistro').addEventListener('click', async () => {
        if (ocupado || !pendiente) return;
        ocupado = true;
        porId('guardarPreferenciasRegistro').disabled = true; porId('cancelarConfirmacionPreferencias').disabled = true;
        informar('Guardando tu cuenta y tus preferencias…');
        try {
            pendiente.revision = (pendiente.revision || 0)+1;
            const d = await api('/usuarios/registro/finalizar', { token:pendiente.token, revision:pendiente.revision,
                alergias:idsSeleccionados('alergias'), intolerancias:idsSeleccionados('intolerancias') });
            if (d.redirect !== '/usuarios/login') throw new Error('No se recibió una confirmación válida del registro.');
            informar('Tu cuenta y tus preferencias se guardaron correctamente.');
            window.location.assign('/usuarios/login');
        } catch (e) { informar(e.message,true); }
        finally { ocupado = false; porId('guardarPreferenciasRegistro').disabled = false; porId('cancelarConfirmacionPreferencias').disabled = false; }
    });
    registro.addEventListener('submit', async e => {
        e.preventDefault(); if (ocupado || !registro.reportValidity()) return;
        ocupado = true;
        const enviar = registro.querySelector('[type="submit"]'); enviar.disabled = true;
        try {
            const d = await api(registro.action, Object.fromEntries(new FormData(registro)));
            registro.querySelector('[name="password"]').value = '';
            await abrir(d);
        } catch (e) {
            const aviso = porId('errorRegistroPreferencias'); aviso.textContent = e.message; aviso.hidden = false;
        } finally { ocupado = false; enviar.disabled = false; }
    });
    api('/usuarios/registro/pendiente').then(d => { if (!pendiente && (d.pendiente || d.completado)) return abrir(d); }).catch(e => {
        const aviso = porId('errorRegistroPreferencias'); aviso.textContent = 'No pudimos consultar el registro pendiente. Recarga antes de continuar.'; aviso.hidden = false;
    });
})();

(() => {
    const boton = document.getElementById('contratarPayPal');
    const aviso = document.getElementById('avisoSuscripcion');
    const verificar = document.getElementById('verificarPayPal');
    const cancelar = document.getElementById('cancelarPayPal');
    if (!aviso) return;
    let config, ocupada = false, clave = null, operacion = null, temporizador = null, inicio = Date.now();
    let comprobante = null;
    const claveAviso = () => `cookiq:paypal:aviso:${operacion}`;
    function recordarAviso(valor) {
        comprobante = valor;
        try { if (valor) sessionStorage.setItem(claveAviso(),valor); else sessionStorage.removeItem(claveAviso()); }
        catch { /* El seguimiento continúa aunque el navegador bloquee el almacenamiento. */ }
    }
    function repetir(segundos = 30) {
        clearTimeout(temporizador);
        if (Date.now()-inicio < 600000) temporizador = setTimeout(comprobar,Math.max(2,segundos)*1000);
        else { window.CookIQEsperaPayPal?.prolongada(); mensaje('La contratación sigue pendiente. El servidor continuará verificándola mientras CookIQ esté ejecutándose. Puedes volver a consultar su estado; no vuelvas a comprar.'); }
    }
    const mensaje = (texto,error = false) => {
        aviso.textContent = texto; aviso.setAttribute('role',error ? 'alert':'status');
    };
    async function api(ruta,opciones = {}) {
        const r = await fetch(`/api/paypal/${ruta}`,{ credentials:'same-origin',cache:'no-store',...opciones });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.mensaje || 'No se pudo verificar PayPal Sandbox. No se confirmó una activación.');
        return d;
    }
    function controles() {
        if (boton) boton.disabled = ocupada || !config?.preparado || config.masterchef;
        if (verificar) verificar.disabled = ocupada || !operacion || !config?.preparado;
        if (cancelar) {
            cancelar.hidden = !operacion || !['ACTIVE','SUSPENDED'].includes(config?.estado);
            cancelar.disabled = ocupada || !config?.preparado;
        }
    }
    async function comprobar() {
        if (ocupada || !operacion || !config?.preparado) return;
        const inicioConsulta = Date.now();
        clearTimeout(temporizador);
        ocupada = true; controles();
        try {
            const d = await api(`estado?operacion=${encodeURIComponent(operacion)}`);
            console.info('[PayPal: actualización visual]',{consultaEstadoMs:Date.now()-inicioConsulta,
                desdeAperturaMs:Date.now()-inicio,masterchef:d.masterchef});
            mensaje(d.mensaje); config.estado = d.estado;
            if (d.masterchef || !d.pendienteActivacion || d.estadoVerificacion === 'error_temporal') window.CookIQEsperaPayPal?.terminar();
            else window.CookIQEsperaPayPal?.iniciar();
            if (d.masterchef && comprobante) {
                await api('notificacion-compra',{method:'POST',headers:{'Content-Type':'application/json','X-PayPal-CSRF':config.csrf},
                    body:JSON.stringify({operacion,comprobanteAviso:comprobante})});
                recordarAviso(null);
                window.location.assign('/suscripciones?paypal=activado'); return;
            }
            if (d.masterchef && !config.masterchef) {
                // Una navegación consulta otra vez el plan y actualiza los candados EJS.
                window.location.assign('/suscripciones?paypal=activado'); return;
            }
            if (d.pendienteActivacion) repetir(d.reintentarEnSegundos);
        } catch (e) { window.CookIQEsperaPayPal?.terminar(); mensaje(e.message,true); repetir(); }
        finally { ocupada = false; controles(); }
    }
    boton?.addEventListener('click',async () => {
        if (ocupada || !config?.preparado || config.masterchef) return;
        ocupada = true; controles(); mensaje('Preparando contratación de prueba en PayPal Sandbox…');
        try {
            // Se conserva la clave ante errores de red y clics repetidos de esta página.
            clave ||= crypto.randomUUID();
            const d = await api('suscripciones',{method:'POST',headers:{'Content-Type':'application/json',
                'X-PayPal-CSRF':config.csrf,'Idempotency-Key':clave},body:'{}'});
            operacion = d.operacion;
            if (d.comprobanteAviso) recordarAviso(d.comprobanteAviso);
            if (d.aprobacion) {
                const url = new URL(d.aprobacion);
                if (url.protocol !== 'https:' || url.hostname !== 'www.sandbox.paypal.com') throw new Error('El enlace de aprobación no corresponde a PayPal Sandbox.');
                window.location.assign(url.href); return;
            }
            mensaje('La operación ya existe. Verifica su estado antes de iniciar otra contratación.');
        } catch (e) { mensaje(e.message,true); }
        finally { ocupada = false; controles(); }
    });
    verificar?.addEventListener('click',() => { inicio = Date.now(); comprobar(); });
    window.addEventListener('pagehide',() => clearTimeout(temporizador));
    cancelar?.addEventListener('click',async () => {
        if (ocupada || !operacion || !config?.preparado) return;
        ocupada = true; controles();
        try {
            const d = await api('cancelar',{method:'POST',headers:{'Content-Type':'application/json','X-PayPal-CSRF':config.csrf},body:JSON.stringify({operacion})});
            config.estado = 'CANCELLED'; mensaje(d.mensaje);
        } catch (e) { mensaje(e.message,true); }
        finally { ocupada = false; controles(); }
    });
    (async () => {
        try {
            config = await api('configuracion'); operacion = config.operacion;
            const p = new URLSearchParams(location.search), solicitada = p.get('operacion');
            if (solicitada && /^[0-9a-f-]{36}$/i.test(solicitada)) operacion = solicitada;
            try { comprobante = sessionStorage.getItem(claveAviso()); } catch { /* Almacenamiento opcional. */ }
            if (!config.preparado) mensaje(config.mensaje);
            else if (config.origen !== location.origin) {
                config.preparado = false; mensaje(`Para conservar tu sesión durante el retorno, abre CookIQ e inicia sesión en ${config.origen}.`,true);
            } else if (p.get('paypal') === 'cancelado') mensaje('Saliste de la aprobación. Ese retorno no confirma un cobro ni cancela contratos existentes.');
            else if (p.get('paypal') === 'activado' && config.masterchef && !comprobante) mensaje('MasterChef está disponible. Tus permisos se consultaron nuevamente desde el servidor.');
            else if ((p.get('paypal') === 'retorno' || config.pendienteActivacion || comprobante) && operacion) { if (!config.masterchef) window.CookIQEsperaPayPal?.iniciar(); await comprobar(); }
            else if (config.modoLocal) mensaje(config.mensaje);
            controles();
        } catch (e) { mensaje(e.message,true); controles(); }
    })();
})();

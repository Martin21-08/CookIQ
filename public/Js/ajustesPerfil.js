// Modal exclusivo de Mi Perfil. El tema se gestiona en tema.js.
(() => {
    const boton = document.getElementById('abrirAjustesPerfil');
    const dialogo = document.getElementById('ajustesPerfil');
    if (!boton || !dialogo || typeof dialogo.showModal !== 'function') return;
    let cerrando = false, focoAnterior, desbordamiento;
    const movimientoReducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.movimientoReducido === 'true';
    const salir = document.getElementById('cerrarSesionAjustes');
    salir?.addEventListener('click', async () => {
        const original = document.getElementById('cerrarSesion');
        if (typeof original?.onclick !== 'function' || salir.disabled) return;
        salir.disabled = true;
        dialogo.close();
        // Deja terminar el cierre y la restauración del foco antes de confirmar.
        await new Promise(resolve => setTimeout(resolve, 0));
        try {
            await original.onclick({ currentTarget: original });
            if (!original.disabled) boton.click();
        } finally { salir.disabled = false; }
    });
    boton.hidden = false;
    boton.addEventListener('click', () => {
        if (dialogo.open || cerrando || document.querySelector('dialog[open]')) return;
        focoAnterior = document.activeElement;
        desbordamiento = document.body.style.overflow;
        dialogo.showModal();
        boton.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
        dialogo.querySelector('[data-cerrar-ajustes]').focus();
    });
    function cerrar() {
        if (!dialogo.open || cerrando) return;
        cerrando = true;
        dialogo.classList.add('ajustes-perfil-saliendo');
        const terminar = () => dialogo.close();
        if (movimientoReducido()) terminar();
        else setTimeout(terminar, 280);
    }
    dialogo.querySelector('[data-cerrar-ajustes]').addEventListener('click', cerrar);
    dialogo.addEventListener('cancel', evento => { evento.preventDefault(); cerrar(); });
    dialogo.addEventListener('click', evento => {
        if (evento.target !== dialogo) return;
        const r = dialogo.getBoundingClientRect();
        if (evento.clientX < r.left || evento.clientX > r.right || evento.clientY < r.top || evento.clientY > r.bottom) cerrar();
    });
    dialogo.addEventListener('close', () => {
        dialogo.classList.remove('ajustes-perfil-saliendo');
        cerrando = false;
        boton.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = desbordamiento;
        if (focoAnterior?.isConnected) focoAnterior.focus();
    });
})();

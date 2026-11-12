// Presentación únicamente: el servidor decide si incluye esta bienvenida.
(() => {
    const dialogo = document.getElementById('bienvenidaMasterChef');
    if (!dialogo || typeof dialogo.showModal !== 'function') return;
    let mostrada = false;
    function mostrar() {
        if (mostrada || document.querySelector('dialog[open]')) return;
        mostrada = true;
        dialogo.showModal();
    }
    dialogo.querySelector('.masterchef-bienvenida-cerrar').addEventListener('click', () => dialogo.close());
    // Espera el cierre de un aviso existente sin superponer confirmaciones.
    const observador = new MutationObserver(mostrar);
    observador.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    dialogo.addEventListener('close', () => observador.disconnect(), { once: true });
    mostrar();
})();

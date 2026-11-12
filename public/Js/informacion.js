// Exclusivo de Descubre. El tema compartido se gestiona en tema.js.
(() => {
    const boton = document.getElementById('info-menu-boton');
    const menu = document.getElementById('info-menu');
    if (!boton || !menu) return;
    const movil = window.matchMedia('(max-width: 900px)');
    function cerrar(devolverFoco = false) {
        boton.setAttribute('aria-expanded', 'false');
        menu.hidden = movil.matches;
        if (devolverFoco) boton.focus();
    }
    boton.hidden = false;
    cerrar();
    boton.addEventListener('click', () => {
        const abierto = boton.getAttribute('aria-expanded') === 'true';
        boton.setAttribute('aria-expanded', String(!abierto));
        menu.hidden = abierto;
    });
    menu.addEventListener('click', evento => {
        if (movil.matches && evento.target.closest('a')) cerrar(true);
    });
    document.addEventListener('keydown', evento => {
        if (evento.key === 'Escape' && movil.matches && boton.getAttribute('aria-expanded') === 'true') cerrar(true);
    });
    if (movil.addEventListener) movil.addEventListener('change', () => cerrar());
    else if (movil.addListener) movil.addListener(() => cerrar());

    // El contenido es visible por defecto, incluso sin JS o sin IntersectionObserver.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
        let observador;
        try {
            observador = new window.IntersectionObserver(entradas => {
                for (const entrada of entradas) if (entrada.isIntersecting) {
                    entrada.target.classList.remove('info-por-aparecer');
                    observador.unobserve(entrada.target);
                }
            }, { threshold: 0.08 });
            document.documentElement.classList.add('info-animar');
            document.querySelectorAll('[data-info-aparecer]').forEach(elemento => {
                // No ocultar contenido que ya esté dentro de la pantalla.
                if (elemento.getBoundingClientRect().top > window.innerHeight) {
                    elemento.classList.add('info-por-aparecer');
                    observador.observe(elemento);
                }
            });
        } catch {
            observador?.disconnect();
            document.documentElement.classList.remove('info-animar');
        }
    }
})();

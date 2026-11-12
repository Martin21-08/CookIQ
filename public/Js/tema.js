// Preferencia visual compartida. No consulta APIs ni modifica sesiones.
(() => {
    const raiz = document.documentElement;
    const clave = 'cookiq:descubre:tema';
    if (document.currentScript?.hasAttribute('data-cookiq-privado')) raiz.classList.add('cookiq-privado');
    let tema = 'claro';
    try { if (localStorage.getItem(clave) === 'oscuro') tema = 'oscuro'; } catch { /* Almacenamiento opcional. */ }
    function aplicar(valor) {
        tema = valor === 'oscuro' ? 'oscuro' : 'claro';
        raiz.dataset.tema = tema;
        document.querySelectorAll('[data-cookiq-tema]').forEach(boton => {
            const etiqueta = tema === 'oscuro' ? 'Activar modo claro' : 'Activar modo oscuro';
            boton.setAttribute('aria-pressed', String(tema === 'oscuro'));
            boton.setAttribute('aria-label', etiqueta);
            boton.title = etiqueta;
        });
    }
    aplicar(tema);
    function iniciar() {
        aplicar(tema);
        document.querySelectorAll('[data-cookiq-tema]').forEach(boton => {
            boton.hidden = false;
            boton.addEventListener('click', () => {
                aplicar(tema === 'oscuro' ? 'claro' : 'oscuro');
                try { localStorage.setItem(clave, tema); } catch { /* Funciona durante esta visita. */ }
            });
        });
        raiz.classList.add('info-tema-listo');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
    else iniciar();
    window.addEventListener('storage', evento => {
        if (evento.key === clave || evento.key === null) aplicar(evento.newValue);
    });
})();

// Preferencia visual privada, independiente del modo claro/oscuro.
(() => {
    const raiz = document.documentElement;
    if (!raiz.classList.contains('cookiq-privado')) return;
    const clave = 'cookiq:reducir-animaciones';
    const sistema = window.matchMedia('(prefers-reduced-motion: reduce)');
    let elegida = false;
    try { elegida = localStorage.getItem(clave) === 'true'; } catch { /* Preferencia opcional. */ }
    function aplicar() {
        raiz.dataset.movimientoReducido = String(elegida || sistema.matches);
        const control = document.getElementById('reducirAnimaciones');
        if (control) {
            control.checked = elegida || sistema.matches;
            control.disabled = sistema.matches;
            control.title = sistema.matches ? 'La reducción de movimiento está activada en tu dispositivo.' : 'Reducir animaciones';
        }
    }
    aplicar();
    function iniciar() {
        aplicar();
        document.getElementById('reducirAnimaciones')?.addEventListener('change', evento => {
            elegida = evento.target.checked;
            try { localStorage.setItem(clave, String(elegida)); } catch { /* Funciona durante esta visita. */ }
            aplicar();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
    else iniciar();
    sistema.addEventListener('change', aplicar);
    window.addEventListener('storage', evento => {
        if (evento.key !== clave && evento.key !== null) return;
        elegida = evento.key === clave && evento.newValue === 'true';
        aplicar();
    });
})();

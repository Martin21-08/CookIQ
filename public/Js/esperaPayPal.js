// Capa visual exclusivamente: no consulta pagos ni concede beneficios.
(() => {
    const dialogo = document.getElementById('esperaPayPal');
    if (!dialogo || typeof dialogo.showModal !== 'function') return;
    const texto = document.getElementById('progresoEsperaPayPal');
    let iniciada = false, descartada = false, tiempos = [];
    const limpiar = () => { tiempos.forEach(clearTimeout); tiempos = []; };
    function terminar() {
        limpiar();
        iniciada = false;
        if (dialogo.open) dialogo.close();
    }
    function iniciar() {
        if (iniciada || descartada || document.querySelector('dialog[open]')) return;
        iniciada = true;
        dialogo.classList.remove('paypal-espera-prolongada');
        texto.textContent = 'Estamos verificando tu pago con PayPal...';
        dialogo.showModal();
        tiempos = [setTimeout(() => {
            texto.textContent = 'Estamos confirmando tu suscripción MasterChef...';
        }, 8000), setTimeout(() => {
            texto.textContent = 'Tu activación está tardando un poco más de lo habitual. Seguimos comprobando el estado del pago';
        }, 25000)];
    }
    function prolongada() {
        limpiar();
        dialogo.classList.add('paypal-espera-prolongada');
        texto.textContent = 'Tu pago todavía está en verificación. PayPal aún no confirma la activación. Puedes consultar el estado de tu contratación desde Suscripciones.';
    }
    document.getElementById('cerrarEsperaPayPal').addEventListener('click', () => { descartada = true; terminar(); });
    dialogo.addEventListener('cancel', () => { descartada = true; limpiar(); iniciada = false; });
    window.addEventListener('pagehide', limpiar);
    window.CookIQEsperaPayPal = { iniciar, terminar, prolongada };
})();

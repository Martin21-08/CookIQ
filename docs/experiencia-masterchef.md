# Experiencia visual MasterChef

## Ventana de espera PayPal

El retorno vigente del controlador programa la verificación y redirige a `/suscripciones?paypal=retorno`; no utiliza una vista separada paypal-verificacion. El script existente consulta estado y conserva la conciliación del servidor.

Se añadió un diálogo visual inspirado en la estructura de `avisoGoogle.ejs`: logo original `/Img/54479.jpg`, corona del parcial existente, panel redondeado, fondo atenuado y spinner circular. No se modificó ninguna ventana o archivo de autenticación Google.

### Archivos

- Nuevo `views/Partials/esperaPayPal.ejs`: diálogo accesible, textos solicitados y botón para continuar en Suscripciones sin abandonar ni cancelar la verificación.
- Nuevo `public/Css/paypalEspera.css`: apariencia exclusiva de la espera, entrada de 220 ms, giro circular, temas existentes, tamaños adaptables y movimiento reducido.
- Nuevo `public/Js/esperaPayPal.js`: presentación, mensajes informativos a los 8 y 25 segundos, cierre/limpieza de temporizadores. Sin fetch ni operaciones de pago.
- `views/suscripciones.ejs`: incluye CSS, diálogo y script antes del script PayPal existente.
- `public/Js/paypal.js`: llamadas opcionales a la capa visual en las ramas de respuesta ya existentes. No se modifican solicitudes, parámetros, intervalos, validaciones, activación ni redirecciones.
- Este documento. No existe un documento separado de PayPal entre los archivos actuales de docs.

### Estados y bienvenida

La espera comienza al retomar una operación existente y continúa solo mientras el servidor indica pendiente. Los temporizadores cambian texto de espera, nunca conceden beneficios, detienen consultas ni simulan éxito. Si la respuesta marca error temporal o falla una consulta, se cierra la capa y permanece visible el mensaje original. Cancelaciones/finalizaciones no muestran bienvenida.

Al recibir masterchef confirmado se cierra el diálogo y se conserva la redirección inmediata original, sin añadir demoras para animar una salida. La nueva página utiliza la bienvenida existente, todavía condicionada al flash de compra confirmada y al plan efectivo. No se duplican flashes ni se incluyen dos diálogos abiertos a la vez. Una sesión que ya dispone de otro diálogo no abre la capa encima de él.

Al agotarse el límite de consultas del cliente ya existente (10 minutos), se oculta el spinner y se presenta «Tu pago todavía está en verificación», indicando que puede consultar desde Suscripciones. La conciliación existente permanece intacta. Seguir en Suscripciones o Escape descarta únicamente la capa visual; no inicia compras ni cancela/reinicia consultas.

En claro se usan blanco rosado, lavanda, morado y naranja; en oscuro, panel y texto del tema, corona champán, spinner lavanda/naranja. El movimiento reducido elimina entrada/giro sin ocultar el texto de estado ni representar éxito. Los cambios de preferencia se aplican mediante CSS del tema actual.

### Verificaciones

- 71 pruebas aisladas PayPal/suscripciones aprobadas.
- Sintaxis de ambos scripts de presentación/integración correcta.
- Simulación VM: apertura, progresión informativa, permanencia pendiente tras temporizadores, estado prolongado, cierre y descarte sin reapertura automática; ausencia de llamadas API en el nuevo componente.
- Sin compras, cobros, llamadas reales PayPal, SQL ni modificaciones de MySQL. Servicios, controladores, contratos, credenciales y Google permanecen intactos.
- Pendiente en navegador: checkout y retorno reales, transición hacia bienvenida tras cobro, apariencia en ambos temas, móvil, foco y animación. La salida no agrega una transición retardada: se priorizó conservar el tiempo y la redirección del flujo original.

## Corona del saludo y destellos mejorados

Archivos modificados en esta actualización: `views/lobby.ejs`, `views/Partials/bienvenidaMasterChef.ejs`, `public/Css/masterchefVisual.css` y este documento. No se modifica JavaScript.

El saludo conserva exactamente su texto y nombre dinámico escapado. Se antepone el SVG de corona existente únicamente con `planActual.masterchef` efectivo. La corona es decorativa, mide 1 em respecto al título (se adapta a su tamaño responsive), se alinea con el texto y tiene margen derecho proporcional. Gratis no recibe el elemento.

Colores compartidos mediante variables CSS privadas: claro #7845B0 y detalle #A56FD0; oscuro corona #F3CF85 y detalle #C89AFF. Se aplica también el color de corona al distintivo existente. El saludo no tiene animación permanente.

En la bienvenida se reemplaza el texto decorativo de estrellas por un único SVG de destellos de dos trazos, grosor 2,7 px. Claro: #7845B0 y #A56FD0 con sombra morada suave. Oscuro: #FFF8FF y #DDBBFF con resplandor blanco discreto. Se mejora la misma animación `masterchef-destellos`, de 1,7 segundos, con aparición, escala .8 a 1.08 y desvanecimiento final. No hay bucles ni nuevos disparadores. Los destellos tienen pointer-events none y no bloquean controles.

El cambio de tema solo actualiza variables, no recrea elementos ni dispara animaciones. Tanto prefers-reduced-motion como la preferencia privada ocultan los destellos y conservan la bienvenida estática. La condición de activación de la bienvenida permanece intacta.

Pruebas aisladas: renderizado Gratis sin corona y MasterChef con corona; nombre Martin conservado; ausencia de bienvenida sin señal de compra; un único SVG de destellos y grosor 2,7 px. Las 71 pruebas de PayPal/suscripciones aprobaron. No se realizaron compras, SQL o llamadas a OpenAI.

Pendiente de revisión visual en navegador: proporción y alineación finales, contraste en ambos temas, diseño móvil y animación real con movimiento reducido. No se afirma haber probado visualmente estos casos. PayPal, suscripciones, permisos y demás funcionalidades no se modificaron.

## Reparación del inicio de contratación PayPal

La vista actual había perdido `#avisoSuscripcion`. En `public/Js/paypal.js`, `if (!aviso) return` detiene toda la inicialización cuando falta: no se consulta configuración, no se registra el clic y el botón conserva su disabled inicial. No era un problema del nuevo texto, del SVG o del evento original. La comparación con el commit `72094d2` confirmó que el contenedor existía anteriormente.

Se restauró únicamente en `views/suscripciones.ejs` el párrafo `#avisoSuscripcion` con role status y aria-live polite. También se recuperó debajo de las tarjetas el aviso ficticio completo `#informacionPayPalSandbox`, ya referenciado por aria-describedby del botón. No se alteró el botón, las tarjetas, CSS, scripts, servicios, controladores ni credenciales.

El JavaScript original vuelve a inicializarse: GET `/api/paypal/configuracion`, habilitación según configuración y plan, clic con POST `/api/paypal/suscripciones`, CSRF e idempotencia existentes y redirección solo al dominio Sandbox permitido. Retorno, conciliación, cobros, cobertura y activación permanecen sin cambios. La bienvenida sigue condicionada a la señal del backend y no al clic de compra.

Pruebas: 71 pruebas aisladas de PayPal y suscripciones aprobadas. Evaluación VM del script original con fetch simulado: Gratis consulta configuración, habilita el botón, envía POST y redirige a Sandbox; MasterChef mantiene el botón bloqueado y no crea contratación. Sin llamadas reales, SQL ni compras.

Pendiente manual: con usuario Gratis abrir Suscripciones y comprobar que el botón se habilita si la configuración está preparada. Al hacer clic debe iniciar el checkout Sandbox y mostrar sus mensajes originales. No se realizó ese clic real porque requiere autorización para crear una contratación. Tampoco se verificaron visualmente móvil/temas ni el ciclo completo de pago y retorno en esta reparación. El diseño del botón y sus reglas CSS permanecen intactos.

## Estado efectivo

Se reutiliza `planActual.masterchef`, calculado por `suscripcionModel.obtenerPlan()` con usuario, plan y contrato activo/vigente. No se modificaron modelo, middleware, contratos, consultas ni permisos. Gratis conserva sus indicadores y bloqueos actuales.

## Presentación

El Sidebar compartido muestra corona y MasterChef únicamente con acceso efectivo activo. Se ubica en el espacio existente entre logo y menú, sin mover títulos ni modificar el logo. En móvil conserva una corona compacta con tooltip. No se modifica su fotografía o degradado.

Las páginas privadas que incluyen Sidebar y temaPrivado comparten el distintivo (Cocina, Despensa/Lista de compras, Favoritos, Historial, Perfil y Suscripciones). Login, Register y Descubre no reciben estos cambios.

Los indicadores existentes de funciones exclusivas se conservan. Mostrar ingredientes faltantes mantiene su indicador visual anterior y su checkbox habilitado para Gratis: no se anuncia como nueva ventaja desbloqueada en la bienvenida. Agregar a Lista de Compras mantiene su autorización real.

Se añaden contornos lavanda a buscador, secciones del perfil, bloques de historial y tarjetas de receta únicamente cuando el Sidebar declara MasterChef efectivo. La sección activa recibe un contorno un poco más destacado. No se cambian colores principales, datos o acciones. Claro mantiene fondos originales y distintivo lavanda; oscuro reutiliza `--tema-panel`, `--text` y `--tema-acento`.

## Bienvenida

Se reutiliza exactamente el flash de compra exitosa existente generado por `paypalController.notificarCompra()`, y se exige además MasterChef efectivo. El backend ya registra la notificación de compra de forma persistente. No se utilizan parámetros de URL, estado ACTIVE o localStorage para simular una compra. No se modifica PayPal.

El Sidebar incluye el diálogo y su script solo con ambas condiciones. La bienvenida contiene corona, mensaje solicitado, ventajas reales y enlace `/lobby`. Animación de entrada y destellos discretos de 1,7 segundos, sin bucle. El contenido permanece hasta cerrarlo o continuar: la duración es la animación, no una espera obligatoria. X y Escape permiten cerrar inmediatamente. El diálogo nativo proporciona semántica y foco; no se superpone a otro diálogo abierto, sino que espera su cierre. El observador se desconecta al cerrar la bienvenida.

Se respeta tanto `prefers-reduced-motion` como la preferencia privada de reducir animaciones. Sin JavaScript no aparece un modal bloqueante.

## Archivos

- `views/Partials/Sidebar.ejs`: distintivo y condición de bienvenida.
- `views/Partials/temaPrivado.ejs`: carga del nuevo CSS privado.
- Nuevo `views/Partials/bienvenidaMasterChef.ejs`: presentación de bienvenida reutilizando el SVG de corona existente.
- Nuevo `public/Css/masterchefVisual.css`: detalles premium, ambos temas, móvil, animación y reducción de movimiento.
- Nuevo `public/Js/bienvenidaMasterChef.js`: apertura/cierre visual y espera de otros diálogos; sin APIs ni cambios de sesión.
- Este documento.

## Verificaciones y limitaciones

- Seis escenarios EJS aislados: Gratis/MasterChef con flash ausente, compra confirmada o mensaje pendiente. Solo MasterChef con flash exacto recibe bienvenida; solo MasterChef recibe distintivo.
- 20 pruebas aisladas de suscripciones aprobadas; sintaxis del nuevo JavaScript correcta. Sin SQL, cambios de suscripciones reales, llamadas OpenAI o compras.
- No se modificaron permisos ni lógica de suscripciones. Los contornos dependen del atributo generado por el servidor y no conceden acceso.
- La bienvenida depende del flash existente: si una ruta consume ese flash sin renderizar Sidebar, no se reproduce después. Se conserva el manejo original del flash; no se crea una segunda confirmación ni mecanismo de notificación persistente.
- No se promete una sola visualización frente a navegación Atrás con caché del navegador; el Sidebar existente ya recarga páginas restauradas desde caché. No se agregan marcas de compra en el navegador.
- Pendientes de pruebas reales: checkout y flash de activación, no repetición al actualizar, foco y cierre con lectores de pantalla, apariencia clara/oscura, móviles y permisos con contrato vencido. Las simulaciones no sustituyen esas comprobaciones. No se realizó una compra real ni Sandbox.

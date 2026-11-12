# Textos de suscripciones

## Reorganización de botones inferiores

- Archivos modificados: `views/suscripciones.ejs`, `public/Css/Style.css` y este documento.
- Ambos controles quedan dentro de `.suscripciones-acciones-inferiores`, después de las tarjetas: enlace «Volver a mi cocina» primero y botón «Verificar mi contratación PayPal» después. Flex con `justify-content: space-between` los alinea con los extremos del contenedor, sin posicionamiento absoluto o fijo.
- Se reutiliza `.boton-generar` en ambos: mismo degradado, fuente, padding, bordes, hover y transiciones. Reglas locales agregan alineación interna, altura mínima común de 46 px y eliminan el subrayado del enlace. No se utiliza `.suscripcion-volver`, para evitar su color y subrayado anteriores.
- Flecha izquierda SVG decorativa en el enlace; verificación reutilizada del parcial SVG existente en el botón. Ambos heredan el color blanco y miden 18 px.
- Separación de 16 px y ajuste de línea; hasta 600 px se apilan al ancho disponible, conservando volver antes de verificar. Los textos admiten varias líneas.
- Se conserva `href="/lobby"`, el ID `verificarPayPal`, `type="button"` y su estado `disabled` inicial. No se modificaron eventos, JavaScript, rutas, pagos, permisos ni tarjetas. El botón independiente de cancelar renovaciones permanece intacto.
- Verificación EJS aislada en ambos planes: orden, ruta, clase común, dos íconos y atributos del botón correctos. `node --check public/Js/paypal.js` sin errores de sintaxis.
- Suite aislada PayPal/suscripciones: 70 pruebas aprobadas y una fallida. El fallo corresponde al aviso `USD $1.00 mensual ficticio`, ausente en la vista recibida antes de esta modificación; esta tarea no lo eliminó ni lo restauró. También se observó que falta el elemento `avisoSuscripcion`, que el JavaScript existente requiere para registrar sus acciones: la comprobación real del clic queda limitada por ese estado previo. No se corrigió por estar fuera del alcance autorizado.
- Pendiente de prueba visual en navegador: alineación en escritorio, presentación móvil y ambos temas. No se realizó una compra ni se ejecutó SQL.

## Actualización visual de las tarjetas

Archivos de esta actualización:

- `views/suscripciones.ejs`: líneas 34–38 y 50–55, íconos junto a los beneficios; línea 57, frase y corona del botón de contratación; línea 60, aviso Sandbox fuera de las tarjetas y asociado al botón mediante `aria-describedby`.
- `views/Partials/iconoSuscripcion.ejs`: nuevo parcial de SVG locales, siguiendo el formato de íconos SVG existente. Sin bibliotecas ni dependencias adicionales. Íconos decorativos con `aria-hidden` y sin foco.
- `public/Css/Style.css`: reglas aisladas de beneficios, recuadros de 36 × 36 px, íconos de 22 × 22 px, separación uniforme, corona y ajuste del texto largo del botón. Variante morada oscura limitada a estos íconos. No se cambian fondos, dimensiones, bordes ni distribución de las tarjetas, ni degradado o efectos del botón.
- `docs/textos-suscripciones.md`: este registro.

Gratis incorpora calendario, corazón, historial, escudo con verificación y usuario con lápiz. MasterChef incorpora infinito, refrigerador, gorro de chef, carrito, lista con + y círculo con verificación. Se conservan los textos y su orden.

Se retiró de la tarjeta la frase «Se mantienen las protecciones técnicas contra abuso». Las protecciones reales permanecen intactas. El párrafo completo sobre USD $1.00 mensual ficticio se trasladó debajo de ambas tarjetas: sigue visible antes de pulsar contratar y antes de la operación PayPal, sin ocupar la presentación comercial de MasterChef.

El botón de contratación muestra «Conviértete en el MasterChef de tu cocina» con una corona. El estado «Tu plan actual» permanece intacto. Se conservan ID, evento, estado deshabilitado inicial, scripts, rutas y comportamiento PayPal. No se modificó ningún archivo JavaScript, modelo, servicio o controlador. No se ejecutó SQL ni se realizaron compras.

Verificaciones de esta actualización:

- 71 pruebas aisladas de PayPal y suscripciones aprobadas.
- Renderizado EJS para Gratis y MasterChef, utilizando el parcial real de íconos: 11 íconos de beneficios con trazos definidos y corona únicamente en el estado de contratación.
- Precios $0 CLP y $7.990 CLP al mes conservados; aviso Sandbox presente fuera de las tarjetas y asociado al botón.
- Reglas de texto flexible, tamaño fijo solo en íconos y adaptación del botón largo revisadas. Estilos claros y oscuros definidos sin cambiar el tema global.
- Pendiente de comprobación visual en navegador: alineación final, tamaños en computadores y celulares, contraste en ambos temas y ausencia de desbordamientos. No se ha realizado un checkout real; las pruebas aisladas no lo sustituyen.

La sección siguiente documenta el cambio anterior de textos; sus números de línea corresponden a aquella versión.

## Alcance y archivos

- `views/suscripciones.ejs`: descripción de Gratis en línea 32 y beneficios en líneas 34–38; descripción de MasterChef en línea 48 y beneficios en líneas 50–55.
- `docs/textos-suscripciones.md`: documentación nueva.

El cambio mejora la claridad comercial y destaca las funciones existentes. No se modificaron CSS, JavaScript, rutas, controladores, modelos ni datos de MySQL.

## Gratis

Antes no había una descripción introductoria. Los beneficios eran:

- 5 generaciones exitosas al día con IA.
- Historial, favoritos y reseñas.
- Adaptación a tus alergias e intolerancias.
- Sin acceso a Mi Despensa ni Lista de Compras.

Nueva descripción: **Descubre nuevas ideas para cocinar cada día.**

Nuevos beneficios, en orden:

1. 5 generaciones de recetas al día
2. Tus recetas favoritas siempre a mano
3. Historial de tus descubrimientos
4. Recetas adaptadas a tus alergias e intolerancias
5. Un perfil a tu estilo

## MasterChef

Antes no había una descripción introductoria. Los beneficios eran:

- Generaciones con IA sin cuota diaria.
- Mi Despensa y Lista de Compras.
- Historial, favoritos y reseñas.
- Adaptación a tus alergias e intolerancias.

Nueva descripción: **Tu cocina, sin límites. Más recetas, menos complicaciones.**

Nuevos beneficios, en orden:

1. Recetas ilimitadas, inspiración sin fin
2. Tu despensa, bajo control
3. Aprovecha lo que ya tienes
4. Tus compras, más organizadas
5. De la receta a tu lista en un clic
6. Todo lo de Gratis, y mucho más

## Verificaciones

- 71 pruebas aisladas aprobadas mediante `node --test --test-reporter=dot tests/paypal.test.js tests/suscripciones.test.js`.
- Renderizado EJS aislado con plan Gratis y MasterChef: cinco y seis beneficios, precios, botones e indicador del plan actual conservados. Los parciales se sustituyeron por un comentario en esta comprobación aislada.
- Comparación con la vista anterior: únicamente cambiaron las listas y se agregaron las dos descripciones solicitadas.
- Precios intactos: Gratis $0 CLP y MasterChef $7.990 CLP al mes. Se conserva el aviso Sandbox de USD $1.00 ficticio.
- Sin cambios en botones, acciones, scripts, permisos, límites diarios, PayPal o funcionalidades de los planes. No se realizaron compras ni operaciones contra MySQL.
- Se conservan clases, estructura de tarjetas, estilos responsive y carga del tema. No se añadieron anchos fijos ni reglas CSS.
- Pendiente de comprobación visual en navegador: legibilidad, ausencia de desbordamientos en celulares y presentación en ambos temas. Las pruebas aisladas no verifican el diseño visual ni un checkout real.

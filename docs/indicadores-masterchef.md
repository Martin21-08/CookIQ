# Indicadores MasterChef

## Corrección: indicador junto a Mostrar ingredientes faltantes

La implementación anterior incorporó el indicador a la acción dinámica de agregar a la Lista de Compras, pero no al label del checkbox. No era un problema de CSS: el componente no estaba presente en ese marcado.

Se modificó únicamente el label de `pedirFaltantes` en `views/lobby.ejs`, añadiendo `Partials/indicadorMasterChef` después del texto con `Boolean(planActual.masterchef)`. El otro archivo modificado es este documento. No se modificaron CSS, JavaScript ni otros indicadores.

Ambos checkbox reutilizan exactamente el mismo parcial dentro de `.faltantes-check`: mismas clases, SVG, tamaño, tipografía, separación interna y colores de ambos temas. Para Gratis se muestra candado/MasterChef y para MasterChef efectivo, verificación/Disponible. El indicador solicitado es visual: no implica un nuevo bloqueo del checkbox de faltantes, que conserva todos sus atributos y comportamiento. El enlace existente de Usar mi despensa permanece intacto.

Pruebas aisladas: renderizado EJS para ambos planes; componente presente dentro de cada label y marcado de los dos indicadores idéntico; checkbox de faltantes sin disabled; checkbox de despensa con su disabled original para Gratis. Las reglas que compactan/ocultan textos se limitan a `.inicio-menu`, por lo que no ocultan estos indicadores del formulario.

Pendiente de comprobación visual real: ambos temas, móviles, textos sin recortes y clic de los checkbox. No hay navegador automatizado disponible en esta sesión; la comprobación de HTML no sustituye esa revisión visual. No se ejecutó SQL ni se modificaron permisos, generación o datos.

## Indicador de agregar ingredientes faltantes

- El checkbox `pedirFaltantes` no tiene bloqueo visual para Gratis y conserva su estado, evento y valores enviados. No se le añadió un candado.
- Mostrar la lista en las tarjetas depende del checkbox y de los faltantes presentes en el resultado. Es distinto de persistirlos en Lista de Compras.
- `routes/listaCompraRoutes.js` aplica `suscripciones.api` tanto a `/faltantes/calcular` como a `/faltantes`. Por tanto, cálculo mediante esa API y agregado requieren MasterChef actualmente. Esta diferencia con el checkbox habilitado ya existía; no se cambió.
- Se agregó el indicador exclusivamente dentro de la acción «Agregar faltantes a mi lista de compras»: Gratis muestra candado/MasterChef y MasterChef efectivo muestra verificación/Disponible.
- `views/lobby.ejs` agrega un template inerte que reutiliza `Partials/indicadorMasterChef` con `planActual.masterchef`. `public/Js/app.js` incorpora ese marcado en la presentación del botón dinámico. No cambia onclick, disabled, llamadas HTTP, cálculo, generación ni validaciones.
- No se agregaron reglas CSS: se reutilizan los estilos del indicador para ambos temas y su tamaño compacto. El template no aparece por separado en pantalla.
- Verificación aislada: renderizado EJS de ambos planes, checkbox intacto, estado correcto en template y conservación de atributos originales del botón. Sintaxis de app.js comprobada.
- Pendiente de prueba real en navegador: apariencia móvil y ambos temas, interacción de faltantes y agregado según permisos. No se realizaron llamadas OpenAI, SQL ni modificaciones de suscripciones para probar.

## Presentación

Antes se mostraba un emoji de candado para Gratis; MasterChef no tenía indicador. Ahora se utiliza un parcial SVG local reutilizable: candado cerrado y «MasterChef» para acceso bloqueado; verificación y «Disponible» para acceso habilitado. Los estados son excluyentes y tienen nombre accesible y tooltip. No se agregan dependencias ni animaciones.

Se aplica en Mi despensa y Lista de compras del Sidebar, y Usar mi despensa del Lobby. Morado translúcido, lavanda y borde tenue para bloqueo; lavanda/verde suave y borde para disponibilidad. En Sidebar móvil el texto se oculta, manteniendo el pequeño indicador SVG, nombre accesible y tooltip.

## Estado efectivo y permisos

Se reutiliza exclusivamente `planActual.masterchef`, y su variable existente `accesoMasterChef` en Sidebar. `models/suscripcionModel.js` ya comprueba contrato vigente mediante EXISTS: no se infiere acceso desde `usuario.id_suscripcion` en las vistas.

El checkbox conserva exactamente su atributo disabled condicional. El enlace Gratis del Lobby conserva `/despensa` y su etiqueta accesible existente. Los enlaces del Sidebar permanecen intactos. No se modifican middleware, fechas, contratos, cuotas, flash, redirecciones ni JavaScript.

## Archivos

- Nuevo `views/Partials/indicadorMasterChef.ejs`: indicador de estado con SVG decorativo y nombre accesible.
- `views/Partials/Sidebar.ejs`: reemplazo de los dos emojis por el parcial, en ambos estados.
- `views/lobby.ejs`: reemplazo del emoji y agregado del indicador disponible, conservando checkbox y enlace.
- `public/Css/Style.css`: estilos aislados `.indicador-masterchef`, variantes, adaptación al tema oscuro y versión compacta para Sidebar hasta 850 px. No se cambia fondo, dimensiones ni navegación del Sidebar.
- Este documento.

## Verificación

- Renderizado EJS real de Sidebar y Lobby con plan efectivo Gratis y MasterChef: un único estado por indicador; checkbox deshabilitado solo para Gratis.
- Suite aislada existente de suscripciones: 20 pruebas aprobadas, sin operaciones contra MySQL real. Se conserva el nombre accesible anterior «Requiere MasterChef» para el estado bloqueado.
- Inspección del modelo existente: conserva comprobación del contrato activo/vigente. No se crean ni cambian suscripciones para probar.
- Pendiente en navegador: apariencia en ambos temas y dispositivos, accesibilidad visual de tooltips y navegación real con sesiones Gratis, MasterChef y contrato vencido. El renderizado simulado no acredita esas pruebas completas.
- No se ejecutó SQL ni se modificaron backend, permisos o datos reales.

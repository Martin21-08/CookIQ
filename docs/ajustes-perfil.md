# Ajustes de Mi Perfil y apariencia compartida

## Alcance autorizado

El código revisado no tenía botón ni modal de Ajustes y el modo oscuro solo
existía en Descubre. Tras confirmar ese diagnóstico, se autorizó implementar
la función completa descrita en el adjunto, con el botón exclusivamente en
Mi Perfil. No se modificaron lógica de negocio, autenticación, endpoints,
generación, pagos, datos, permisos o conexiones. No se ejecutó SQL.

## Ubicación y presentación

En `views/perfil.ejs`, el encabezado contiene ahora este orden:

```text
[⚙ Ajustes] [Mejorar plan]
```

El enlace original Mejorar plan mantiene su texto, SVG, clase y destino
`/suscripciones`. Ambos controles están en `.perfil-acciones-cabecera`, con
alineación central y separación de 8 px. Se reutiliza `boton-mejorar-plan` para
el aspecto del botón nuevo, sin modificar las reglas globales de esa clase.

La nueva hoja específica vuelve estática la posición de los dos controles
dentro de su grupo y reserva espacio a la derecha del encabezado del perfil.
A 1100 px o menos, el grupo pasa a una fila propia dentro del encabezado,
con `flex-wrap` y ancho completo para evitar superposiciones con avatar y
textos. El orden de Ajustes y Mejorar plan se conserva; si no caben, se permite
el salto de línea. El estilo de otras páginas no cambia en modo claro.

El botón `#abrirAjustesPerfil` y el modal `#ajustesPerfil` solo se incluyen en
Perfil. No se añaden controles a Sidebar, Navbar, Cocina, Favoritos, Historial,
Despensa, Lista de Compras, Suscripciones, Login, Register o Descubre.

## Archivos nuevos

| Archivo | Responsabilidad |
| --- | --- |
| `public/Js/tema.js` | Lee/aplica la preferencia antes del contenido, conecta los interruptores y escucha cambios entre pestañas. |
| `public/Css/tema.css` | Estilos y animación originales del interruptor sol/luna compartidos. |
| `public/Css/temaPrivado.css` | Colores privados en modo oscuro, posición exclusiva de controles del perfil y presentación del nuevo modal. |
| `public/Js/ajustesPerfil.js` | Apertura/cierre, animación de salida, prevención de aperturas repetidas y restauración de foco/scroll. |
| `views/Partials/temaPrivado.ejs` | Carga las hojas específicas y el script de tema en el head privado. No contiene botones. |
| `views/Partials/ajustesPerfil.ejs` | Dialog nativo con Apariencia y Más ajustes; se incluye únicamente en Perfil. |
| `docs/ajustes-perfil.md` | Esta documentación. |

## Archivos existentes modificados

| Archivo | Cambio exacto |
| --- | --- |
| `views/perfil.ejs` | Include de apariencia en el head; grupo de acciones con Ajustes antes del enlace original Mejorar plan; include del dialog y script exclusivo. Formularios, IDs y campos previos conservados. |
| `views/lobby.ejs` | Un include de `Partials/temaPrivado` después de Style.css. |
| `views/favoritos.ejs` | Mismo include del head, sin controles ni cambios en el contenido. |
| `views/historial.ejs` | Mismo include del head. |
| `views/despensa.ejs` | Mismo include del head; también cubre Lista de Compras. |
| `views/suscripciones.ejs` | Mismo include del head; sin alterar botones, precios o PayPal. |
| `views/descubre.ejs` | Bootstrap de apariencia reemplazado por `tema.js`; carga `tema.css`; atributo `data-cookiq-tema` en su botón existente. Sus SVG, textos, dimensiones y destinos permanecen. |
| `public/Js/informacion.js` | La inicialización del interruptor se trasladó a `tema.js`; se conservan menú, scroll y aparición de elementos. |
| `public/Css/informacion.css` | Las seis reglas originales del interruptor se trasladaron a `tema.css`; la paleta y los demás estilos de Descubre se conservan. |

No se modificaron `Style.css`, `public/Js/app.js`, rutas, modelos,
controladores, scripts Google/Firebase, lógica de suscripciones o módulos
de datos. Los includes privados solo añaden recursos de presentación.

## Modal y accesibilidad

- Botón nativo `type="button"`, `aria-haspopup="dialog"`, `aria-controls` y
  `aria-expanded`. No envía formularios.
- Se usa `dialog.showModal()`: el navegador gestiona la capa superior, el
  foco modal y la exclusión de interacciones con el fondo.
- Al abrir, el foco va al botón X. Se bloquea el desplazamiento del fondo.
- Cierre con X, Escape o clic fuera del rectángulo del dialog. Clics interiores
  no cierran la ventana.
- Al terminar, se restaura el foco previo y el valor anterior de `overflow`.
- No se abre otra copia ni se interrumpe una salida en curso por clics repetidos.
- Apariencia contiene la descripción y el interruptor funcional de Modo oscuro.
- Más ajustes contiene solo «Próximamente podrás personalizar más opciones»;
  no hay botones ficticios ni configuraciones adicionales.

El botón permanece oculto sin JavaScript o si el navegador no admite
`showModal`, para no presentar un control que no pueda abrir su ventana.

## Animaciones

El dialog anima opacidad, escala `.97 → 1` y desplazamiento `12px → 0` durante
280 ms. El fondo anima su opacidad. La salida invierte esos estados y el
JavaScript cierra el dialog después de 280 ms. Con movimiento reducido, se
desactivan las animaciones y el cierre es inmediato.

El interruptor comparte los dos SVG originales de Descubre: sol en modo claro,
luna en oscuro. Mantiene su círculo de 42 px, animación de 280 ms, pulsación,
rotación y escala. `aria-pressed` refleja el estado y la etiqueta indica la
acción disponible. No se agregaron librerías.

## Paleta y sincronización

Se reutilizan los colores oscuros de Descubre:

- Fondo `#191320`.
- Paneles/tarjetas `#2b2137`, superficies secundarias `#221a2d`.
- Texto `#f5effa`, texto secundario `#c8b9d3` y acento `#c9a8ef`.
- Bordes `#51405e`, detalles `#372843`.
- Botones degradados `#704b9e → #9b4d16`, como las acciones oscuras de Descubre.

Se mantienen colores semánticos distinguibles para errores, advertencias y
éxitos. No se filtran ni recolorean fotografías, avatares o logos. Los logos de
supermercado que necesitan un fondo claro lo conservan dentro de su caja.

Clave única de localStorage: **`cookiq:descubre:tema`**, valores `claro`/`oscuro`.
El script compartido se ejecuta en el head antes de mostrar el contenido, sin
`defer`, para evitar destellos claros. Se aplican los estilos privados mediante
`html.cookiq-privado[data-tema="oscuro"]`, nunca sobre Login o Register.

Los controles se enlazan al completarse el DOM. Cambiar desde Perfil actualiza
la página y las siguientes visitas a Descubre y a páginas privadas. Se escucha
el evento `storage` para reflejar cambios en otras pestañas. Si el navegador
bloquea localStorage, el interruptor funciona durante la visita sin lanzar un
error, pero no se puede garantizar persistencia entre páginas.

No se usa MySQL, una sesión de usuario, una API ni preferencias independientes.
El modo claro mantiene las reglas previas de Style.css. Solo cambia el
encabezado del perfil para alojar la nueva pareja de acciones.

## Ampliación futura

Agregar futuras secciones en `Partials/ajustesPerfil.ejs` sin incluir ese modal
en componentes globales. Cada opción real necesitará su validación y lógica
propias; por ahora no se implementan endpoints o almacenamiento adicional.
La apariencia debe seguir usando `tema.js` y la misma clave de preferencia.

## Verificaciones realizadas

Evaluaciones aisladas, sin cuentas reales ni base de datos:

1. Aplicación del tema antes de DOMContentLoaded y estado inicial claro.
2. Descubre oscuro → Perfil oscuro → cambio a claro → Descubre claro.
3. Persistencia recreando el documento y sincronización mediante `storage`.
4. Almacenamiento bloqueado: cambio local sin excepción; claves ajenas ignoradas.
5. Etiquetas ARIA y estado del interruptor actualizados.
6. Modal: apertura, bloqueo de doble clic, foco inicial y desplazamiento.
7. Cierre con X, Escape y clic exterior; clic interior no lo cierra.
8. Espera de 280 ms al cerrar y restauración de foco/scroll.
9. Movimiento reducido: cierre inmediato.
10. EJS de las seis vistas privadas renderizado sin errores.
11. Botón y dialog solo en Perfil, en el orden Ajustes → Mejorar plan.
12. Enlace de plan `/suscripciones` y formulario `/api/datos` conservados.
13. Login, Register y Descubre renderizados sin controles privados de Ajustes.
14. `node --check` de los tres scripts implicados: sin errores.
15. Suites existentes aisladas de PayPal y suscripciones: **71 pruebas pasaron**.

Las pruebas de modal y de almacenamiento se hicieron con DOM simulado, no con
un navegador automatizado. No se afirma haber comprobado visualmente todos
los estados dinámicos, el foco nativo entre todos los elementos, el responsive
o el contraste completo en un navegador real. No se hicieron compras, llamadas
OpenAI, registros de usuarios ni escrituras en MySQL.

## Prueba manual pendiente

1. Activar oscuro en Descubre, iniciar sesión y abrir Perfil.
2. Comprobar Ajustes a la izquierda de Mejorar plan en escritorio y móvil.
3. Abrir con ratón y teclado; recorrer el modal con Tab y Shift+Tab.
4. Cerrar con X, Escape y clic exterior; comprobar foco y animaciones.
5. Cambiar tema, actualizar y visitar Cocina, Favoritos, Historial, Despensa,
   Lista de Compras y Suscripciones. Ajustes no debe aparecer en esas páginas.
6. Volver a Descubre y comprobar la preferencia, también entre dos pestañas.
7. Verificar estados de formularios, recetas y avisos con datos reales existentes.
8. Abrir Mejorar plan y comprobar que conserva su destino habitual.
9. Repetir con movimiento reducido y a 360, 768 y 1440 px.
# Ampliación de Ajustes: apariencia, seguridad, información y sesión

## Archivos de esta ampliación

- `views/Partials/ajustesPerfil.ejs`: conserva el control de tema y agrega Reducir animaciones, información de seguridad, panel desplegable Acerca de CookIQ y botón de sesión.
- `public/Js/tema.js`: bloque independiente para la preferencia de movimiento, limitado a documentos privados. La lógica del tema claro/oscuro no se modifica.
- `public/Js/ajustesPerfil.js`: considera la preferencia al cerrar el modal; el nuevo botón delega en el manejador de logout existente y vuelve a abrir Ajustes si se cancela o falla el cierre de sesión.
- `public/Js/app.js`: únicamente textos de la confirmación de logout: «¿Quieres cerrar sesión?», descripción solicitada y «Sí, cerrar sesión». No cambia petición, invalidación, limpieza local ni redirección.
- `public/Css/temaPrivado.css`: estilos locales de opciones y control, contactos y botón de advertencia; reducción de efectos decorativos mediante selectores explícitos.
- `docs/ajustes-perfil.md`: documentación.

## Funcionamiento

La preferencia se guarda en `cookiq:reducir-animaciones` y se aplica al cargar las páginas privadas con `data-movimiento-reducido`. Se sincroniza entre pestañas. La preferencia del sistema `prefers-reduced-motion` siempre prevalece: el interruptor aparece activo y deshabilitado cuando el dispositivo solicita reducción, con explicación en su título. Si localStorage falla, funciona durante la visita.

Se reducen transiciones y movimientos decorativos concretos (navegación, botones, tema, modal Ajustes y opciones de filtros). No se usan selectores universales para detener animaciones; no se ocultan ni detienen indicadores de carga. No se modifica Descubre ni su interruptor de tema. El nuevo switch utiliza los colores y geometría redondeada de CookIQ y semántica accesible `role="switch"`.

Seguridad es informativa: la recuperación ya existe en `/usuarios/recuperar`, pero no se incorpora un enlace de contraseña local para evitar ofrecerlo a cuentas Google. El texto explica ambos tipos de cuenta sin cambiar autenticación.

Acerca se abre mediante `details` dentro de Ajustes. Incluye descripción, los cuatro integrantes y los contactos proporcionados. Enlaces mailto, HTTPS de Instagram con noopener/noreferrer y teléfono normalizado. No se crean páginas ni endpoints.

El botón de sesión cierra el modal de Ajustes y ejecuta exactamente `onclick` del botón de logout del perfil, que ya contiene confirmación y solicitud POST. Cancelar no envía la petición y vuelve a abrir Ajustes. Confirmar conserva `/api/firebase/logout` y retorno a `/usuarios/login`. No se duplica código de autenticación. La confirmación existente se reutiliza con los textos solicitados; también cambia esos textos al cerrar desde el botón original del perfil.

Se conserva el scroll interno y tamaño adaptable del modal, apertura/cierre, Escape, clic exterior y restauración de foco. El botón para abrir Ajustes continúa exclusivo de Mi Perfil, a la izquierda de Mejorar plan.

## Pruebas y límites

- Sintaxis comprobada con `node --check` en los tres archivos JavaScript modificados.
- Evaluación VM aislada de las cuatro combinaciones de preferencia guardada y movimiento reducido del sistema: prioridad del sistema, estado del control y persistencia simulada correctos.
- Compilación EJS del parcial correcta; enlaces de contacto comprobados.
- Inspección del flujo: el nuevo botón usa el manejador original, sin fetch nuevo; se conservan endpoint y redirección.
- No se ejecutó SQL ni se modificó MySQL. No se realizaron llamadas de red ni se cerró una sesión real.
- Pendiente en navegador: apertura/cierre y foco, cancelar/confirmar logout, protección de rutas tras logout, restauración tras recarga, temas, vista móvil y enlaces externos. Las comprobaciones aisladas no acreditan estos recorridos reales.

---

# Corrección de conexión del botón Cerrar sesión en Ajustes

## Causa y cambio mínimo

La vista recibida contenía dos botones con `id="cerrarSesion"`: el original de Mi Perfil y el de Ajustes. El script de Ajustes buscaba `cerrarSesionAjustes`, que no existía; por tanto no registraba su evento.

Se cambió únicamente el ID del botón de Ajustes a `cerrarSesionAjustes` en `views/Partials/ajustesPerfil.ejs` (línea 44). Se conserva su clase, contenido y `type="button"`, evitando envíos de formulario. El otro archivo modificado es este documento.

## Reutilización del flujo existente

`public/Js/ajustesPerfil.js`, sin modificaciones en esta corrección, ya delega en el manejador `onclick` del botón original del perfil. Cierra primero Ajustes para que la confirmación nativa existente no quede detrás de otro modal. Si se cancela, vuelve a abrir Ajustes. El bloqueo temporal evita llamadas duplicadas.

Se reutilizan exactamente la confirmación, sus textos, botones y estilos actuales, así como el tratamiento de errores/mensajes, petición POST a `/api/firebase/logout`, limpieza local y redirección a `/usuarios/login` del flujo original. No se crean flashes ni un segundo logout. No se modifican `app.js`, el botón original, Guardar cambios, autenticación, sesiones o MySQL.

## Verificaciones

- Inspección conjunta de perfil y parcial: un solo ID `cerrarSesion` y un solo ID `cerrarSesionAjustes`.
- Simulación VM del script existente: el botón de Ajustes llama una vez al manejador original; cancelar reabre Ajustes; confirmar no lo reabre; doble clic no duplica la llamada.
- `node --check public/Js/ajustesPerfil.js` correcto.
- No se realizaron peticiones de logout reales ni operaciones SQL. Pendiente en navegador: confirmación visual, foco, cierre real, redirección y protección de páginas privadas tras cerrar sesión. La simulación verifica la conexión, no la invalidación real de sesión.

---


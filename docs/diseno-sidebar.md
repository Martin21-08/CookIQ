# Fondo del Sidebar en modo oscuro

## Actualización de botones de navegación

Archivos modificados: `public/Css/Style.css`, `public/Css/temaPrivado.css` y este documento. Solo se cambian reglas de enlaces `.inicio-menu a`; el fondo del Sidebar permanece intacto.

Antes hover y selección compartían el mismo fondo: degradado rosa/naranja en claro y #49315f en oscuro. Ahora la clase existente `activa` tiene un degradado morado, contorno lavanda mediante sombra interior y una sombra exterior discreta. La sombra interior no cambia dimensiones ni posición del botón. Texto e íconos conservan blanco por herencia de currentColor.

- Claro activo: `--cookiq-purple` (#704b9e) a #583881; contorno #c9a8ef; sombra rgba(55,28,85,.18).
- Oscuro activo: #704b9e a #49315f; contorno `--tema-acento`; sombra rgba(112,75,158,.22).
- Hover: morado rgba(112,75,158,.3), contorno tenue; en oscuro reutiliza `--tema-borde`. La regla activa prevalece también durante hover.
- Normal: sin fondo permanente nuevo. Se conserva la fotografía visible.
- Transiciones de 200 ms para fondo, sombra y color; sin desplazamiento o escala. `prefers-reduced-motion` elimina transiciones. Se añade foco visible lavanda.

La detección de sección sigue siendo `iniciarSidebar()` en `public/Js/app.js`, sin modificaciones. No se cambiaron vistas, rutas, textos, íconos, candados, permisos, dimensiones ni reglas móviles.

### Comprobaciones y limitaciones

Se revisaron la clase activa existente y los selectores para ambos temas; el estado seleccionado tiene reglas distintas del hover. Las reglas no agregan medidas, márgenes o padding, y se aplican también al Sidebar contraído existente.

Limitación previa: `iniciarSidebar()` compara únicamente pathname e ignora el fragmento. Los enlaces `/despensa` y `/despensa#listaComprasMysql` pueden aparecer ambos activos. Garantizar una única selección entre ellos requiere autorización para modificar JavaScript; no se cambió esa lógica ni se ocultó arbitrariamente una selección mediante CSS.

Pendientes de prueba visual en navegador: contraste final, hover, selección por página, dispositivos móviles y cambio de tema. No se ha probado una navegación real ni se ha ejecutado SQL. El cambio es exclusivamente CSS y documentación.

## Cambio realizado

Se modificó exclusivamente la regla `.cookiq-privado[data-tema="oscuro"] .inicio-sidebar`, en la línea 5 de `public/Css/temaPrivado.css`. Este documento es el único archivo nuevo.

Antes, `background: linear-gradient(160deg,#22192b,#372843)` sustituía el fondo completo y omitía la fotografía existente en modo claro.

Ahora se superpone un degradado vertical a exactamente la misma imagen existente:

`https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=900&q=80`

No se descargó, generó ni modificó ninguna imagen. Se mantiene su origen externo y, por tanto, su disponibilidad depende de la carga de ese recurso.

## Colores y composición

Colores de la paleta morada oscura de CookIQ, de arriba abajo:

| Posición | Color | Opacidad |
| --- | --- | --- |
| 0% | #372843 | 94% |
| 45% | #2b2137 | 86% |
| 75% | #221a2d | 68% |
| 100% | #191320 | 78% |

El color se oscurece hacia abajo; la transparencia aumenta en la zona inferior para dejar distinguir la fotografía y vuelve a atenuarla en el borde final. No se utiliza negro puro.

`background-position: center` y `background-size: cover` conservan el encuadre y la proporción usados en claro; `background-repeat: no-repeat` evita mosaicos. Cover puede recortar la imagen según el ancho, sin deformarla. No se modifican dimensiones ni reglas responsive del Sidebar.

## Tema y alcance

Se reutiliza el atributo `data-tema="oscuro"` existente. El cambio de tema aplica o retira esta regla sin JavaScript nuevo. El modo claro conserva íntegramente su CSS. Logo, enlaces, íconos, estados activos, hover, candados y animaciones no se modificaron.

## Verificaciones

- Comparación automatizada con el CSS anterior: la única diferencia es el contenido de la regla de fondo oscuro del Sidebar.
- Verificación de igualdad de la URL respecto al fondo claro y presencia de center, cover y no-repeat.
- No se modificaron vistas, JavaScript, backend, datos ni MySQL.
- Pendiente de revisión visual en navegador: visibilidad real de la fotografía, contraste, cambio de tema, escritorio, barra contraída móvil y desplazamiento en páginas largas. No se afirma haber realizado esas pruebas visuales ni comprobar la disponibilidad remota de la imagen.

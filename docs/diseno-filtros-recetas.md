# Diseño de filtros de recetas

## Alcance

Se modificaron únicamente `views/lobby.ejs` (íconos de los tres títulos) y `public/Css/Style.css` (reglas limitadas a `#modalFiltros`), además de este documento. No se modificaron JavaScript, backend, valores, opciones, orden, predeterminados ni almacenamiento de filtros.

## Diseño anterior y nuevo

Antes las opciones usaban fondo blanco y texto marrón, con selección rosa y texto morado. Esas reglas no diferenciaban el tema oscuro.

Ahora las opciones usan lavanda suave, texto morado oscuro y borde tenue en claro; en oscuro usan morado profundo, texto claro y borde del tema. La selección siempre tiene fondo `--cookiq-purple` y texto blanco. Se conserva la clase `seleccionada` que aplica el JavaScript existente.

Variables locales: `--filtro-fondo`, `--filtro-texto`, `--filtro-borde`, `--filtro-hover`, `--filtro-acento`. Reutilizan `--cookiq-purple`, `--text`, `--tema-borde` y `--tema-acento`. El selector oscuro utiliza el mismo atributo `data-tema="oscuro"` de CookIQ: cambiar el tema actualiza la apariencia incluso con la ventana abierta, sin otro sistema de temas.

Los grupos tienen 24 px de separación superior, títulos con íconos de 21 px, opciones de altura mínima 42 px y separación de 10 px. Se conserva flex-wrap para pasar a otra fila. No se modifica la animación de apertura/cierre ni el degradado de Guardar filtros. Cerrar recibe los colores locales y ambos controles de selección/cierre tienen foco visible.

## Íconos y movimiento

- Reloj para Tiempo de preparación.
- Usuarios para Porciones.
- Gorro de chef para Dificultad, reutilizando el parcial SVG existente.

Se utiliza el formato SVG local de CookIQ sin dependencias. Son decorativos, sin foco y con `aria-hidden`. Colores de acento según tema.

Las opciones tienen transiciones de color/borde de 180 ms y pulsación mediante escala .97. `prefers-reduced-motion` elimina estas transiciones y escala.

## Verificaciones

- Comparación de la vista antes/después: al retirar los tres íconos, el marcado es idéntico. Se conservan IDs, títulos, contenedores y atributos de Guardar filtros y Cerrar.
- Compilación EJS correcta.
- Evaluación aislada en memoria de `pintarOpciones()` existente para tiempo, porciones y dificultad: al pulsar una opción se conserva su valor y queda una sola clase `seleccionada`. Sin red ni MySQL.
- `node --check public/Js/app.js` correcto. No se cambió ese archivo.
- Revisión de CSS: reglas nuevas limitadas al modal, selección blanca sobre morado, tema existente, flex-wrap y movimiento reducido.
- Pendientes de comprobación real en navegador: alineación en móviles/escritorio, ambos temas y cambio con modal abierto, apertura/cierre y guardado de filtros. No se ejecutó una generación real ni llamadas a OpenAI. La lógica de generación permanece intacta; las pruebas aisladas no prueban su ejecución completa.

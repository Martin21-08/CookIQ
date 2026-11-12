# Logos oficiales de supermercados

Fecha de consulta: 4 de noviembre de 2026.

## Alcance y resultado

Se reemplazaron exclusivamente los cuatro dibujos de canasta dentro del sector
«¿Dónde comprar?» de Lista de Compras. Los cuatro supermercados ya existían.
Se conservó su orden real: **Líder, Santa Isabel, Jumbo y Super 10**.
No se añadieron supermercados, acciones ni dependencias.

Los archivos se descargaron directamente de los recursos usados en las cabeceras
de los sitios oficiales, sin generación mediante IA, redibujado, recorte,
conversión, filtros ni recoloración. Se conservan los bytes originales.

## Fuentes y archivos nuevos

### Líder

- Sitio de referencia: https://super.lider.cl/
- Imagen original: https://i5.walmartimages.com/dfw/63fd9f59-4a2e/587a39f4-fa04-49c6-b70f-ed494f49ff69/v1/chile-walmart-od-logo.svg
- Archivo: `public/Img/supermercados/lider.svg`.
- SVG transparente, dimensiones de referencia 102 × 42, 6.949 bytes.
- Verificado en el HTML oficial como imagen `alt="lider-cl"` del enlace de inicio
  de la cabecera. El nombre técnico del recurso incluye Walmart, pero la imagen
  se inspeccionó visualmente y corresponde a Supermercado Líder.

### Santa Isabel

- Sitio de referencia: https://www.santaisabel.cl/
- Imagen original: https://www.santaisabel.cl/images/logo-santaisabel.svg
- Archivo: `public/Img/supermercados/santa-isabel.svg`.
- SVG transparente, dimensiones de referencia 7.698 × 1.024, 8.950 bytes.
- Logotipo horizontal blanco usado en la cabecera oficial, con `alt="Santa Isabel"`.

### Jumbo

- Sitio de referencia: https://www.jumbo.cl/
- Imagen original: https://www.jumbo.cl/images/logo-jumbo-50.svg
- Archivo: `public/Img/supermercados/jumbo.svg`.
- SVG transparente, dimensiones de referencia 957 × 163, 16.131 bytes.
- Variante **Jumbo 50 años**, usada actualmente en la cabecera oficial y en sus
  metadatos de organización. Se eligió esa imagen vigente, sin eliminar el
  aniversario ni sustituirla por una recreación o una marca distinta como Prime.

### Super 10

- Sitio de referencia: https://www.super10.cl/
- Imagen original: https://images.ctfassets.net/63tonbtz0lhl/15NFBD4GhyKsRlVeECmMOC/5648e66a51dab5dd7c61e1517b5def29/logo-s10-v2.png
- Archivo: `public/Img/supermercados/super10.png`.
- PNG con transparencia, 100 × 100, 6.838 bytes.
- Imagen de la cabecera oficial, identificada como `alt="logo Super 10"`.

Las cuatro descargas respondieron HTTP 200. No se sobrescribieron imágenes
preexistentes. La página usa rutas locales `/Img/supermercados/...`, no hotlinks.
No hubo logos que no pudieran obtenerse o verificarse.

## Archivos existentes modificados

### `views/despensa.ejs`

Solo se sustituyó el contenido de estos cuatro contenedores:

| Línea | Ícono anterior | Reemplazo |
| --- | --- | --- |
| 65 | SVG de canasta de Líder | `lider.svg` |
| 70 | SVG de canasta de Santa Isabel | `santa-isabel.svg` |
| 75 | SVG de canasta de Jumbo | `jumbo.svg` |
| 80 | SVG de canasta de Super 10 | `super10.png` |

Cada imagen declara 88 × 36 como caja de presentación, con `object-fit: contain`
en CSS para preservar la proporción original. Se conservó `aria-hidden="true"`
del contenedor y se usó `alt=""`: el supermercado ya está identificado por el
texto y el nombre accesible existentes del enlace. Se añadieron `loading="lazy"`
y `decoding="async"`. Los iconos pequeños de enlace externo permanecen intactos.

### `public/Css/Style.css`

Se agregaron exactamente tres reglas en las líneas **278–280**:

```css
.compras-supermercado-icono.compras-supermercado-logo { flex-basis: 88px; background: transparent; }
.compras-supermercado-icono.compras-supermercado-logo-blanco { background: var(--cookiq-purple); }
.compras-supermercado-logo img { display: block; width: 88px; height: 36px; padding: 4px; object-fit: contain; }
```

Motivos:

- Los logotipos horizontales necesitan más ancho que la canasta de 36 px.
  Solo cambia su caja interior; se mantiene la altura de 36 px, el padding de
  las tarjetas, su estructura, el grid, los nombres y los controles existentes.
- Los logos blancos oficiales de Líder y Santa Isabel necesitan un fondo
  contrastante. Se usa el morado existente de CookIQ dentro del contenedor,
  sin alterar los colores ni los archivos de las marcas.
- Jumbo y Super 10 utilizan un fondo transparente sobre la tarjeta existente.
- `object-fit: contain` y el padding evitan estiramientos y recortes.

Las reglas solo afectan a los contenedores de supermercado que recibieron las
nuevas clases. No se cambió ninguna regla CSS anterior ni el breakpoint móvil
existente de 480 px.

## Enlaces y acciones conservados

1. Líder → https://super.lider.cl/
2. Santa Isabel → https://www.santaisabel.cl/
3. Jumbo → https://www.jumbo.cl/
4. Super 10 → https://www.super10.cl/

Se mantienen `target="_blank"`, `rel="noopener noreferrer"`, el área clicable
de las tarjetas y todos sus atributos existentes. No se modificó JavaScript,
la lista de ingredientes, sus botones ni la transferencia a Despensa.

**Hallazgo previo fuera de alcance:** el `aria-label` existente de la tarjeta
Jumbo dice «Visitar supermercado Super 10». Se informó y se conservó literalmente
porque esta tarea autoriza exclusivamente la sustitución visual, sin corregir
atributos o comportamientos adicionales.

## Uso de las imágenes

Se usan para identificar los destinos externos correspondientes, manteniendo
sus nombres y sin presentar las marcas como propias ni afirmar afiliación.
La disponibilidad en un sitio oficial no equivale a una licencia de marca:
no se verificó una autorización de redistribución ni se afirma tenerla. Los
logotipos continúan perteneciendo a sus respectivos titulares.

## Verificaciones realizadas

- Consulta de los cuatro sitios oficiales: HTTP 200, enlaces de cabecera y
  archivos correspondientes identificados.
- Inspección visual conjunta: Líder blanco/amarillo, Santa Isabel blanco,
  Jumbo verde con aniversario y Super 10 blanco/naranja.
- Metadatos y decodificación de las cuatro imágenes mediante Sharp; SVG
  revisados para descartar scripts, `foreignObject` y eventos `onload`.
- Servidor estático Express temporal: los cuatro recursos locales respondieron
  HTTP 200 con tipo `image/*` y se decodificaron sin errores.
- Renderizado EJS de Despensa con datos simulados: correcto.
- Comprobación de cuatro tarjetas, orden, destinos, apertura segura e iconos
  de enlace externo conservados.
- Comparación de la vista antes/después eliminando únicamente los cuatro
  contenedores de iconos: contenido idéntico.
- Hash de `public/Js/listaCompras.js` antes/después: idéntico.
- Comparación del CSS, normalizando saltos de línea: solo las tres reglas nuevas.
- Ajuste proporcional a 88 × 36 validado mediante decodificación/redimensionado
  de prueba, sin guardar esas conversiones sobre los archivos originales.
- El grid móvil existente conserva una columna bajo 480 px.

No se inició la aplicación completa, no se consultó MySQL ni se ejecutó SQL.
No se hicieron compras, generación de recetas o cambios de datos. No se
agregó JavaScript que pueda introducir errores de consola.

## Pendiente de revisión manual

En una sesión MasterChef existente, abrir Despensa → Lista de Compras y
comprobar la escala visual de los logos a 360 px y en escritorio. Abrir cada
tarjeta para verificar la navegación desde el navegador del usuario.
La comprobación de consola y el comportamiento visual responsive no se
ejecutaron en un navegador real; no se afirma haber probado todos los módulos.

El único documento creado fue este archivo; no se modificaron documentos
existentes. Otros módulos, rutas, modelos, controladores e imágenes permanecen
fuera de esta modificación.

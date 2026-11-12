# Página informativa de CookIQ

## Objetivo y acceso

Página pública independiente, con Navbar horizontal, portada y secciones verticales.
Acceso principal: **http://localhost:3000/**. También disponible en
**http://localhost:3000/descubre**. No reemplaza el login, el lobby ni ninguna
página de ayuda que pudiera existir.

## Revisión previa

- MVC actual: rutas Express, controladores y vistas EJS.
- Colores tomados de `public/Css/Style.css`: morado `#704b9e`, naranja
  `#f28b2b`, rosa `#f8dce8`, crema `#fffaf4` y texto `#41372f`.
- Tipografía Nunito, igual que las vistas existentes; utiliza Google Fonts y
  conserva Arial/sans-serif como alternativa si no hay conexión.
- Recursos reutilizados sin modificaciones: `/Img/icono.png` y
  `/Img/54478-removebg-preview.png`.
- Identidad de sesión: `req.session.usuario.id_usuario`, comprobando que sea
  un entero positivo igual que `middlewares/requiereSesion.js`.
- Rutas existentes: login `/usuarios/login`, registro `/usuarios/registro`,
  página privada `/lobby`. No se consultan modelos ni se modifica la sesión.
- El Sidebar privado y el Footer compartido se inspeccionaron y permanecen
  intactos. Esta página tiene su propio Navbar y Footer, sin Bootstrap.

## Archivos creados

| Archivo | Responsabilidad |
| --- | --- |
| `controllers/informacionController.js` | Entrega textos informativos, equipo, estado booleano de sesión y año de Chile a EJS. |
| `views/descubre.ejs` | Navbar, portada, funciones, guía, equipo, contactos y Footer exclusivos. |
| `views/Partials/iconoInformativo.ejs` | Iconos SVG locales que usan los símbolos de esta vista. |
| `public/Css/informacion.css` | Diseño, colores reutilizados, responsive, scroll suave y movimiento reducido. |
| `public/Js/informacion.js` | Menú móvil, aparición progresiva de contenido y preferencia visual del tema. Sin fetch. |
| `docs/centro-ayuda.md` | Alcance, integración, pruebas y limitaciones. |

## Integración inicial de la página

`routes/viewsRoutes.js`, **línea 7**: se agregó exclusivamente:

```js
router.get('/descubre', require('../controllers/informacionController').mostrar);
```

Motivo: registrar la página pública en el router de vistas que ya está montado
en Express. No se agregó middleware a las otras rutas ni se cambió su orden
relativo, sus controladores o sus redirecciones. En esa etapa no se modificó `app.js`.
No se añadieron enlaces a pantallas existentes: se accede directamente a la URL.

## Navegación y contenido

- Navbar sticky: logo al inicio, Descubre CookIQ, Nosotros y Contacto mediante
  anclas. El último enlace lleva al login o muestra «Ir a mi cocina» hacia
  `/lobby` si hay una identidad válida en la sesión.
- Secciones: Portada → Descubre CookIQ → Cómo funciona → Nosotros → Contacto.
- Ocho funciones: IA, ingredientes, filtros, preferencias alimentarias,
  favoritos, historial, despensa y compras. Las dos últimas indican
  «Requiere MasterChef». No se añaden funciones a esos módulos.
- Ocho pasos numerados con iconos explican el uso de CookIQ.
- Equipo: Amador Pizarro, Renato Inostroza, Andrés Salazar y Martin Espinoza.
  Avatares SVG ilustrativos, sin fotografías, cargos ni biografías inventadas.
- Footer: marca, navegación, contactos y año actual calculado en
  `America/Santiago`. No se inventan enlaces legales.

## Contactos oficiales

Se muestran en Contacto y se repiten en el Footer:

- Correo: `CookIQ.oficial@gmail.com` → `mailto:CookIQ.oficial@gmail.com`.
- Instagram: `@cookiq.of` → `https://www.instagram.com/cookiq.of/`.
- Teléfono: `+56 9 5880 8563` → `tel:+56958808563`.

Instagram abre en una nueva pestaña con `rel="noopener noreferrer"` y una
indicación accesible. No se agregan horarios, WhatsApp ni direcciones.

## Accesibilidad y aislamiento

- Hoja CSS exclusiva; no se carga `Style.css` ni el JavaScript general de la app.
  Los selectores propios usan `info-*` y el documento `pagina-informativa`.
- Anclas con desplazamiento suave y margen superior para el Navbar.
- Menú móvil con botón nativo, `aria-expanded`, `aria-controls`, cierre con
  Escape y cambio a escritorio. Sin JavaScript, los enlaces quedan visibles.
- Enlace para saltar al contenido, foco visible, encabezados y regiones semánticas.
- Animación con IntersectionObserver, sin librerías. El contenido es visible
  por defecto; se respeta `prefers-reduced-motion` y se mantiene visible si el
  observador no está disponible.
- `Cache-Control: private, no-store` evita reutilizar el enlace de sesión de
  otro usuario desde una caché compartida. No se envían datos personales a la vista.
- No se ejecutó SQL, no se iniciaron servicios externos y no se instalaron
  dependencias. No se modificaron recursos visuales, autenticación ni modelos.

## Pruebas realizadas

Se usó un servidor Express temporal, con rutas existentes sustituidas por
dobles de prueba y sesiones simuladas. No se inició `app.js` ni se cargaron
MySQL, Firebase, OpenAI o clientes PayPal reales.

- GET público `/descubre`: HTTP 200 y renderizado EJS correcto.
- Sesión ausente/inválida: enlace al login; sesión válida simulada: `/lobby`.
- Ocho tarjetas de funciones y dos indicaciones MasterChef.
- Equipo, año, referencias de anclas e iconos y contactos duplicados correctamente.
- CSS, JavaScript e imágenes reutilizadas: HTTP 200.
- Registro de todas las rutas anteriores conservado y mismo número de
  manejadores en las rutas privadas. La nueva ruta tiene un único manejador público.
- Redirecciones existentes `/login` y `/register` conservadas en el router aislado.
- DOM simulado: apertura/cierre móvil, Escape, selección de anclas, cambio a
  escritorio y desactivación de animaciones por movimiento reducido.
- `node --check` de controlador, JavaScript y router: sin errores.
- Suites existentes, aisladas:

  ```text
  node --test --test-reporter=dot tests/paypal.test.js tests/suscripciones.test.js
  71 pruebas pasaron, 0 fallaron.
  ```

Estas comprobaciones no equivalen a probar compras reales, generación de
recetas o autenticación Google. Esos archivos no fueron modificados.

## Comprobación manual y limitaciones

1. Con CookIQ funcionando, abrir `/descubre` sin iniciar sesión.
2. Recorrer todas las anclas y comprobar que el Navbar no cubra los títulos.
3. En móvil, abrir el menú, navegar y cerrarlo con Escape/teclado.
4. Revisar tarjetas, guía, equipo, contactos y Footer a 360, 768 y 1440 píxeles.
5. Iniciar sesión por el flujo existente y volver a `/descubre`: comprobar
   «Ir a mi cocina». La raíz y las páginas privadas conservan su navegación.
6. Activar movimiento reducido y desactivar JavaScript para comprobar los respaldos.
7. Revisar correo/teléfono con los clientes del dispositivo e Instagram en otra pestaña.

No se dispone de automatización de navegador instalada en este entorno. Quedan
pendientes la inspección visual real, la animación y el scroll en dispositivos,
la navegación con una cuenta real y la apertura de aplicaciones de correo/teléfono.
No se afirma haber realizado pruebas completas de los módulos protegidos.

## Actualización: navegación inicial y cierre de sesión

### Comportamiento actual

- **Visitante:** `/` muestra Descubre directamente, conservando esa URL al
  actualizar. `/descubre` también continúa disponible.
- **Login:** el Navbar conserva `/usuarios/login`. El inicio de sesión correcto
  continúa redirigiendo a `/lobby` por el controlador de autenticación existente.
- **Cocina:** `/lobby` conserva su middleware de sesión y `Cache-Control: no-store`.
  Actualizar no destruye la sesión ni redirige a Descubre.
- **Usuario autenticado en `/`:** puede ver Descubre; se muestra «Ir a mi cocina»
  y no se modifica la sesión. Puede volver a `/lobby` sin autenticarse otra vez.
- **Logout:** se conserva el POST a `/api/firebase/logout`, que responde éxito
  después de destruir la sesión. El frontend navega directamente a
  `/usuarios/login`, sin pasar por `/`.
- **Atrás después del logout:** el servidor vuelve a exigir sesión. El código
  existente del Sidebar oculta las instantáneas restauradas desde BFCache y
  recarga la página; sin sesión, la ruta privada redirige al login. Ese código
  de seguridad no se modificó.

### Cambios exactos de esta actualización

| Archivo | Líneas actuales | Cambio y justificación |
| --- | --- | --- |
| `app.js` | 159 | Se reemplazó el manejador de tres líneas que redirigía `/` al login por `app.get("/", require('./controllers/informacionController').mostrar);`. Reutiliza el controlador público de Descubre sin tocar las otras rutas. |
| `public/Js/app.js` | 799 | Únicamente se cambió `window.location.assign('/');` por `window.location.assign('/usuarios/login');` en la rama de logout exitoso. Separa su destino del acceso inicial. |
| `docs/centro-ayuda.md` | Objetivo, integración inicial y esta sección | Se documentan el acceso por `/`, los dos cambios funcionales y sus comprobaciones. |

No se crearon archivos en esta actualización. No se modificaron la destrucción
de sesión, Firebase, Google, el login, sus controladores, sus cookies o sus
medidas de seguridad. Tampoco se modificaron PayPal, permisos, modelos, vistas,
CSS, Navbar, Footer, generación ni conexión MySQL. No se ejecutó SQL.

### Pruebas de navegación

Se ejecutó un servidor Express temporal con `express-session` y almacenamiento
en memoria, sin iniciar `app.js`. Se utilizó el manejador raíz real, el router
de vistas real, el middleware real de sesión y los controladores reales de login
y logout. Solo las credenciales, el modelo de usuario y los servicios externos
se sustituyeron por dobles de prueba. Las vistas privadas se sustituyeron por
respuestas mínimas para no iniciar sus módulos.

1. GET `/` sin sesión: HTTP 200, Descubre.
2. Repetir GET `/` simulando actualización: sigue en Descubre.
3. Enlace al login y GET `/usuarios/login`: vista existente, HTTP 200.
4. Login con credenciales simuladas: crea cookie de sesión y redirige a `/lobby`.
5. Dos accesos consecutivos a `/lobby` con esa cookie: HTTP 200 y `no-store`.
6. Logout real contra la sesión en memoria: éxito; frontend real, evaluado
   aisladamente, navega a `/usuarios/login`.
7. Reutilizar la cookie anterior contra Cocina: redirección al login.
8. GET `/` con sesión: Descubre muestra «Ir a mi cocina».
9. Volver a `/lobby` después del punto anterior: conserva el acceso.
10. Sin sesión válida, `/lobby`, `/despensa`, `/favoritos`, `/historial`, `/perfil`
    y `/suscripciones` redirigen a `/usuarios/login`.
11. Eventos simulados `pagehide/pageshow` del Sidebar existente: la instantánea
    BFCache se oculta y se solicita una recarga.

La prueba de Atrás no se ejecutó en un navegador real. Queda pendiente recorrer
manualmente ambos escenarios, con F5 y Atrás, usando una cuenta real. No se
afirman pruebas de Google, compras ni generación de recetas.

## Actualización: modo claro y oscuro de Descubre

### Alcance y archivos modificados

Solo se modificaron estos cuatro archivos en esta actualización:

- `views/descubre.ejs`: inicialización del tema en el `head`, antes de la hoja
  CSS, y botón sol/luna al extremo derecho del Navbar. No se cambiaron los
  textos, las secciones, los contactos, los enlaces ni el Footer.
- `public/Css/informacion.css`: se añadieron al final estilos del botón,
  transiciones y colores oscuros bajo `.pagina-informativa[data-tema="oscuro"]`.
  Se conserva el CSS claro original. Se acomoda exclusivamente el nuevo botón
  en la fila superior móvil, sin cambiar destinos ni comportamiento del menú.
- `public/Js/informacion.js`: inicializa la etiqueta y estado accesibles del
  botón, alterna el tema y guarda la preferencia. El código previo de menú,
  scroll y aparición de elementos permanece intacto.
- `docs/centro-ayuda.md`: esta sección y la descripción del JavaScript.

No se crearon archivos, dependencias o rutas. No se modificaron `Style.css`,
el JavaScript global, la autenticación, el login, Cocina ni ningún módulo de
datos. No se ejecutó SQL ni se modificó MySQL.

### Paleta oscura

| Elemento | Color |
| --- | --- |
| Fondo principal | `#191320` |
| Navbar | `rgba(33,25,43,.97)` |
| Tarjetas y chips | `#2b2137` |
| Fondos de guía y contacto | `#221a2d` |
| Texto principal | `#f5effa` |
| Texto secundario | `#c8b9d3` |
| Acento lavanda | `#c9a8ef` |
| Botones principales | `#704b9e`, morado original de CookIQ |
| Bordes | `#51405e` |
| Footer | `#120e19` |
| Detalles cálidos | `#ffc185` y `#ffd0a1` |

La portada mantiene su imagen original, sin filtros ni alteraciones. Su panel
usa un degradado morado oscuro; los iconos y avatares conservan su estructura.
Las reglas del tema oscuro solo afectan al documento de Descubre, servido en
`/` y `/descubre`. Los colores originales del modo claro permanecen intactos.

### Botón, animación y persistencia

- Modo inicial claro si no hay preferencia válida almacenada.
- Sol visible en modo claro; luna visible en modo oscuro.
- Botón nativo, operable con teclado; `aria-pressed` indica el estado oscuro y
  `aria-label`/`title` indican la acción «Activar modo claro/oscuro».
- Transición de iconos de 280 ms, con opacidad, rotación y escala; efecto de
  pulsación mediante `:active`. Los fondos, bordes y colores también transicionan.
- El tema inicial se aplica antes de cargar el CSS. Las transiciones solo se
  habilitan después, para evitar un destello claro con una preferencia oscura.
- Se conserva la regla existente de movimiento reducido, que desactiva las
  transiciones y animaciones mediante `!important`. No se cambia el scroll.
- Clave exclusiva de localStorage: **`cookiq:descubre:tema`**; valores `claro` y
  `oscuro`. No contiene información personal ni modifica otras claves.
- Si localStorage está bloqueado, no se produce un error: el tema funciona en
  la visita actual, pero no puede conservarse después de recargar.
- No requiere sesión y no se guarda en MySQL. Borrar el almacenamiento del
  navegador restablece el modo claro.

### Verificaciones realizadas

Evaluaciones aisladas en memoria, sin navegador automatizado:

- Estado inicial claro, cambio a oscuro y regreso a claro.
- Persistencia al recrear el documento simulando F5 y una visita posterior.
- Estado y etiquetas ARIA actualizados; botón visible tras inicializar JavaScript.
- Sol/luna y transiciones declarados en CSS; inicialización anterior al CSS.
- localStorage bloqueado y conservación de claves ajenas al tema.
- Menú móvil, cierre con Escape y preferencias de movimiento reducido.
- Renderizado EJS, anclas y contactos oficiales conservados.
- Contraste mínimo de 4.5:1 calculado para seis pares representativos de
  colores oscuros: texto principal/fondo, secundario/tarjeta, acento/sección,
  texto/botón, texto/Footer y texto/etiqueta cálida. No es una auditoría visual
  completa de todos los estados.
- `node --check public/Js/informacion.js`: sin errores.
- Suites existentes de PayPal y suscripciones: **71 pruebas pasaron**.

Queda pendiente comprobar visualmente en navegador real la animación, el
contraste de todas las superficies y los tamaños móviles. Para hacerlo, abrir
`/`, alternar el botón, recargar con F5, entrar a `/descubre` y comprobar la
persistencia. Recorrer las anclas y los contactos en ambos temas. Después
abrir login y Cocina: no cargan esta hoja ni este script y conservan su diseño.

## Actualización: volver a Descubre y coherencia de botones

### Archivos y cambios

- `views/login.ejs`: después del enlace de registro, se agregó
  `<a href="/" class="btn-login volver-descubre">← Volver a Descubre CookIQ</a>`.
- `views/register.ejs`: después del enlace al login, se agregó el mismo enlace
  con las clases `btn-register volver-descubre`. El botón Cancelar existente
  conserva su destino al login.
- `public/Css/Style.css`: solo se añadieron dos reglas específicas para
  `.modal-caja > a.volver-descubre`, que centran el enlace, eliminan el
  subrayado y agregan foco visible. Las clases originales de botones no se
  modificaron: los enlaces reutilizan su apariencia y efectos.
- `public/Css/informacion.css`: se añadieron reglas al final, limitadas a
  `.pagina-informativa .info-boton` y sus variantes oscuras/hover. Los botones
  de acción mantienen textos, destinos, posición y padding. No se convierten
  en botones los enlaces normales, las tarjetas de contacto o el Footer.
- `docs/centro-ayuda.md`: esta documentación.

No se modificaron JavaScript, rutas, controladores, formularios, nombres de
campos, validaciones, mensajes flash ni autenticación. No se ejecutó SQL.

### Estilos reutilizados

La referencia real es `.btn-login, .btn-register` de `Style.css`:

- Degradado de 135 grados: morado `#704b9e` a naranja `#f28b2b`.
- Texto blanco, Nunito, peso 800 y tamaño 15 px.
- Sin borde y radio de 12 px.
- Hover: elevación de 2 px y sombra `0 8px 16px rgba(112,75,158,.3)`.
- Transición de 200 ms para transformación y sombra.

Descubre utiliza esos colores en modo claro. En modo oscuro conserva el
morado y adapta el naranja a `#9b4d16`, con sombra morada ligeramente más
marcada, para mantener legibilidad sobre la paleta oscura. El selector de tema
y sus animaciones no cambian; tampoco la preferencia `cookiq:descubre:tema`.
Volver a `/` desde los formularios vuelve a aplicar la preferencia guardada.
La regla de movimiento reducido sigue prevaleciendo sobre las transiciones.

### Navegación y verificaciones

Los nuevos elementos son enlaces HTML nativos, no botones submit ni eventos
JavaScript. Funcionan sin sesión y no ejecutan validaciones ni envían los
formularios al pulsarlos. Se mantienen los POST `/usuarios/login` y
`/usuarios/registro`, los botones submit, Google y recuperación de contraseña.
Cerrar sesión desde Cocina conserva su redirección a `/usuarios/login`.

Pruebas aisladas realizadas:

- Renderizado EJS de Login y Register con los enlaces nuevos a `/`.
- Verificación de acciones POST, IDs, controles submit, validaciones HTML,
  enlaces de recuperación y componentes Google conservados.
- Renderizado de Descubre con los destinos originales y el selector de tema.
- Comprobación de estilos exclusivos, degradados claro/oscuro y regla de
  movimiento reducido. El JavaScript del sol/luna permanece sin cambios.
- Redirección del logout al login comprobada en el código existente.
- Suites existentes de PayPal y suscripciones: **71 pruebas pasaron**.

No se realizaron registros reales, accesos Google ni escrituras en MySQL.
La autenticación no se modificó; estas comprobaciones no constituyen una
prueba completa con cuentas reales. Queda pendiente comprobar en navegador
los dos enlaces, los efectos hover/foco, ambos temas, la animación sol/luna y
el diseño móvil. No se modificaron los puntos de quiebre responsive.

# Personalización alimentaria durante el registro

## Antes y después

Antes, el registro normal creaba la cuenta y redirigía al Login sin guardar
preferencias. Google creaba la cuenta, abría una sesión de CookIQ y enviaba al
Lobby. Perfil tenía un botón «Personalizar alergias» y un modal adicional,
además de los checkbox del formulario principal.

Ahora ambos registros tienen el mismo flujo:

```text
Datos validados → Personalización → Confirmación → Cuenta + preferencias → Login
```

La cuenta no existe todavía durante la selección. No se crea una sesión
autenticada al finalizar. La persona puede seleccionar alergias, intolerancias,
ambas o ninguna. Los catálogos y el esquema MySQL no se modificaron.

## Registro normal

1. El formulario conserva los campos, validaciones, acción y método originales.
2. El script específico envía los datos como JSON al POST `/usuarios/registro`.
3. Se reutilizan las validaciones del controlador existente, incluida la
   comprobación de correo registrado y el hash bcrypt de la contraseña.
4. Los fallos se presentan en la página sin abrir el modal. Las solicitudes
   HTML conservan las redirecciones y los flash de error del controlador.
5. Si los datos son válidos, se guarda un registro pendiente, no una cuenta.
6. Se abre el dialog «Personaliza tu alimentación» y se obtiene `/catalogos`.
7. Guardar cambios muestra la confirmación dentro del mismo dialog. No se abre
   un segundo dialog ni se llama al confirmador global, que rechaza aperturas
   cuando ya existe un dialog abierto.
8. Cancelar vuelve a las casillas sin reconstruirlas ni perder sus selecciones.
9. Sí, guardar envía el token y los IDs seleccionados a la finalización.
10. Solo después del commit se informa éxito y se redirige a `/usuarios/login`.

Sin JavaScript no se crea una cuenta por omisión: el POST válido deja un registro
pendiente y vuelve a Register, donde se indica que debe habilitarse JavaScript.

## Google nuevo y usuarios existentes

Se mantiene el popup y el middleware `validarFirebase` del endpoint existente
`POST /api/firebase/google/registro`. Se conservan las comprobaciones de correo,
Google ID, términos y teléfono. Los datos de identidad se toman exclusivamente
de `req.firebaseGoogleUser`, nunca del correo/UID enviados por el navegador.

Después de validar y confirmar los datos, ese endpoint prepara el registro en
vez de insertar la cuenta o asignar `req.session.usuario`. El frontend cierra
la confirmación de datos, ejecuta `signOut(auth)` para el proceso de registro
nuevo y abre exactamente el mismo modal alimentario del registro normal.

La identidad Google verificada queda vinculada al registro pendiente y a la
sesión anónima del servidor durante un máximo de 15 minutos. No se guarda el
ID token de Firebase en el borrador. La finalización usa esa identidad, no
permite elegir un usuario y no inicia sesión de CookIQ automáticamente.

`loginGoogle()` permanece sin cambios: las cuentas existentes siguen entrando
al Lobby como antes. No se les solicita esta personalización nuevamente.
El frontend de registro ya no guarda un perfil local ni redirige al Lobby.

## Registro pendiente y seguridad

- `registroService` mantiene los datos temporales en una colección en memoria
  del servidor. La sesión solo contiene un token aleatorio de 32 bytes.
- El token se vincula al `sessionID`, se compara en tiempo constante y vence
  a los 15 minutos. Se comprueba la caducidad en cada acceso y un temporizador
  elimina la entrada, incluso sin más visitas.
- Se guarda únicamente el hash de contraseña, nunca la contraseña en claro.
  Después del commit se eliminan los datos personales y el hash del borrador.
- No se guardan contraseñas, identidades o preferencias de registro en
  localStorage. El uso de localStorage por `tema.js` se limita al tema existente.
- Los IDs deben ser enteros positivos, se deduplican y se contrastan con el
  catálogo activo en la transacción. No se acepta un `id_usuario` del cliente.
- Los cambios de casillas se conservan como borradores en memoria mediante
  POST `/usuarios/registro/borrador`, con el mismo token y control de origen.
  Las revisiones crecientes impiden que peticiones retrasadas sobrescriban
  una selección más nueva. No hacen SQL y no alteran una finalización en curso.
- Se comprueba el origen de las peticiones de registro y finalización. El token
  de finalización se obtiene desde la misma sesión y sus respuestas no se cachean.
- Un usuario autenticado no puede finalizar otra cuenta en esa sesión.
- Las peticiones de finalización simultáneas comparten una promesa. Se conserva
  un recibo temporal tras el commit para responder a reintentos sin otra inserción.
- Los índices UNIQUE existentes de correo, teléfono y Google ID son la última
  protección frente a solicitudes de registro concurrentes desde sesiones distintas.
  No se modificaron ni se ejecutó SQL para crearlos.
- Los errores de finalización se registran por código, sin contraseñas ni tokens.

## Transacción y reintentos

`registroModel.crearConPreferencias()` obtiene una conexión del pool existente:

1. `beginTransaction()`.
2. Consulta y validación de los IDs contra los catálogos activos.
3. `userModel.crearUsuario()` o `firebaseModel.crearUsuarioGoogle()`.
4. `preferenciasModel.guardarPreferencias()` para el ID devuelto por MySQL.
5. `commit()` y liberación de la conexión.

Si falla cualquier paso de persistencia, se hace rollback del lote completo y
se libera la conexión. No se muestra éxito ni se redirige. El modal conserva
las casillas y permite reintentar. El servidor también conserva las selecciones
del último intento de finalización mientras el registro pendiente siga vigente.

Los cuatro modelos adaptados aceptan una conexión opcional. Sin ella conservan
el pool y su funcionamiento anterior. En particular, guardar preferencias desde
Perfil sigue iniciando, confirmando, deshaciendo y liberando su propia transacción.
Con una conexión externa, el modelo no hace commit, rollback o release por su
cuenta: esas operaciones pertenecen exclusivamente al registro completo.

El flash de éxito se añade después del commit. Una interrupción posterior al
commit no puede deshacerlo: el recibo temporal permite reintentar sin duplicar.
No se afirma una garantía de entrega del flash si se pierde la sesión o la conexión.

## Perfil: edición conservada

Se retiró el botón «Personalizar alergias», el modal específico anterior y solo
sus manejadores/seletores dedicados. Se conservaron el formulario principal,
sus campos, IDs de contenedores, selección por IDs obtenidos desde `/preferencias`
y el guardado con Guardar cambios. No se cambió el guardado del perfil.

Se reutilizan el catálogo y `guardarPreferenciasEnBD()` existentes. Los checkbox
del formulario principal reciben únicamente la clase visual `preferencias-tarjetas`.
El botón Ajustes, su modal, el avatar, el enlace Mejorar plan y el logout no cambian.

## Recuperación al iniciar sesión y uso en recetas

Las relaciones se guardan en `alergia_usuario` e `intolerancia_usuario`, asociadas
al ID creado en la misma transacción. Después del Login habitual:

- Perfil obtiene los IDs mediante `obtenerPreferencias()` y marca sus checkbox.
- El generador continúa utilizando `obtenerRestricciones()` como antes.
- No se cambiaron prompts, validaciones alimentarias, sustituciones o filtros.
- No se guarda un catálogo distinto ni nombres inventados desde el frontend.

## Presentación, animaciones y accesibilidad

El nuevo componente reutiliza las secciones Alergias/Intolerancias, el catálogo,
los estilos de acciones y la identidad visual del modal anterior. Se utiliza
un dialog nativo para gestionar el foco y bloquear interacción accidental
con el fondo, con una confirmación interna que conserva las selecciones.

Las opciones son etiquetas completas clicables con checkbox visible, texto
obtenido mediante `textContent`, separación de 12 px, borde morado al seleccionar
y foco de teclado. Se disponen en dos columnas y pasan a una bajo 540 px.
Las listas tienen scroll interno y las acciones quedan fuera de esa lista.
En pantallas de muy poca altura se permite desplazar el dialog completo.

La entrada anima opacidad, escala y desplazamiento durante 280 ms; la confirmación
usa 200 ms. Se respeta `prefers-reduced-motion`. Escape no cierra accidentalmente
el proceso y explica cómo finalizar o salir mediante el enlace a Descubre.

Registro carga `tema.js` para leer la preferencia ya existente, sin modificar
el interruptor ni Descubre. Los colores oscuros del modal y de las tarjetas son
los mismos: fondo `#2b2137`, tarjetas `#221a2d`, selección `#372843`, bordes
`#51405e`, texto `#f5effa` y acento `#c9a8ef`. El formulario de registro conserva
su diseño anterior; el cambio de tema añadido se aplica a la personalización.

## Archivos nuevos

| Archivo completo | Responsabilidad |
| --- | --- |
| `models/registroModel.js` | Transacción conjunta y comprobación del catálogo vigente. |
| `services/registroService.js` | Borrador temporal, caducidad, token, validación de IDs y coalescencia de reintentos. |
| `controllers/registroController.js` | Estado, borrador y finalización, origen, respuestas y flash posterior al commit. |
| `views/Partials/personalizacionRegistro.ejs` | Ventana y confirmación compartidas por los dos registros. |
| `public/Js/registroPreferencias.js` | Formulario normal, catálogos, selección, confirmación, errores y redirección. |
| `public/Css/preferencias.css` | Tarjetas de Registro/Perfil, modal, temas y responsive aislados. |
| `tests/registroPreferencias.test.js` | Pruebas aisladas sin MySQL, Firebase u OpenAI reales. |
| `docs/personalizacion-registro.md` | Este documento. |

## Archivos existentes modificados y líneas de referencia

Las referencias corresponden a la versión resultante; pueden desplazarse al
editar otros bloques del proyecto.

| Archivo | Líneas / bloque | Cambio |
| --- | --- | --- |
| `controllers/userController.js` | 6–7, `register()` desde 67 | Dependencias del registro pendiente; errores JSON conservando validaciones/redirecciones HTML; preparación en lugar del INSERT inmediato. Login y recuperación no cambiaron. |
| `controllers/FirebaseController.js` | 2–3, `registrarGoogle()` | Preparación con identidad verificada; se retiró el inicio de sesión de registro. `loginGoogle()` se conserva. |
| `routes/userRoutes.js` | 10–13 | GET `/registro/pendiente`, POST `/registro/borrador` y POST `/registro/finalizar`, dentro de `/usuarios`. Rutas anteriores conservadas. |
| `models/userModel.js` | `crearUsuario()` desde 15 | Conexión opcional solo para esa inserción. |
| `models/firebaseModel.js` | 79, 111–139 | Conexión opcional en `buscarPorId` y `crearUsuarioGoogle`; consulta del usuario nuevo en la misma conexión no confirmada. |
| `models/preferenciasModel.js` | 66–141 | Conexión opcional y propiedad de transacción externa cuando se proporciona; comportamiento propio intacto. |
| `models/catalogomodel.js` | 5 y 21 | Conexión opcional para consultar catálogos dentro de la transacción. |
| `views/register.ejs` | 8–9, 23–24, 58, 62–63 | Recursos específicos, aviso de errores, nota sin JS, texto Continuar a preferencias, include del modal y script. |
| `views/perfil.ejs` | 11, sección Alergias e intolerancias | Hoja específica y tarjetas; retirada del botón y modal antiguo. |
| `public/Js/firebase-auth.js` | Registro Google, 100–107 | Cierre de la confirmación de datos, signOut del flujo nuevo y apertura del componente compartido; sin redirección al Lobby desde ese bloque. |
| `public/Js/app.js` | Bloque de Perfil, 534–608 | Retirada de referencias y manejadores exclusivos del modal antiguo. Se conserva el guardado principal de preferencias y datos personales. |

No se modificaron esquemas, variables de entorno, conexión MySQL, autenticación
Google existente, rutas Firebase, código de recetas, pagos, suscripciones, cuotas,
Despensa, Lista de Compras, favoritos, historial, reseñas, Sidebar o Ajustes.

## Pruebas y resultados

Comando:

```text
node --test --test-reporter=dot tests/registroPreferencias.test.js tests/paypal.test.js tests/suscripciones.test.js
```

**93 pruebas aprobadas**, incluidas las 71 pruebas anteriores de PayPal y
suscripciones. No se crearon usuarios reales ni se ejecutaron consultas contra
MySQL real. Los modelos se cargan con conexiones sustitutas en memoria.

Cobertura nueva:

- Normal con alergias, intolerancias, ambas y ninguna.
- Deduplicación de IDs; rechazo de tipos inválidos e IDs fuera del catálogo.
- Finalizaciones simultáneas y repetidas sin otra creación.
- Cancelación de confirmación y error de guardado conservando selecciones.
- Transacción, commit y rollback para cuentas normales y Google.
- Modelos con conexión compartida; preferencias con transacción propia.
- Tokens ligados a sesión, caducidad, pérdida del borrador tras reinicio y
  protección frente a finalizar otra cuenta durante una sesión autenticada.
- Borradores recuperables, deduplicados, sin SQL y protegidos contra revisiones
  antiguas o cambios posteriores al commit.
- Validación de datos antes de preparar el registro.
- Google nuevo sin sesión automática; login Google existente conserva su acceso.
- Finalización con comprobación de origen y flash después del commit.
- Recuperación de IDs para Perfil y nombres de restricciones para generación.
- DOM simulado: abrir, confirmar, cancelar, error, reintentar y redirigir al Login.
- Renderizado EJS de Registro y Perfil, controles existentes y clases de tarjetas.
- Revisión del CSS responsive/oscuro/movimiento reducido y del puente Google.

Se comprobó sintaxis de los scripts y controladores modificados; el módulo
Firebase se comprobó en modo ES module, sin ejecutar sus imports remotos.

## Limitaciones y prueba manual pendiente

- Los borradores y recibos viven en este proceso Node durante 15 minutos. No
  son persistentes ante reinicios ni se comparten entre múltiples instancias.
  Esto es compatible con el almacén de sesión en memoria actual. Si se reinicia
  antes de finalizar, deben completarse los datos nuevamente y no se ha creado
  ninguna cuenta por ese borrador.
- Si se pierde la respuesta después del commit y también se reinicia el proceso,
  los índices únicos impiden duplicados, pero no hay un recibo persistente para
  reconstruir esa respuesta. Debe intentarse el Login; no se sobrescriben
  preferencias de una cuenta encontrada por correo.
- Las selecciones se envían como borrador temporal en cada cambio, sin SQL.
  Al salir se intenta un último envío con `keepalive`. Una desconexión inmediata
  puede impedir entregar el último cambio: no puede garantizarse la recuperación
  de un borrador que nunca llegó al servidor. El modal informa si falla ese envío.
- No se comprobó visualmente el responsive, los colores o la gestión nativa del
  foco en un navegador real. Las pruebas DOM y las comprobaciones CSS no
  sustituyen esa revisión.
- No se hicieron registros Google reales ni llamadas Firebase de prueba.
- No se modificó la base real para confirmar restricciones/índices: se revisó
  el esquema del proyecto. Debe conservar sus claves UNIQUE y relaciones.

Prueba manual autorizada: registrar una cuenta nueva de cada tipo, seleccionar
opciones y cancelar la confirmación, volver a confirmar, comprobar el Login y
las selecciones en Perfil; repetir sin restricciones. Revisar en escritorio y
celular, con ambos temas. Verificar con una cuenta Google ya existente que el
login sigue entrando al Lobby sin presentar la ventana de registro. No deben
usarse usuarios reales de prueba sin la autorización adicional correspondiente.

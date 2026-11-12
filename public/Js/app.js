// Este archivo controla las pantallas y guarda perfiles y preferencias en el navegador.
// El formulario clásico de registro se envía directamente a la ruta de Express.
// La autenticación de Google está en firebase-auth.js.




//============================================================================
// CUENTAS Y PERFILES
// Cada perfil se guarda usando el nombre como identificador.
// ============================================================================

const mostrarFormularioPerfilInicial = datosIniciales => new Promise(resolve => {
  const modal = obtenerElemento('modalPerfilInicial');
  const formulario = obtenerElemento('formPerfilInicial');
  if (!modal || !formulario) {
    resolve(null);
    return;
  }

  const campos = {
    nombre: 'inicioNombre',
    apellido: 'inicioApellido',
    correo: 'inicioCorreo',
    telefono: 'inicioTelefono'
  };
  const alergias = datosIniciales?.alergias || [];
  const intolerancias = datosIniciales?.intolerancias || [];

  Object.entries(campos).forEach(([clave, id]) => {
    obtenerElemento(id).value = datosIniciales?.[clave] || '';
  });
  formulario.querySelectorAll('input[name="alergias"]').forEach(casilla => {
    casilla.checked = alergias.includes(casilla.value);
  });
  formulario.querySelectorAll('input[name="intolerancias"]').forEach(casilla => {
    casilla.checked = intolerancias.includes(casilla.value);
  });

  modal.classList.add('abierto');
  formulario.onsubmit = evento => {
    evento.preventDefault();
    const perfil = {
      ...datosIniciales,
      ...Object.fromEntries(
        Object.entries(campos).map(([clave, id]) => [clave, obtenerElemento(id).value.trim()])
      ),
      alergias: [...formulario.querySelectorAll('input[name="alergias"]:checked')].map(casilla => casilla.value),
      intolerancias: [...formulario.querySelectorAll('input[name="intolerancias"]:checked')].map(casilla => casilla.value)
    };
    guardarPerfilActivo(perfil);
    modal.classList.remove('abierto');
    resolve(perfil);
  };
});

window.mostrarFormularioPerfilInicial = mostrarFormularioPerfilInicial;

// ============================================================================

// UTILIDADES GENERALES
// ============================================================================

// Lee JSON del almacenamiento local y devuelve un valor seguro si aún no existe.
const leer = (clave, porDefecto = []) => {
  const valor = localStorage.getItem(clave);
  return valor ? JSON.parse(valor) : porDefecto;
};

// Guarda los datos en el navegador para que la interfaz funcione sin base de datos.
const guardar = (clave, datos) => {
  localStorage.setItem(clave, JSON.stringify(datos));
};

// ============================================================================
// CUENTAS Y PERFILES PROVISIONALES
// Este bloque se puede reemplazar por consultas a la base de datos más adelante.
// ============================================================================

// Normaliza teléfono y correo para que la misma cuenta no se guarde dos veces.
const normalizarIdentificador = valor => String(valor || '').trim().toLowerCase().replace(/[^a-z0-9@.+_-]/g, '');

// Genera una clave estable sin depender del nombre visible del usuario.
const crearIdCuenta = ({ telefono, correo, firebaseUid } = {}) => {
  const identificador = normalizarIdentificador(firebaseUid || correo || telefono);
  return identificador ? `${firebaseUid ? 'google' : 'sms'}_${identificador}` : `local_${Date.now()}`;
};

const obtenerPerfiles = () => {
  const perfiles = leer('miCocinaPerfiles', {});
  const perfilAnterior = leer('miCocinaPerfil', null);

  // Migra el formato anterior, que usaba el nombre como clave, una sola vez.
  if (perfilAnterior?.nombre) {
    const id = perfilAnterior.id || crearIdCuenta(perfilAnterior);
    if (!perfiles[id]) perfiles[id] = { ...perfilAnterior, id };
    guardar('miCocinaPerfiles', perfiles);
  }
  return perfiles;
};

// Busca una cuenta por teléfono, correo o UID de Google.
const buscarPerfil = ({ telefono, correo, firebaseUid } = {}) => {
  const valores = [telefono, correo, firebaseUid].map(normalizarIdentificador).filter(Boolean);
  return Object.values(obtenerPerfiles()).find(perfil => (
    valores.includes(normalizarIdentificador(perfil.telefono)) ||
    valores.includes(normalizarIdentificador(perfil.correo)) ||
    valores.includes(normalizarIdentificador(perfil.firebaseUid))
  )) || null;
};

const obtenerPerfilActivo = () => {
  const idActivo = localStorage.getItem('miCocinaUsuarioActivo');
  return idActivo ? obtenerPerfiles()[idActivo] || null : null;
};

const guardarPerfilActivo = perfil => {
  const perfiles = obtenerPerfiles();
  const perfilGuardado = { ...perfil, id: perfil.id || crearIdCuenta(perfil) };
  perfiles[perfilGuardado.id] = perfilGuardado;
  guardar('miCocinaPerfiles', perfiles);
  guardar('miCocinaPerfil', perfilGuardado);
  localStorage.setItem('miCocinaUsuarioActivo', perfilGuardado.id);
  return perfilGuardado;
};

const perfilTienePersonalizacion = perfil => Boolean(
  perfil?.personalizacionCompleta === true || (
    Array.isArray(perfil?.alergias) && Array.isArray(perfil?.intolerancias)
  )
);

// Abre la personalización solo cuando todavía no se ha confirmado.
const abrirPersonalizacion = (perfil, despuesDeGuardar = () => {}) => {
  const modal = obtenerElemento('modalPersonalizacion');
  const formulario = obtenerElemento('formPersonalizacion');

  if (perfilTienePersonalizacion(perfil)) {
    despuesDeGuardar(perfil);
    return;
  }

  if (!modal || !formulario) {
    despuesDeGuardar(perfil);
    return;
  }

  document.querySelectorAll('#formPersonalizacion input[name="alergias"], #formPersonalizacion input[name="intolerancias"]')
    .forEach(casilla => {
      const grupo = casilla.name;
      casilla.checked = (perfil[grupo] || []).includes(casilla.value);
    });
  modal.classList.add('abierto');

  // El arreglo vacío también es válido: significa que la persona eligió no declarar restricciones.
  formulario.onsubmit = evento => {
    evento.preventDefault();
    const perfilPersonalizado = guardarPerfilActivo({
      ...perfil,
      alergias: [...formulario.querySelectorAll('input[name="alergias"]:checked')].map(casilla => casilla.value),
      intolerancias: [...formulario.querySelectorAll('input[name="intolerancias"]:checked')].map(casilla => casilla.value),
      personalizacionCompleta: true
    });
    modal.classList.remove('abierto');
    despuesDeGuardar(perfilPersonalizado);
  };
};

// Expone el adaptador que luego podrá reemplazarse por llamadas a la base de datos.
window.miCocinaAuth = {
  buscarPerfil,
  guardarPerfilActivo,
  obtenerPerfilActivo,
  crearIdCuenta,
  perfilTienePersonalizacion,
  abrirPersonalizacion
};

const obtenerElemento = id => document.getElementById(id);
const formatearCantidad = cantidad => String(cantidad ?? '')
  .replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
let favoritosConfirmados = [];
let estadoCargaFavoritos = 'pendiente';
let promesaCargaFavoritos = null;
const favoritosEnProceso = new Set();
const favoritos = () => favoritosConfirmados;
const esPropuestaPendiente = receta => receta?.verificacionAlimentaria?.estado === 'pendiente';
const idRecetaValido = receta => !esPropuestaPendiente(receta) && Number.isSafeInteger(Number(receta?.idReceta)) && Number(receta.idReceta) > 0;
let temporizadorAvisoFavoritos;
const mostrarNotificacionCookIQ = (texto, tipo = 'info') => {
  if (!texto) return;
  let aviso = obtenerElemento('avisoFavoritos');
  if (!aviso) {
    aviso = document.createElement('div');
    aviso.id = 'avisoFavoritos';
    aviso.className = 'favoritos-toast';
    aviso.setAttribute('role', 'status');
    aviso.setAttribute('aria-live', 'polite');
    document.body.append(aviso);
  }
  if (aviso.classList.contains('visible') && aviso.textContent === texto && aviso.dataset.tipo === tipo) return;
  aviso.dataset.tipo = tipo;
  aviso.dataset.multilinea = String(texto.includes('\n'));
  aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  aviso.setAttribute('aria-live', tipo === 'error' ? 'assertive' : 'polite');
  aviso.textContent = texto;
  aviso.classList.add('visible');
  clearTimeout(temporizadorAvisoFavoritos);
  temporizadorAvisoFavoritos = setTimeout(() => aviso.classList.remove('visible'),
    tipo === 'exito' ? 3000 : Math.min(16000, Math.max(6000, texto.length * 40)));
};
const mostrarAvisoFavoritos = texto => mostrarNotificacionCookIQ(texto, 'exito');
const mensajeGeneracion = datos => {
  const partes = [];
  const resumir = (titulo, elementos) => {
    if (!Array.isArray(elementos) || !elementos.length) return;
    const categorias = new Map();
    for (const item of elementos) {
      if (typeof item.ingrediente !== 'string' || !item.ingrediente.trim()) continue;
      const categoria = item.estado === 'incompatible' ? 'Incompatibilidad confirmada'
        : item.estado === 'requiere_adaptacion' ? 'Ingredientes que requieren adaptacion para tus restricciones'
        : item.estado !== 'no_verificable' ? null
        : ['IDENTIDAD_AMBIGUA', 'IDENTIDAD_NO_RESUELTA', 'EXPRESION_CULINARIA_AMBIGUA', 'REFERENCIA_AMBIGUA'].includes(item.motivo) ? 'Identidad o referencia ambigua o no resuelta'
        : item.motivo === 'INGREDIENTE_NO_HABILITADO' ? 'Ingrediente no habilitado en el catálogo'
        : 'Información insuficiente para verificar compatibilidad';
      if (!categoria) continue;
      const nombres = categorias.get(categoria) || new Map();
      nombres.set(item.ingrediente.trim().toLocaleLowerCase('es-CL'), item.ingrediente.trim());
      categorias.set(categoria, nombres);
    }
    if (categorias.size) partes.push(titulo + '\n' + [...categorias].map(([categoria, nombres]) => categoria + ': ' + [...nombres.values()].join(', ') + '.').join('\n'));
  };
  resumir('Ingredientes iniciales no utilizados como disponibles:', datos.ingredientesExcluidos);
  const problemas = Array.isArray(datos.problemasRecetas) ? datos.problemasRecetas : datos.ingredientesNoVerificados;
  resumir('Recetas propuestas no seleccionadas (ingredientes detectados):', problemas);
  if (datos.recetasDescartadas && !Array.isArray(problemas)) partes.push('No se seleccionaron algunas recetas propuestas.');
  const advertenciaAnterior = 'Se excluyeron ingredientes o recetas incompatibles o cuya compatibilidad no pudo verificarse con tus restricciones.';
  if (datos.advertencia && datos.advertencia !== advertenciaAnterior) partes.push(datos.advertencia);
  if (datos.advertenciaHistorial) partes.push(datos.advertenciaHistorial);
  if (datos.mensaje) partes.push(datos.mensaje);
  return [...new Set(partes)].join('\n\n');
};
const mensajePublicoGeneracion = texto => {
  const mensaje = typeof texto === 'string' ? texto : '';
  return /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+.+\s+SET|SQLSTATE|ER_[A-Z_]+|Bearer\s+|sk-[\w-]+)|\b(?:api[_ -]?key|password|cookie|token|authorization|stack trace)\s*[:=]|\bat\s+[^\n]+\.js:\d+|<!doctype|<html/i.test(mensaje)
    ? 'No se pudo completar la generación. Inténtalo nuevamente.'
    : mensaje;
};
const mostrarFlashServidor = () => {
  const mensaje = obtenerElemento('mensajeFlashCookIQ')?.textContent?.trim();
  if (mensaje) mostrarAvisoFavoritos(mensaje);
};
let confirmacionCookIQAbierta = false;
const confirmarAccionCookIQ = ({ mensaje, textoConfirmar = 'Sí, eliminar', imagenPrevia = null }) => {
  if (confirmacionCookIQAbierta || document.querySelector('dialog[open]')) return Promise.resolve(false);
  confirmacionCookIQAbierta = true;
  return new Promise(resolve => {
  const focoAnterior = document.activeElement;
  const dialogo = document.createElement('dialog');
  dialogo.className = 'favorito-dialogo';
  dialogo.setAttribute('aria-labelledby', 'tituloConfirmarFavorito');
  dialogo.innerHTML = `
    <h2 id="tituloConfirmarFavorito"></h2>
    <div class="favorito-dialogo-acciones">
      <button type="button" class="favorito-dialogo-cancelar">Cancelar</button>
      <button type="button" class="favorito-dialogo-confirmar"></button>
    </div>`;
  dialogo.querySelector('h2').textContent = mensaje;
  dialogo.querySelector('.favorito-dialogo-confirmar').textContent = textoConfirmar;
  if (typeof imagenPrevia === 'string' && imagenPrevia.startsWith('blob:')) {
    const previa = document.createElement('img');
    previa.src = imagenPrevia;
    previa.alt = 'Vista previa de la nueva foto de perfil';
    previa.className = 'perfil-avatar-previa';
    dialogo.querySelector('h2').after(previa);
  }
  document.body.append(dialogo);
  let terminado = false;
  const cerrar = confirmado => {
    if (terminado) return;
    terminado = true;
    dialogo.close();
    dialogo.remove();
    confirmacionCookIQAbierta = false;
    if (focoAnterior?.isConnected) focoAnterior.focus();
    resolve(confirmado);
  };
  dialogo.querySelector('.favorito-dialogo-cancelar').addEventListener('click', () => cerrar(false));
  dialogo.querySelector('.favorito-dialogo-confirmar').addEventListener('click', () => cerrar(true));
  dialogo.addEventListener('cancel', evento => {
    evento.preventDefault();
    cerrar(false);
  });
  dialogo.addEventListener('close', () => cerrar(false));
  dialogo.showModal();
  dialogo.querySelector('.favorito-dialogo-cancelar').focus();
});
};
const confirmarQuitarFavorito = () => confirmarAccionCookIQ({
  mensaje: '¿Estás seguro de que quieres quitar esta receta de favoritos?', textoConfirmar: 'Sí, quitar'
});
const solicitarApiFavoritos = async (url, opciones = {}) => {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: { Accept: 'application/json', ...(opciones.headers || {}) }
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || !datos.ok) {
    const error = new Error(datos.mensaje || 'No se pudo completar la operación de favoritos.');
    error.status = respuesta.status;
    throw error;
  }
  return datos;
};
const cargarFavoritosDesdeApi = () => {
  if (promesaCargaFavoritos) return promesaCargaFavoritos;
  estadoCargaFavoritos = 'cargando';
  promesaCargaFavoritos = solicitarApiFavoritos('/api/favoritos')
    .then(datos => {
      if (!Array.isArray(datos.favoritos)) throw new Error('El servidor devolvió una lista de favoritos inválida.');
      favoritosConfirmados = datos.favoritos;
      estadoCargaFavoritos = 'listo';
      return favoritosConfirmados;
    })
    .catch(error => {
      estadoCargaFavoritos = 'error';
      promesaCargaFavoritos = null;
      throw error;
    });
  return promesaCargaFavoritos;
};
const alternarFavoritoEnApi = async receta => {
  if (!idRecetaValido(receta)) throw new Error('Esta receta no tiene un identificador válido para guardarla en favoritos.');
  if (estadoCargaFavoritos !== 'listo') throw new Error('No se pudo consultar el estado de favoritos. Inténtalo nuevamente.');
  const idReceta = Number(receta.idReceta);
  if (favoritosEnProceso.has(idReceta)) return favoritos().some(item => Number(item.idReceta) === idReceta);

  favoritosEnProceso.add(idReceta);
  try {
    const yaEsFavorita = favoritos().some(item => Number(item.idReceta) === idReceta);
    if (yaEsFavorita) {
      await solicitarApiFavoritos(`/api/favoritos/${idReceta}`, { method: 'DELETE' });
      favoritosConfirmados = favoritos().filter(item => Number(item.idReceta) !== idReceta);
      return false;
    }

    await solicitarApiFavoritos(`/api/favoritos/${idReceta}`, { method: 'POST' });
    if (!favoritos().some(item => Number(item.idReceta) === idReceta)) {
      favoritosConfirmados = [
        ...favoritos(),
        {
          ...receta,
          idReceta,
          tiempo: receta.minutosPreparacion ?? receta.tiempo,
          porciones: receta.porciones
        }
      ];
    }
    return true;
  } finally {
    favoritosEnProceso.delete(idReceta);
  }
};
const obtenerImagenReceta = receta => receta?.imagen?.url || receta?.imagenUrl || null;
const obtenerCreditoImagen = receta => (
  receta?.imagen?.autor && receta.imagen.autorUrl && receta.imagen.fuenteUrl
    ? `<p class="credito-foto">Foto de <a href="${receta.imagen.autorUrl}" target="_blank" rel="noopener noreferrer">${receta.imagen.autor}</a> en <a href="${receta.imagen.fuenteUrl}" target="_blank" rel="noopener noreferrer">Unsplash</a></p>`
    : ''
);
const renderizarAdvertenciaAlimentaria = receta => {
  if (!esPropuestaPendiente(receta)) return '';
  const escapar = texto => String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const afectados = Array.isArray(receta.verificacionAlimentaria.ingredientes) ? receta.verificacionAlimentaria.ingredientes : [];
  const comprobaciones = Array.isArray(receta.verificacionAlimentaria.comprobaciones) ? receta.verificacionAlimentaria.comprobaciones : [];
  const datosFaltantes = comprobaciones.length ? `<p><b>Para resolverlo:</b></p><ul>${comprobaciones.map(item => `<li>${escapar(item.ingrediente)}: ${escapar(item.datoFaltante)}</li>`).join('')}</ul>` : '';
  if (receta.verificacionAlimentaria.motivo === 'clasificacion') {
    return `<aside class="receta-verificacion-pendiente" role="note"><strong>Propuesta pendiente de clasificación en el catálogo</strong><p>Ingredientes afectados: ${afectados.map(escapar).join(', ')}.</p><p>No se guardó esta propuesta. La clasificación alimentaria y la compatibilidad con tus restricciones son comprobaciones distintas.</p></aside>`;
  }
  return `<aside class="receta-verificacion-pendiente" role="note"><strong>Propuesta pendiente de verificación</strong><p>No está verificada para tus alergias o intolerancias. Comprueba su composición antes de preparar o consumir.</p><p>Ingredientes afectados: ${afectados.map(escapar).join(', ')}.</p>${datosFaltantes}<small>No se guarda como receta compatible ni está disponible para favoritos, reseñas o lista de compras.</small></aside>`;
};
const renderizarDetalleReceta = (receta, { formatearCantidades = false } = {}) => {
  const tiempo = receta.minutosPreparacion ?? receta.tiempo ?? 'No especificado';
  const porciones = receta.porciones ?? 'No especificadas';
  const ingredientes = Array.isArray(receta.ingredientes) ? receta.ingredientes : [];
  const imagenUrl = obtenerImagenReceta(receta);
  return `
    <div class="detalle-receta-foto">${imagenUrl ? `<img src="${imagenUrl}" alt="${receta.imagen?.alt || receta.nombre}" onerror="this.remove()">` : '<span aria-hidden="true">🍽️</span>'}</div>
    ${obtenerCreditoImagen(receta)}
    <h2>${receta.icono || '🍽️'} ${receta.nombre}</h2>
    ${renderizarAdvertenciaAlimentaria(receta)}
    <p>${receta.descripcion || ''}</p>
    <p><b>Tiempo:</b> ${tiempo}${typeof tiempo === 'number' ? ' min' : ''} · <b>Porciones:</b> ${porciones} · <b>Dificultad:</b> ${receta.dificultad || 'No especificada'}</p>
    <h3>Ingredientes</h3>
    <ul>${ingredientes.map(ingrediente => {
      if (typeof ingrediente === 'string') return `<li>${ingrediente}</li>`;
      const cantidad = formatearCantidades && ingrediente.cantidad !== null && ingrediente.cantidad !== undefined
        ? formatearCantidad(ingrediente.cantidad)
        : ingrediente.cantidad;
      return `<li>${[cantidad, ingrediente.unidad, ingrediente.nombre || ingrediente.ingrediente].filter(Boolean).join(' ')}${ingrediente.indicacion ? ` (${ingrediente.indicacion})` : ''}</li>`;
    }).join('')}</ul>
    ${Array.isArray(receta.ingredientesFaltantes) && receta.ingredientesFaltantes.length ? `<h3>Ingredientes faltantes</h3><ul>${receta.ingredientesFaltantes.map(ingrediente => `<li>${ingrediente}</li>`).join('')}</ul>` : ''}
    <h3>Preparación</h3>
    <ol>${(Array.isArray(receta.pasos) ? receta.pasos : []).map(paso => `<li>${paso}</li>`).join('')}</ol>
  `;
};

// ============================================================================
// SIDEBAR
// Marca como activa la pestaña correspondiente a la URL actual.
// ============================================================================

const iniciarSidebar = () => {
  const rutaActual = window.location.pathname.replace(/\/$/, '') || '/';

  document.querySelectorAll('.inicio-menu a').forEach(enlace => {
    const rutaEnlace = new URL(enlace.href, window.location.origin).pathname.replace(/\/$/, '');
    enlace.classList.toggle('activa', rutaEnlace === rutaActual);
  });
};

const ingredientesDisponibles = [
  'tomate', 'pollo', 'arroz', 'papa', 'cebolla', 'zanahoria', 'ajo',
  'huevo', 'queso', 'pasta', 'atún', 'palta', 'espinaca', 'leche',
  'champiñón', 'lentejas'
];

const solicitarApiListaCompras = async (url, opciones = {}) => {
  const respuesta = await fetch(url, opciones);
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || datos.ok === false) {
    const error = new Error(datos.mensaje || 'No se pudo completar la operación.');
    error.status = respuesta.status;
    throw error;
  }
  return datos;
};

// ============================================================================
// PANTALLA DE PERFIL
// Carga los datos guardados y permite actualizar la información personal.
// ============================================================================

const iniciarPerfil = async () => {
  const formulario = obtenerElemento('formPerfil');
  if (!formulario) return;

  const campos = {
    nombre: 'perfilNombre',
    apellido: 'perfilApellido',
    correo: 'perfilCorreo',
    telefono: 'perfilTelefono'
  };
  const camposObligatorios = [
    { clave: 'nombre', etiqueta: 'El nombre' },
    { clave: 'apellido', etiqueta: 'El apellido' },
    { clave: 'correo', etiqueta: 'El correo electrónico' },
    { clave: 'telefono', etiqueta: 'El teléfono' }
  ];
  const mensajeValidacion = obtenerElemento('perfilErrorValidacion');
  const datos = {};

  formulario.addEventListener('invalid', evento => {
    const campo = evento.target;
    if (!campo.matches('[required]')) return;
    const requerido = camposObligatorios.find(item => campos[item.clave] === campo.id);
    if (!requerido) return;
    campo.classList.add('campo-invalido');
    campo.setAttribute('aria-invalid', 'true');
    mensajeValidacion.textContent = !campo.value.trim() || campo.validity.valueMissing
      ? `${requerido.etiqueta} es obligatorio.`
      : requerido.clave === 'correo'
        ? 'Ingresa un correo electrónico válido.'
        : 'El teléfono debe tener el formato +569 seguido de ocho dígitos.';
    mensajeValidacion.hidden = false;
  }, true);

  camposObligatorios.forEach(({ clave }) => {
    const campo = obtenerElemento(campos[clave]);
    campo.addEventListener('input', () => {
      const valorValido = campo.value.trim() && campo.validity.valid &&
        (clave !== 'telefono' || /^\+569\d{8}$/.test(campo.value.trim()));
      if (valorValido) {
        campo.classList.remove('campo-invalido');
        campo.removeAttribute('aria-invalid');
      }
      if (camposObligatorios.every(item => {
        const campoObligatorio = obtenerElemento(campos[item.clave]);
        const valor = campoObligatorio.value.trim();
        return valor && campoObligatorio.validity.valid &&
          (item.clave !== 'telefono' || /^\+569\d{8}$/.test(valor));
      })) {
        mensajeValidacion.hidden = true;
        mensajeValidacion.textContent = '';
      }
    });
  });

  Object.values(campos).forEach(id => {
    obtenerElemento(id).value = '';
  });

  // Los datos personales siempre proceden de la cuenta asociada a la sesión del servidor.
  try {
    const respuestaSesion = await fetch('/api/firebase/sesion', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const resultadoSesion = await respuestaSesion.json().catch(() => null);

    if (respuestaSesion.status !== 401) {
      if (!respuestaSesion.ok || !resultadoSesion?.ok || !resultadoSesion.usuario) {
        throw new Error('No se pudieron cargar los datos de la cuenta autenticada.');
      }

      const usuario = resultadoSesion.usuario;
      Object.assign(datos, {
        id: `usuario_${usuario.id_usuario}`,
        firebaseUid: usuario.google_id || null,
        nombre: usuario.nombres || '',
        apellido: usuario.apellidos || '',
        correo: usuario.correo || '',
        telefono: usuario.telefono || ''
      });
      Object.entries(campos).forEach(([clave, id]) => {
        obtenerElemento(id).value = datos[clave];
      });
    }
  } catch (error) {
    console.error('Error al cargar los datos de la cuenta autenticada:', error);
    mostrarNotificacionCookIQ('No se pudieron cargar los datos de tu perfil. Intenta recargar la página.', 'error');
  }

  // Carga el catálogo una vez y comparte sus opciones entre perfil y modal.
  let catalogos;
  try {
    const respuesta = await fetch('/catalogos');
    if (!respuesta.ok) throw new Error('No se pudieron cargar los catálogos.');
    catalogos = await respuesta.json();
  } catch (error) {
    console.error('Error al cargar alergias e intolerancias:', error);
    ['opcionesAlergias'].forEach(id => {
      obtenerElemento(id).textContent = 'No se pudieron cargar las alergias.';
    });
    ['opcionesIntolerancias'].forEach(id => {
      obtenerElemento(id).textContent = 'No se pudieron cargar las intolerancias.';
    });
    return;
  }

  const pintarCatalogo = (contenedorId, nombreGrupo, elementos, idCampo) => {
    const contenedor = obtenerElemento(contenedorId);
    elementos.forEach(elemento => {
      const etiqueta = document.createElement('label');
      const casilla = document.createElement('input');
      casilla.type = 'checkbox';
      casilla.name = nombreGrupo;
      // Guardamos el nombre para conservar compatibilidad con localStorage existente.
      casilla.value = elemento.nombre;
      casilla.dataset.catalogoId = elemento[idCampo];
      etiqueta.append(casilla, document.createTextNode(` ${elemento.nombre}`));
      contenedor.appendChild(etiqueta);
    });
  };

  pintarCatalogo('opcionesAlergias', 'alergias', catalogos.alergias, 'id_alergia');
  pintarCatalogo('opcionesIntolerancias', 'intolerancias', catalogos.intolerancias, 'id_intolerancia');

  // Recupera de MySQL las selecciones de la sesión actual y marca ambos formularios por ID.
  try {
    const respuestaPreferencias = await fetch('/preferencias');
    if (!respuestaPreferencias.ok) throw new Error('No se pudieron recuperar las preferencias.');
    const preferencias = await respuestaPreferencias.json();
    const alergiasSeleccionadas = new Set(preferencias.alergias.map(String));
    const intoleranciasSeleccionadas = new Set(preferencias.intolerancias.map(String));

    document.querySelectorAll(
      '#formPerfil input[name="alergias"]'
    ).forEach(casilla => {
      casilla.checked = alergiasSeleccionadas.has(casilla.dataset.catalogoId);
    });
    document.querySelectorAll(
      '#formPerfil input[name="intolerancias"]'
    ).forEach(casilla => {
      casilla.checked = intoleranciasSeleccionadas.has(casilla.dataset.catalogoId);
    });
  } catch (error) {
    console.error('Error al recuperar alergias e intolerancias:', error);
    mostrarNotificacionCookIQ('No se pudieron recuperar tus alergias e intolerancias. Recarga la página antes de editar tus preferencias.', 'error');
  }

  // Envía a MySQL los IDs seleccionados en el formulario indicado.
  const guardarPreferenciasEnBD = async formularioPreferencias => {
    const alergias = [...formularioPreferencias.querySelectorAll('input[name="alergias"]:checked')]
      .map(casilla => Number(casilla.dataset.catalogoId));
    const intolerancias = [...formularioPreferencias.querySelectorAll('input[name="intolerancias"]:checked')]
      .map(casilla => Number(casilla.dataset.catalogoId));

    const respuesta = await fetch('/preferencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alergias, intolerancias })
    });
    if (!respuesta.ok) throw new Error('No se pudieron guardar las preferencias en la base de datos.');
    return respuesta.json();
  };

  const guardarCambios = async () => {
    const perfilActualizado = {
      ...datos,
      ...Object.fromEntries(
        Object.entries(campos).map(([clave, id]) => [
          clave,
          obtenerElemento(id).value.trim()
        ])
      ),
      alergias: [...document.querySelectorAll('#formPerfil input[name="alergias"]:checked')]
        .map(casilla => casilla.value),
      intolerancias: [...document.querySelectorAll('#formPerfil input[name="intolerancias"]:checked')]
        .map(casilla => casilla.value)
    };

    const guardarDatosPersonalesEnBD = async () => {
      const respuestaPerfil = await fetch('/api/firebase/perfil', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          nombres: perfilActualizado.nombre,
          apellidos: perfilActualizado.apellido,
          correo: perfilActualizado.correo,
          telefono: perfilActualizado.telefono
        })
      });
      const resultadoPerfil = await respuestaPerfil.json().catch(() => null);
      if (!respuestaPerfil.ok || !resultadoPerfil?.ok) {
        throw new Error(resultadoPerfil?.error || 'No se pudieron guardar los datos personales.');
      }
    };

    await Promise.all([
      guardarDatosPersonalesEnBD(),
      guardarPreferenciasEnBD(formulario)
    ]);
    guardarPerfilActivo(perfilActualizado);
    Object.assign(datos, perfilActualizado);
    return perfilActualizado;
  };

  const validarCamposPerfil = () => {
    camposObligatorios.forEach(({ clave }) => {
      const campo = obtenerElemento(campos[clave]);
      campo.classList.remove('campo-invalido');
      campo.removeAttribute('aria-invalid');
    });

    const campoInvalido = camposObligatorios.find(({ clave }) => {
      const valor = obtenerElemento(campos[clave]).value.trim();
      return !valor || !obtenerElemento(campos[clave]).validity.valid || (clave === 'telefono' && !/^\+569\d{8}$/.test(valor));
    });
    if (campoInvalido) {
      const campo = obtenerElemento(campos[campoInvalido.clave]);
      campo.classList.add('campo-invalido');
      campo.setAttribute('aria-invalid', 'true');
      mensajeValidacion.textContent = !campo.value.trim()
        ? `${campoInvalido.etiqueta} es obligatorio.`
        : campoInvalido.clave === 'correo' ? 'Ingresa un correo electrónico válido.'
          : 'El teléfono debe tener el formato +569 seguido de ocho dígitos.';
      mensajeValidacion.hidden = false;
      campo.focus();
      return false;
    }

    mensajeValidacion.hidden = true;
    mensajeValidacion.textContent = '';
    return true;
  };

  let guardandoPerfil = false;
  formulario.onsubmit = async evento => {
    evento.preventDefault();
    if (guardandoPerfil || !validarCamposPerfil()) return;
    guardandoPerfil = true;
    const botonesGuardar = formulario.querySelectorAll('[type="submit"]');
    botonesGuardar.forEach(boton => { boton.disabled = true; });
    try {
      const confirmado = await confirmarAccionCookIQ({
        mensaje: '¿Estás seguro de que deseas guardar los cambios realizados en tu perfil?',
        textoConfirmar: 'Sí, guardar cambios'
      });
      if (!confirmado || !validarCamposPerfil()) return;
      await guardarCambios();
      mostrarNotificacionCookIQ('Los cambios de tu perfil se guardaron correctamente.', 'exito');
    } catch (error) {
      console.error('Error al guardar los cambios:', error);
      mostrarNotificacionCookIQ('No se pudieron guardar los cambios de tu perfil. Revisa los datos e inténtalo nuevamente.', 'error');
    } finally {
      guardandoPerfil = false;
      botonesGuardar.forEach(boton => { boton.disabled = false; });
    }
  };

  let cierreSesionEnCurso = false;
  obtenerElemento('cerrarSesion').onclick = async evento => {
    if (cierreSesionEnCurso) return;
    cierreSesionEnCurso = true;
    const boton = evento.currentTarget;
    const confirmado = await new Promise(resolve => {
      const dialogo = document.createElement('dialog');
      dialogo.className = 'favorito-dialogo';
      dialogo.setAttribute('aria-labelledby', 'tituloConfirmarCierreSesion');
      dialogo.innerHTML = `
        <h2 id="tituloConfirmarCierreSesion">¿Quieres cerrar sesión?</h2>
        <p>Tendrás que iniciar sesión nuevamente para acceder a tu cocina.</p>
        <div class="favorito-dialogo-acciones">
          <button type="button" data-cancelar-cierre>Cancelar</button>
          <button type="button" class="favorito-dialogo-confirmar" data-confirmar-cierre>Sí, cerrar sesión</button>
        </div>`;
      const cerrar = aceptar => {
        dialogo.close();
        dialogo.remove();
        boton.focus();
        resolve(aceptar);
      };
      dialogo.querySelector('[data-cancelar-cierre]').onclick = () => cerrar(false);
      dialogo.querySelector('[data-confirmar-cierre]').onclick = () => cerrar(true);
      dialogo.addEventListener('cancel', eventoCancelacion => {
        eventoCancelacion.preventDefault();
        cerrar(false);
      });
      document.body.append(dialogo);
      dialogo.showModal();
      dialogo.querySelector('[data-cancelar-cierre]').focus();
    });
    if (!confirmado) {
      cierreSesionEnCurso = false;
      return;
    }
    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Cerrando sesión...';

    try {
      const respuesta = await fetch('/api/firebase/logout', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok || !resultado?.ok) {
        throw new Error(resultado?.error || 'No se pudo cerrar la sesión.');
      }

      localStorage.removeItem('miCocinaRecetasGeneradas');
      localStorage.removeItem('miCocinaUsuarioActivo');
      window.location.assign('/usuarios/login');
    } catch (error) {
      console.error('Error al cerrar la sesión:', error);
      alert(error.message || 'No se pudo cerrar la sesión. Inténtalo nuevamente.');
      boton.disabled = false;
      boton.textContent = textoOriginal;
      cierreSesionEnCurso = false;
    }
  };
};

// ============================================================================
// PANTALLA LOBBY: BUSCADOR Y RECETAS
// Gestiona ingredientes, filtros, resultados, favoritos e historial.
// ============================================================================
const iniciarLobby = () => {
  const buscarIngrediente = obtenerElemento('buscarIngrediente');
  if (!buscarIngrediente) return;

  const sugerencias = obtenerElemento('sugerencias');
  const ingredientesElegidos = obtenerElemento('ingredientesElegidos');
  const modalFiltros = obtenerElemento('modalFiltros');
  const modalReceta = obtenerElemento('modalReceta');
  const detalleReceta = obtenerElemento('detalleReceta');
  const pedirFaltantes = obtenerElemento('pedirFaltantes');
  const usarDespensa = obtenerElemento('usarDespensa');
  const botonGenerar = obtenerElemento('generarRecetas');
  const botonCancelarGeneracion = obtenerElemento('cancelarGeneracion');
  const estadoGeneracion = obtenerElemento('estadoGeneracion');
  let elegidos = [];
  let tiempo = '30 min';
  let porciones = '2';
  let dificultad = 'Todas';
  let recetasActuales = [];
  let generacionActiva = null;
  let secuenciaGeneraciones = 0;
  const pintarIngredientes = () => {
    ingredientesElegidos.innerHTML = elegidos.map((ingrediente, indice) => `
      <span class="chip-ingrediente">
        ${ingrediente}
        <button type="button" onclick="quitarIngrediente(${indice})">×</button>
      </span>
    `).join('');
  };

  const sugerirIngredientes = (texto, destino, funcion) => {
    const coincidencias = ingredientesDisponibles.filter(ingrediente => (
      ingrediente.includes(texto.toLowerCase()) &&
      !elegidos.includes(ingrediente)
    ));

    destino.innerHTML = texto
      ? coincidencias.map(ingrediente => (
        `<button type="button" class="sugerencia" onclick="${funcion}('${ingrediente}')">+ ${ingrediente}</button>`
      )).join('')
      : '';
  };

  const pintarOpciones = (id, valores, actual, cambiar) => {
    const contenedor = obtenerElemento(id);
    contenedor.innerHTML = valores.map(valor => `
      <button class="filtro-opcion ${valor === actual ? 'seleccionada' : ''}" data-v="${valor}">
        ${valor}
      </button>
    `).join('');

    [...contenedor.children].forEach(boton => {
      boton.onclick = () => {
        [...contenedor.children].forEach(opcion => opcion.classList.remove('seleccionada'));
        boton.classList.add('seleccionada');
        cambiar(boton.dataset.v);
      };
    });
  };

  const ingredientesParaReceta = async signal => {
    if (!usarDespensa?.checked) return [...elegidos];

    const respuesta = await fetch('/api/despensa', { signal, credentials: 'same-origin', cache: 'no-store' });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !datos.ok || !Array.isArray(datos.ingredientes)) {
      throw new Error(datos.mensaje || 'No se pudo obtener tu despensa.');
    }

    const combinados = [...elegidos, ...datos.ingredientes.map(item => item.ingrediente)];
    return [...new Map(combinados.map(nombre => [nombre.trim().toLocaleLowerCase('es-CL'), nombre])).values()];
  };

  const comprasEnProceso = new Set();
  const escaparFaltante = texto => String(texto ?? '').replace(/[&<>"']/g, caracter => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caracter]);
  const cargarFaltantes = async (receta, signal) => {
    if (!idRecetaValido(receta)) return { ...receta, ingredientesFaltantes: [], faltantesCompra: [] };
    const respuesta = await fetch('/api/lista-compra/faltantes/calcular', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ idReceta: Number(receta.idReceta), ...receta.contextoCompras })
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudieron calcular los ingredientes faltantes.');
    return { ...receta, faltantesCompra: datos.faltantes, ingredientesFaltantes: datos.faltantes.map(item =>
      item.cantidad == null ? `${item.ingrediente} (cantidad por verificar)` : `${item.cantidad} ${item.abreviatura || item.unidad} de ${item.ingrediente}`) };
  };

  const esFavorita = receta => idRecetaValido(receta) && favoritos().some(item => Number(item.idReceta) === Number(receta.idReceta));
  const mensajeSinRecetas = '<p class="sin-resultados">No Hay Recetas generadas</p>';

  const abrirReceta = indice => {
    const receta = recetasActuales[indice];
    if (!receta) return;
    if (idRecetaValido(receta)) {
      fetch('/api/historial/recetas-vistas', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          idReceta: Number(receta.idReceta),
          idBusqueda: receta.idBusqueda ?? null
        }),
        keepalive: true
      }).then(respuesta => {
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      }).catch(error => {
        console.error('No se pudo registrar la receta vista en MySQL:', error);
        mostrarNotificacionCookIQ('La receta se abrió, pero no pudimos registrar esta visita en tu historial.', 'advertencia');
      });
    }
    const historial = leer('miCocinaHistorialRecetas');
    const tiempoReceta = receta.minutosPreparacion ?? receta.tiempo ?? tiempo;
    const porcionesReceta = receta.porciones ?? porciones;
    if (!esPropuestaPendiente(receta)) {
      historial.unshift({ ...receta, tiempo: tiempoReceta, porciones: porcionesReceta });
      guardar('miCocinaHistorialRecetas', historial.slice(0, 30));
    }
    detalleReceta.innerHTML = `
      <button class="modal-cerrar" onclick="modalReceta.classList.remove('abierto')">Cerrar</button>
      ${renderizarDetalleReceta({ ...receta, tiempo: tiempoReceta, porciones: porcionesReceta })}
    `;
    modalReceta.classList.add('abierto');

    window.CookIQResenas.montar(detalleReceta, receta.idReceta);
  };

  
const renderizarRecetas = () => recetasActuales.map((receta, indice) => `
  <article class="receta-card">
    <div class="receta-imagen">
      ${obtenerImagenReceta(receta)
        ? `<img class="receta-foto" src="${obtenerImagenReceta(receta)}" alt="${receta.imagen?.alt || receta.nombre}" onerror="this.remove()">`
        : '<span class="receta-placeholder" aria-hidden="true">🍽️</span>'}
      <button
        type="button"
        class="favorito-corazon ${esFavorita(receta) ? 'activo' : ''}"
        onclick="toggleFavorito(${indice})"
        ${!idRecetaValido(receta) || estadoCargaFavoritos !== 'listo' || favoritosEnProceso.has(Number(receta.idReceta)) ? 'disabled' : ''}
        title="${!idRecetaValido(receta) ? 'Esta receta no quedó guardada y no se puede marcar como favorita.' : estadoCargaFavoritos !== 'listo' ? 'Los favoritos aún no están disponibles.' : 'Cambiar favorito'}"
      >
        ${esFavorita(receta) ? '♥' : '♡'}
      </button>
    </div>

    <div class="receta-cuerpo">
      <h3>${receta.nombre}</h3>
      ${renderizarAdvertenciaAlimentaria(receta)}
      <p>${receta.descripcion || 'Receta generada por CookIQ.'}</p>
      ${obtenerCreditoImagen(receta)}

      <div class="receta-datos">
        <span>◷ ${receta.minutosPreparacion} min</span>
        <span>🍽 ${receta.porciones} porciones</span>
        <span>⚑ ${receta.dificultad}</span>
      </div>

      ${
        pedirFaltantes.checked &&
        receta.ingredientesFaltantes?.length
          ? `<div class="faltantes-lista">
              <b>Ingredientes faltantes:</b>
              ${receta.ingredientesFaltantes.map(escaparFaltante).join(', ')}
              ${(receta.faltantesCompra || []).some(item => item.cantidad == null)
                ? `<p>${[...new Set(receta.faltantesCompra.filter(item => item.cantidad == null).map(item => item.motivo))].map(escaparFaltante).join(' ')}</p>` : ''}
              <button type="button" class="boton-generar" onclick="agregarCompras(${indice})" ${comprasEnProceso.has(Number(receta.idReceta)) ? 'disabled' : ''}>Agregar faltantes a mi lista de compras ${obtenerElemento('indicadorFaltantesMasterChef')?.innerHTML || ''}</button>
            </div>`
          : ''
      }

      <button
        type="button"
        class="boton-ver"
        onclick="abrirReceta(${indice})"
      >
        Ver receta completa
      </button>
    </div>
  </article>
`);

  
const confirmarIntolerancias = (nombres, signal) => new Promise(resolve => {
  const dialogo = document.createElement('dialog');
  dialogo.className = 'favorito-dialogo';
  dialogo.setAttribute('aria-labelledby', 'tituloAdvertenciaIntolerancia');
  dialogo.innerHTML = `
    <h2 id="tituloAdvertenciaIntolerancia">Advertencia de intolerancia alimentaria</h2>
    <button type="button" class="modal-cerrar" data-cancelar-advertencia aria-label="Cancelar generación y cerrar advertencia">Cerrar</button>
    <p>Detectamos que uno o más ingredientes seleccionados pueden contener sustancias a las que tienes intolerancia.</p>
    <p data-ingredientes-advertidos></p>
    <p>¿Quieres continuar con estos ingredientes o prefieres generar recetas evitando tu intolerancia?</p>
    <div class="favorito-dialogo-acciones" style="flex-wrap: wrap">
      <button type="button" data-evitar>Evitar ingredientes</button>
      <button type="button" class="favorito-dialogo-confirmar" data-continuar>Continuar igualmente</button>
    </div>`;
  dialogo.querySelector('[data-ingredientes-advertidos]').textContent = `Ingredientes detectados: ${nombres.join(', ')}.`;
  let terminado = false;
  const cerrar = accion => {
    if (terminado) return;
    terminado = true;
    signal.removeEventListener('abort', abortar);
    dialogo.close();
    dialogo.remove();
    resolve(accion);
  };
  const abortar = () => cerrar(null);
  dialogo.querySelector('[data-evitar]').onclick = () => cerrar('evitar');
  dialogo.querySelector('[data-cancelar-advertencia]').onclick = () => cerrar(null);
  dialogo.querySelector('[data-continuar]').onclick = () => cerrar('continuar');
  dialogo.addEventListener('cancel', evento => { evento.preventDefault(); cerrar(null); });
  document.body.append(dialogo);
  dialogo.showModal();
  dialogo.querySelector('[data-evitar]').focus();
  signal.addEventListener('abort', abortar, { once: true });
  if (signal.aborted) abortar();
});

// Los avisos de generacion quedan solo en consola, sin toast ni cola persistente.
const registrarAvisoGeneracion = (texto, tipo = 'info') => {
  if (texto) console.info('[Generacion: aviso no mostrado]', { tipo, mensaje: mensajePublicoGeneracion(texto) });
};

const generarRecetas = async (registrar = true) => {
  const entrada = buscarIngrediente.value.trim();
  const usarDespensaEnGeneracion = Boolean(usarDespensa?.checked);

  // Evita consultar la despensa si no hay ningún dato y la opción está desactivada.
  if (!entrada && elegidos.length === 0 && !usarDespensa?.checked) {
    registrarAvisoGeneracion('Escribe qué quieres cocinar o selecciona ingredientes.', 'advertencia');
    buscarIngrediente.focus();
    return;
  }

  // Convierte el filtro de tiempo a minutos para enviarlo al backend.
  const tiemposEnMinutos = {
    '10 min': 10,
    '20 min': 20,
    '30 min': 30,
    '50 min': 50,
    '1 hora': 60,
    'Más de 2 horas': 180
  };

  const tiempoMaximo = tiemposEnMinutos[tiempo] || 30;

  // Recupera las restricciones guardadas localmente.
  // Más adelante el backend debe verificarlas directamente en MySQL.
  const perfil = obtenerPerfilActivo() || {};

  const textoOriginal = botonGenerar?.textContent;
  const generacion = {
    id: ++secuenciaGeneraciones,
    claveIdempotencia: crypto.randomUUID(),
    controlador: new AbortController()
  };
  generacionActiva = generacion;

  if (botonGenerar) {
    botonGenerar.disabled = true;
    botonGenerar.textContent = 'Generando recetas...';
  }
  if (botonCancelarGeneracion) {
    botonCancelarGeneracion.hidden = false;
    botonCancelarGeneracion.disabled = false;
  }
  if (estadoGeneracion) {
    estadoGeneracion.textContent = 'Generando recetas...';
    estadoGeneracion.hidden = false;
  }

  try {
    let ingredientes = await ingredientesParaReceta(generacion.controlador.signal);
    if (generacion.controlador.signal.aborted || generacionActiva !== generacion) return;

    if (!entrada && ingredientes.length === 0) {
      registrarAvisoGeneracion('Tu despensa está vacía. Agrega ingredientes o escribe una búsqueda.', 'advertencia');
      if (estadoGeneracion) estadoGeneracion.hidden = true;
      return;
    }

    const seleccionActual = () => JSON.stringify({ consulta: buscarIngrediente.value.trim(), ingredientes: [...elegidos],
      usarDespensa: Boolean(usarDespensa?.checked), tiempo, porciones, dificultad, pedirFaltantes: pedirFaltantes.checked });
    const seleccionInicial = seleccionActual();
    const solicitudGeneracion = {
      consulta: entrada, ingredientes: [...elegidos], usarDespensa: usarDespensaEnGeneracion,
      tiempoMaximo, porciones: Number(porciones), dificultad, pedirFaltantes: pedirFaltantes.checked,
      alergias: perfil.alergias || [], intolerancias: perfil.intolerancias || []
    };
    const enviarGeneracion = confirmacionIntolerancia => fetch('/generar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': generacion.claveIdempotencia
      },
      signal: generacion.controlador.signal,
      body: JSON.stringify({ ...solicitudGeneracion, ...(confirmacionIntolerancia ? { confirmacionIntolerancia } : {}) })
    });
    let respuesta = await enviarGeneracion();
    if (generacion.controlador.signal.aborted || generacionActiva !== generacion) return;

    let textoRespuesta = await respuesta.text();
    if (generacion.controlador.signal.aborted || generacionActiva !== generacion) return;

    let datos;
    try {
      datos = JSON.parse(textoRespuesta);
    } catch (error) {
      console.error('El servidor devolvió una respuesta que no es JSON.', error);
      throw new Error('No pudimos obtener una respuesta del servidor. Inténtalo nuevamente.');
    }

    while (respuesta.status === 409 && datos.code === 'INTOLERANCIA_CONFIRMACION_REQUERIDA') {
      if (estadoGeneracion) estadoGeneracion.textContent = 'Esperando tu decisión sobre los ingredientes.';
      const accion = await confirmarIntolerancias(datos.ingredientes, generacion.controlador.signal);
      if (!accion || generacion.controlador.signal.aborted || generacionActiva !== generacion) {
        if (!generacion.controlador.signal.aborted && generacionActiva === generacion) {
          if (estadoGeneracion) estadoGeneracion.hidden = true;
          registrarAvisoGeneracion('Generación cancelada. ¿Qué te gustaría cocinar ahora?', 'info');
        }
        return;
      }
      if (seleccionActual() !== seleccionInicial) {
        throw new Error('Cambiaste los ingredientes o filtros. Pulsa Generar recetas para verificar la nueva selección.');
      }
      if (estadoGeneracion) estadoGeneracion.textContent = 'Generando recetas...';
      respuesta = await enviarGeneracion({ token: datos.token, accion });
      textoRespuesta = await respuesta.text();
      datos = JSON.parse(textoRespuesta);
    }

    if (!respuesta.ok || !datos.ok) {
      if (datos.code?.startsWith('SUSCRIPCION_')) mostrarNotificacionCookIQ(datos.mensaje, 'advertencia');
      throw Object.assign(new Error(mensajePublicoGeneracion(mensajeGeneracion(datos)) || 'No se pudieron generar las recetas.'), {
        tipoNotificacion: datos.code?.startsWith('SEGURIDAD_') || datos.code === 'GENERACION_SIN_RESULTADOS' ? 'advertencia' : 'error'
      });
    }

    if (generacion.controlador.signal.aborted || generacionActiva !== generacion) return;

    const avisoGeneracion = mensajePublicoGeneracion(mensajeGeneracion(datos));
    if (avisoGeneracion) {
      const incompatibilidadConfirmada = [datos.ingredientesExcluidos, datos.problemasRecetas]
        .some(elementos => Array.isArray(elementos) && elementos.some(item => item.estado === 'incompatible'));
      registrarAvisoGeneracion(avisoGeneracion, incompatibilidadConfirmada || datos.advertencia || datos.advertenciaHistorial ? 'advertencia' : 'info');
    }
    else if (!datos.recetas?.length) registrarAvisoGeneracion('No se encontraron recetas compatibles. Prueba con otros ingredientes.', 'advertencia');
    if (Array.isArray(datos.ingredientesUtilizados)) ingredientes = datos.ingredientesUtilizados;

    // Guardamos las recetas reales devueltas por OpenAI.
    const idBusqueda = Number.isInteger(Number(datos.idBusqueda)) && Number(datos.idBusqueda) > 0
      ? Number(datos.idBusqueda)
      : null;
    const candidatasCompras = datos.recetas.map(receta => ({ ...receta, idBusqueda,
      contextoCompras: { usarDespensa: usarDespensaEnGeneracion, ingredientesManuales: [...solicitudGeneracion.ingredientes] },
      ingredientesFaltantes: [], faltantesCompra: [] }));
    let preparadas = candidatasCompras;
    if (pedirFaltantes.checked && document.querySelector('.inicio-sidebar')?.dataset.masterchef === 'true') {
      try { preparadas = await Promise.all(candidatasCompras.map(receta => cargarFaltantes(receta, generacion.controlador.signal))); }
      catch (error) {
        if (generacion.controlador.signal.aborted) return;
        registrarAvisoGeneracion(error.message || 'Las recetas se generaron, pero no se pudieron calcular los faltantes.', 'advertencia');
      }
    }
    if (generacion.controlador.signal.aborted || generacionActiva !== generacion) return;
    recetasActuales = preparadas;

    guardar('miCocinaRecetasGeneradas', {
      recetas: recetasActuales,
      consulta: entrada,
      ingredientes,
      tiempo,
      porciones,
      dificultad,
      pedirFaltantes: pedirFaltantes.checked
    });

    if (registrar) {
      const historial = leer('miCocinaHistorialBusquedas');

      historial.unshift({
        ingredientes: [
          ...(entrada ? [entrada] : []),
          ...ingredientes
        ],
        fecha: new Date().toLocaleString('es-CL')
      });

      guardar('miCocinaHistorialBusquedas', historial.slice(0, 30));
    }

    obtenerElemento('recetas').innerHTML =
      renderizarRecetas().join('') ||
      '<p class="sin-resultados">No se encontraron recetas. Prueba con otros ingredientes.</p>';
    if (estadoGeneracion) estadoGeneracion.hidden = true;

  } catch (error) {
    if (generacion.controlador.signal.aborted || generacionActiva !== generacion || error.name === 'AbortError') return;
    console.error('Error al generar recetas:', error);
    if (estadoGeneracion) estadoGeneracion.hidden = true;
    registrarAvisoGeneracion(error instanceof TypeError ? 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.'
      : error instanceof SyntaxError ? 'No pudimos interpretar la respuesta del servidor. Inténtalo nuevamente.'
      : mensajePublicoGeneracion(error.message) || 'Ocurrió un error al generar las recetas.', error.tipoNotificacion || 'error');
  } finally {
    if (generacionActiva === generacion) {
      generacionActiva = null;
      if (botonGenerar) {
        botonGenerar.disabled = false;
        botonGenerar.textContent = textoOriginal || '✨ Generar recetas';
      }
      if (botonCancelarGeneracion) {
        botonCancelarGeneracion.hidden = true;
        botonCancelarGeneracion.disabled = true;
      }
    }
  }
};

if (botonCancelarGeneracion) botonCancelarGeneracion.onclick = () => {
  if (!generacionActiva) return;

  const generacion = generacionActiva;
  generacionActiva = null;
  generacion.controlador.abort();
  if (botonGenerar) {
    botonGenerar.disabled = false;
    botonGenerar.textContent = '✨ Generar recetas';
  }
  if (botonCancelarGeneracion) {
    botonCancelarGeneracion.hidden = true;
    botonCancelarGeneracion.disabled = true;
  }
  if (estadoGeneracion) {
    estadoGeneracion.textContent = 'Generación cancelada. ¿Qué te gustaría cocinar ahora?';
    estadoGeneracion.hidden = true;
  }
  registrarAvisoGeneracion('Generación cancelada. ¿Qué te gustaría cocinar ahora?', 'info');
};

  
const cargarRecetasGeneradas = () => {
  const resultadosGuardados = leer('miCocinaRecetasGeneradas', null);

  if (!resultadosGuardados || !Array.isArray(resultadosGuardados.recetas)) {
    recetasActuales = [];
    obtenerElemento('recetas').innerHTML = mensajeSinRecetas;
    return;
  }

  tiempo = resultadosGuardados.tiempo || tiempo;
  porciones = resultadosGuardados.porciones || porciones;
  dificultad = resultadosGuardados.dificultad || dificultad;

  [['tiempos', tiempo], ['porciones', porciones], ['dificultad', dificultad]].forEach(([id, valor]) => {
    obtenerElemento(id)?.querySelectorAll('.filtro-opcion').forEach(opcion => {
      opcion.classList.toggle('seleccionada', opcion.dataset.v === String(valor));
    });
  });

  pedirFaltantes.checked = Boolean(resultadosGuardados.pedirFaltantes);

  const ingredientesGuardados = Array.isArray(resultadosGuardados.ingredientes)
    ? resultadosGuardados.ingredientes
    : [];
  recetasActuales = resultadosGuardados.recetas.map(receta => ({ ...receta,
    contextoCompras: receta.contextoCompras || { usarDespensa: false, ingredientesManuales: ingredientesGuardados },
    ingredientesFaltantes: receta.contextoCompras ? (receta.ingredientesFaltantes || []) : [],
    faltantesCompra: receta.contextoCompras ? (receta.faltantesCompra || []) : []
  }));

  obtenerElemento('recetas').innerHTML =
    renderizarRecetas().join('') || mensajeSinRecetas;
};

  buscarIngrediente.oninput = evento => sugerirIngredientes(evento.target.value, sugerencias, 'agregarIngrediente');
  obtenerElemento('abrirFiltros').onclick = () => modalFiltros.classList.add('abierto');
  obtenerElemento('formBusqueda').onsubmit = evento => {
    evento.preventDefault();
    generarRecetas(true);
  };

  window.agregarIngrediente = ingrediente => {
    if (!elegidos.includes(ingrediente)) elegidos.push(ingrediente);
    buscarIngrediente.value = '';
    sugerencias.innerHTML = '';
    pintarIngredientes();
  };

  window.quitarIngrediente = indice => {
    elegidos.splice(indice, 1);
    pintarIngredientes();
  };

  window.toggleFavorito = async indice => {
    const receta = recetasActuales[indice];
    if (!receta || !idRecetaValido(receta) || estadoCargaFavoritos !== 'listo') return;
    const idReceta = Number(receta.idReceta);
    if (favoritosEnProceso.has(idReceta)) return;
    const operacion = alternarFavoritoEnApi(receta);
    obtenerElemento('recetas').innerHTML = renderizarRecetas().join('') || mensajeSinRecetas;
    try {
      const agregado = await operacion;
      mostrarAvisoFavoritos(agregado ? 'Receta guardada en favoritos' : 'Receta eliminada de favoritos');
    } catch (error) {
      alert(error.status === 401 ? 'Debes iniciar sesión para usar favoritos.' : error.message || 'No se pudo actualizar el favorito.');
    } finally {
      obtenerElemento('recetas').innerHTML = renderizarRecetas().join('') || mensajeSinRecetas;
    }
  };

  window.agregarCompras = async indice => {
    const receta = recetasActuales[indice];
    if (!pedirFaltantes.checked || !receta || !idRecetaValido(receta) || comprasEnProceso.has(Number(receta.idReceta))) return;
    const id = Number(receta.idReceta);
    comprasEnProceso.add(id);
    obtenerElemento('recetas').innerHTML = renderizarRecetas().join('') || mensajeSinRecetas;
    try {
      const resultado = await solicitarApiListaCompras('/api/lista-compra/faltantes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idReceta: id, ...receta.contextoCompras })
      });
      const sinCantidad = resultado.faltantes.filter(item => item.cantidad == null);
      const resumen = [];
      if (resultado.agregados) resumen.push(`${resultado.agregados} ingredientes añadidos a tu lista de compras.`);
      if (resultado.reactivados) resumen.push(`${resultado.reactivados} volvieron a pendientes porque estaban marcados como comprados.`);
      if (resultado.duplicados) resumen.push(`${resultado.duplicados} ya están pendientes en tu lista; se conservó su cantidad sin duplicarlos.`);
      if (!resultado.faltantes.length) resumen.push('No hay ingredientes faltantes para agregar.');
      if (sinCantidad.length) resumen.push('Hay cantidades no verificables: complétalas en Mi lista de compras.');
      mostrarNotificacionCookIQ(resumen.join(' '), sinCantidad.length ? 'advertencia' : resultado.agregados ? 'exito' : 'info');
    } catch (error) { mostrarNotificacionCookIQ(error.message || 'No se pudieron guardar los faltantes.', 'error'); }
    finally {
      comprasEnProceso.delete(id);
      obtenerElemento('recetas').innerHTML = renderizarRecetas().join('') || mensajeSinRecetas;
    }
  };
  let revisionFaltantes = 0;
  pedirFaltantes.addEventListener('change', async () => {
    const revision = ++revisionFaltantes;
    obtenerElemento('recetas').innerHTML = renderizarRecetas().join('') || mensajeSinRecetas;
    if (!pedirFaltantes.checked) return;
    const actuales = recetasActuales;
    try {
      const calculadas = await Promise.all(actuales.map(receta => cargarFaltantes(receta)));
      if (revision !== revisionFaltantes || actuales !== recetasActuales) return;
      recetasActuales = calculadas;
      obtenerElemento('recetas').innerHTML = renderizarRecetas().join('') || mensajeSinRecetas;
    } catch (error) { mostrarNotificacionCookIQ(error.message, 'error'); }
  });

  window.abrirReceta = abrirReceta;
  pintarOpciones('tiempos', ['10 min', '20 min', '30 min', '50 min', '1 hora', 'Más de 2 horas'], tiempo, valor => { tiempo = valor; });
  pintarOpciones('porciones', ['2', '4', '6', '8', '10'], porciones, valor => { porciones = valor; });
  pintarOpciones('dificultad', ['Todas', 'Fácil', 'Medio', 'Difícil'], dificultad, valor => { dificultad = valor; });
  document.querySelectorAll('[data-cerrar]').forEach(boton => {
    boton.onclick = () => obtenerElemento(boton.dataset.cerrar).classList.remove('abierto');
  });
  cargarRecetasGeneradas();
  cargarFavoritosDesdeApi()
    .then(() => {
      obtenerElemento('recetas').innerHTML = renderizarRecetas().join('') || mensajeSinRecetas;
    })
    .catch(error => {
      obtenerElemento('recetas').innerHTML = renderizarRecetas().join('') || mensajeSinRecetas;
      alert(error.status === 401 ? 'Debes iniciar sesión para cargar tus favoritos.' : error.message || 'No se pudieron cargar los favoritos.');
    });
};

// ============================================================================
// PANTALLA DE FAVORITOS
// Muestra las recetas guardadas y permite quitarlas de la lista.
// ============================================================================

const iniciarFavoritos = () => {
  const listaFavoritos = obtenerElemento('listaFavoritos');
  if (!listaFavoritos) return;

  const pintar = () => {
    const lista = favoritos();
    listaFavoritos.innerHTML = lista.length ? lista.map(receta => `
      <article class="receta-card">
        <div class="receta-imagen">
          ${obtenerImagenReceta(receta)
            ? `<img class="receta-foto" src="${obtenerImagenReceta(receta)}" alt="${receta.imagen?.alt || receta.nombre}" onerror="this.remove()">`
            : `<span class="receta-placeholder" aria-hidden="true">${receta.icono || '🍽️'}</span>`}
          <button type="button" class="favorito-corazon activo" onclick="quitarFavorito(${Number(receta.idReceta)})" ${favoritosEnProceso.has(Number(receta.idReceta)) ? 'disabled' : ''} aria-label="Quitar de favoritos">♥</button>
        </div>
        <div class="receta-cuerpo">
          <h3>${receta.nombre}</h3>
          <p>${receta.descripcion}</p>
          ${obtenerCreditoImagen(receta)}
          <div class="receta-datos">◷ ${receta.tiempo} · 🍽 ${receta.porciones} porciones</div>
          <button type="button" class="boton-ver" onclick="abrirDetalleFavorito(${Number(receta.idReceta)})">Ver receta</button>
        </div>
      </article>
    `).join('') : '<p class="sin-resultados">Aún no tienes recetas favoritas.</p>';
  };

  window.quitarFavorito = async idReceta => {
    const id = Number(idReceta);
    if (!Number.isSafeInteger(id) || id < 1 || favoritosEnProceso.has(id)) return;
    favoritosEnProceso.add(id);
    pintar();
    try {
      const confirmado = await confirmarQuitarFavorito();
      if (!confirmado) return;
      await solicitarApiFavoritos(`/api/favoritos/${id}`, { method: 'DELETE' });
      favoritosConfirmados = favoritos().filter(receta => Number(receta.idReceta) !== id);
      pintar();
      mostrarAvisoFavoritos('Receta eliminada de favoritos');
    } catch (error) {
      alert(error.status === 401 ? 'Debes iniciar sesión para quitar favoritos.' : error.message || 'No se pudo quitar el favorito.');
    } finally {
      favoritosEnProceso.delete(id);
      pintar();
    }
  };

  const modalReceta = obtenerElemento('modalReceta');
  const detalleReceta = obtenerElemento('detalleReceta');
  window.abrirDetalleFavorito = idReceta => {
    const receta = favoritos().find(item => Number(item.idReceta) === Number(idReceta));
    if (!receta || !modalReceta || !detalleReceta) return;
    detalleReceta.innerHTML = `<button type="button" class="modal-cerrar" id="cerrarDetalleFavorito">Cerrar</button>${renderizarDetalleReceta(receta, { formatearCantidades: true })}`;
    obtenerElemento('cerrarDetalleFavorito').onclick = () => modalReceta.classList.remove('abierto');
    modalReceta.classList.add('abierto');
    window.CookIQResenas.montar(detalleReceta, receta.idReceta);
  };

  listaFavoritos.innerHTML = '<p class="sin-resultados">Cargando favoritos…</p>';
  cargarFavoritosDesdeApi()
    .then(pintar)
    .catch(error => {
      listaFavoritos.innerHTML = `<p class="sin-resultados" role="alert">${error.status === 401 ? 'Debes iniciar sesión para consultar tus favoritos.' : 'No se pudieron cargar los favoritos. Inténtalo nuevamente.'}</p>`;
    });
};

// ============================================================================
// PANTALLA DE HISTORIAL
// Presenta búsquedas y recetas vistas, con opción de limpiar todo.
// ============================================================================

const iniciarHistorial = () => {
  const historialBusquedas = obtenerElemento('historialBusquedas');
  const historialRecetas = obtenerElemento('historialRecetas');
  if (!historialBusquedas || !historialRecetas) return;

  const modal = obtenerElemento('modalHistorial');
  const detalle = obtenerElemento('detalleHistorial');
  let busquedasMySQL = null;
  let eliminandoHistorial = false;
  let errorBusquedas = '';
  let recetasVistasMySQL = null;
  let errorRecetasVistas = '';

  const escaparHtml = valor => String(valor ?? '').replace(/[&<>"']/g, caracter => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[caracter]);

  const formatearFechaBusqueda = valor => {
    if (!valor) return 'Fecha no disponible';
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime())
      ? 'Fecha no disponible'
      : fecha.toLocaleString('es-CL');
  };

  const pintar = () => {
    const recetas = recetasVistasMySQL || [];
    if (errorBusquedas) {
      historialBusquedas.innerHTML = `<p class="sin-resultados">${escaparHtml(errorBusquedas)}</p>`;
    } else if (busquedasMySQL === null) {
      historialBusquedas.innerHTML = '<p class="sin-resultados">Cargando búsquedas...</p>';
    } else {
      historialBusquedas.innerHTML = busquedasMySQL.length
        ? busquedasMySQL.map(busqueda => {
          const filtros = [
            busqueda.dificultad && `Dificultad: ${busqueda.dificultad}`,
            busqueda.minutos_maximos !== null && busqueda.minutos_maximos !== undefined && `Máximo: ${busqueda.minutos_maximos} min`,
            busqueda.cantidad_porciones !== null && busqueda.cantidad_porciones !== undefined && `Porciones: ${busqueda.cantidad_porciones}`
          ].filter(Boolean);
          const texto = busqueda.texto_busqueda || 'Búsqueda sin texto';

          return `<div class="historial-item" data-id-busqueda="${escaparHtml(busqueda.id_busqueda)}">
            <b>${escaparHtml(texto)}</b>
            <small>${escaparHtml(formatearFechaBusqueda(busqueda.fecha_busqueda))}</small>
            ${filtros.length ? `<small>${escaparHtml(filtros.join(' · '))}</small>` : ''}
            <button type="button" data-eliminar-busqueda="${escaparHtml(busqueda.id_busqueda)}" aria-label="Eliminar búsqueda">Eliminar</button>
          </div>`;
        }).join('')
        : '<p class="sin-resultados">Todavía no hay búsquedas guardadas.</p>';
    }

    historialRecetas.innerHTML = errorRecetasVistas
      ? `<p class="sin-resultados">${escaparHtml(errorRecetasVistas)}</p>`
      : recetasVistasMySQL === null
      ? '<p class="sin-resultados">Cargando recetas vistas...</p>'
      : recetas.length
      ? recetas.map((receta, indice) => `
        <article class="receta-card tarjeta-clickable" data-id-historial="${escaparHtml(receta.id_historial)}" onclick="abrirHistorialReceta(${indice})">
          <div class="receta-imagen">
            ${obtenerImagenReceta(receta)
              ? `<img class="receta-foto" src="${escaparHtml(obtenerImagenReceta(receta))}" alt="${escaparHtml(receta.nombre)}" onerror="this.remove()">`
              : '<span class="receta-placeholder" aria-hidden="true">🍽️</span>'}
            ${Number.isSafeInteger(Number(receta.id_receta)) && Number(receta.id_receta) > 0
              ? `<button type="button" class="favorito-corazon ${estadoCargaFavoritos === 'listo' && favoritos().some(item => Number(item.idReceta) === Number(receta.id_receta)) ? 'activo' : ''}" data-favorito-receta="${escaparHtml(receta.id_receta)}" aria-label="${estadoCargaFavoritos === 'listo' && favoritos().some(item => Number(item.idReceta) === Number(receta.id_receta)) ? 'Quitar de favoritos' : 'Agregar a favoritos'}" title="${estadoCargaFavoritos === 'listo' && favoritos().some(item => Number(item.idReceta) === Number(receta.id_receta)) ? 'Quitar de favoritos' : 'Agregar a favoritos'}" ${estadoCargaFavoritos !== 'listo' || favoritosEnProceso.has(Number(receta.id_receta)) ? 'disabled' : ''}>${estadoCargaFavoritos === 'listo' && favoritos().some(item => Number(item.idReceta) === Number(receta.id_receta)) ? '♥' : '♡'}</button>`
              : ''}
          </div>
          <div class="receta-cuerpo">
            <h3>${escaparHtml(receta.nombre)}</h3>
            <p>${escaparHtml(receta.descripcion || 'Receta guardada en tu historial.')}</p>
            <div class="receta-datos">◷ ${escaparHtml(receta.tiempo)} min · 🍽 ${escaparHtml(receta.porciones)} porciones</div>
            <button class="boton-ver" type="button">Abrir receta</button>
            <button class="boton-ver" type="button" data-eliminar-receta-vista="${escaparHtml(receta.id_historial)}">Quitar del historial</button>
          </div>
        </article>
      `).join('')
      : '<p class="sin-resultados">Abre una receta para verla aquí.</p>';
  };

  window.abrirHistorialReceta = indice => {
    const receta = recetasVistasMySQL?.[indice];
    if (!receta) return;
    const imagenUrl = obtenerImagenReceta(receta);
    detalle.innerHTML = `
      <button class="modal-cerrar" onclick="modalHistorial.classList.remove('abierto')">Cerrar</button>
      ${imagenUrl ? `<div class="detalle-receta-foto"><img src="${escaparHtml(imagenUrl)}" alt="${escaparHtml(receta.nombre)}" onerror="this.remove()"></div>` : ''}
      <h2>${receta.icono} ${escaparHtml(receta.nombre)}</h2>
      <p>${escaparHtml(receta.descripcion || '')}</p>
      <p><b>Tiempo:</b> ${escaparHtml(receta.tiempo)} min · <b>Porciones:</b> ${escaparHtml(receta.porciones)} · <b>Dificultad:</b> ${escaparHtml(receta.dificultad || 'No especificada')}</p>
      <h3>Ingredientes</h3>
      <ul>${receta.ingredientes.map(ingrediente => {
        const cantidad = ingrediente.cantidad === null || ingrediente.cantidad === undefined
          ? ''
          : String(ingrediente.cantidad).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
        const cantidadYUnidad = [cantidad, ingrediente.unidad].filter(Boolean).join(' ');
        const descripcionIngrediente = ingrediente.indicacion
          ? `${ingrediente.indicacion} ${ingrediente.nombre}`
          : `${cantidadYUnidad}${ingrediente.unidad ? ' de ' : cantidadYUnidad ? ' ' : ''}${ingrediente.nombre}`;
        return `<li>${escaparHtml(descripcionIngrediente)}</li>`;
      }).join('')}</ul>
      <h3>Preparación</h3>
      <ol>${receta.pasos.map(paso => `<li>${escaparHtml(paso)}</li>`).join('')}</ol>
    `;
    modal.classList.add('abierto');
    window.CookIQResenas.montar(detalle, receta.id_receta);
  };

  const cargarBusquedas = async () => {
    try {
      const respuesta = await fetch('/api/historial', {
        headers: { Accept: 'application/json' }
      });

      if (respuesta.status === 401) {
        const datosSesion = await respuesta.json().catch(() => ({}));
        busquedasMySQL = null;
        errorBusquedas = datosSesion.mensaje || 'Inicia sesión para consultar tu historial.';
        pintar();
        return;
      }
      if (!respuesta.ok) {
        throw new Error('No se pudo cargar el historial desde MySQL. Inténtalo nuevamente.');
      }

      const datos = await respuesta.json();
      if (!datos.ok || !Array.isArray(datos.busquedas)) {
        throw new Error('No se pudo cargar el historial desde MySQL. Inténtalo nuevamente.');
      }

      busquedasMySQL = datos.busquedas;
      errorBusquedas = '';
    } catch (error) {
      console.error('No se pudo cargar el historial desde MySQL:', error);
      busquedasMySQL = null;
      errorBusquedas = 'No se pudo cargar el historial desde MySQL. Inténtalo nuevamente.';
    }
    pintar();
  };

  const cargarRecetasVistas = async () => {
    try {
      const respuesta = await fetch('/api/historial/recetas-vistas', {
        headers: { Accept: 'application/json' }
      });
      const datos = await respuesta.json().catch(() => ({}));

      if (respuesta.status === 401) {
        throw new Error(datos.mensaje || 'Inicia sesi\u00f3n para consultar tus recetas vistas.');
      }
      if (!respuesta.ok || !datos.ok || !Array.isArray(datos.recetas)) {
        throw new Error('No se pudieron cargar las recetas vistas desde MySQL. Int\u00e9ntalo nuevamente.');
      }

      recetasVistasMySQL = datos.recetas;
      errorRecetasVistas = '';
    } catch (error) {
      console.error('No se pudieron cargar las recetas vistas desde MySQL:', error);
      recetasVistasMySQL = null;
      errorRecetasVistas = error instanceof TypeError
        ? 'No se pudo conectar con el servidor para cargar las recetas vistas.'
        : error.message || 'No se pudieron cargar las recetas vistas desde MySQL.';
    }
    pintar();
  };

  historialBusquedas.addEventListener('click', async evento => {
    const boton = evento.target.closest('[data-eliminar-busqueda]');
    if (!boton || boton.disabled || eliminandoHistorial) return;
    eliminandoHistorial = true;
    const idBusqueda = boton.dataset.eliminarBusqueda;
    boton.disabled = true;
    try {
      if (!await confirmarAccionCookIQ({ mensaje: '¿Eliminar esta búsqueda? También se eliminarán sus ingredientes y resultados asociados al historial.' })) return;
      const respuesta = await fetch(`/api/historial/busquedas/${encodeURIComponent(idBusqueda)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok || !datos?.ok) {
        throw new Error(datos?.mensaje || 'No se pudo eliminar la búsqueda. Inténtalo nuevamente.');
      }

      busquedasMySQL = busquedasMySQL.filter(busqueda => String(busqueda.id_busqueda) !== idBusqueda);
      pintar();
      mostrarNotificacionCookIQ('Búsqueda eliminada del historial.', 'exito');
    } catch (error) {
      console.error('No se pudo eliminar la búsqueda del historial:', error);
      mostrarNotificacionCookIQ(error instanceof TypeError
        ? 'No se pudo conectar con el servidor para eliminar la búsqueda.'
        : error.message || 'No se pudo eliminar la búsqueda. Inténtalo nuevamente.', 'error');
    } finally {
      boton.disabled = false;
      eliminandoHistorial = false;
    }
  });

  historialRecetas.addEventListener('click', async (evento) => {
    const botonFavorito = evento.target.closest('[data-favorito-receta]');
    if (botonFavorito) {
      evento.preventDefault();
      evento.stopPropagation();
      if (botonFavorito.disabled) return;
      const idReceta = Number(botonFavorito.dataset.favoritoReceta);
      const receta = recetasVistasMySQL?.find(item => Number(item.id_receta) === idReceta);
      if (!receta) return;
      const eraFavorita = favoritos().some(item => Number(item.idReceta) === idReceta);
      const operacion = alternarFavoritoEnApi({ ...receta, idReceta });
      pintar();
      try {
        await operacion;
        mostrarAvisoFavoritos(eraFavorita ? 'Receta eliminada de favoritos' : 'Receta guardada en favoritos');
      } catch (error) {
        window.alert(error.status === 401
          ? 'Debes iniciar sesión para gestionar tus favoritos.'
          : error.message || 'No se pudo actualizar el favorito.');
      } finally {
        pintar();
      }
      return;
    }

    const boton = evento.target.closest('[data-eliminar-receta-vista]');
    if (!boton) return;
    evento.stopPropagation();
    if (boton.disabled || eliminandoHistorial) return;
    eliminandoHistorial = true;

    const idHistorial = boton.dataset.eliminarRecetaVista;
    boton.disabled = true;
    try {
      if (!await confirmarAccionCookIQ({ mensaje: '¿Quitar esta receta vista del historial? La receta original no se eliminará.' })) return;
      const respuesta = await fetch(`/api/historial/recetas-vistas/${encodeURIComponent(idHistorial)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok || !datos?.ok) {
        throw new Error(datos?.mensaje || 'No se pudo quitar la receta del historial. Inténtalo nuevamente.');
      }

      recetasVistasMySQL = recetasVistasMySQL.filter(receta => String(receta.id_historial) !== idHistorial);
      pintar();
      mostrarNotificacionCookIQ('Receta quitada del historial.', 'exito');
    } catch (error) {
      console.error('No se pudo quitar la receta vista del historial:', error);
      mostrarNotificacionCookIQ(error instanceof TypeError
        ? 'No se pudo conectar con el servidor para quitar la receta del historial.'
        : error.message || 'No se pudo quitar la receta del historial. Inténtalo nuevamente.', 'error');
    } finally {
      boton.disabled = false;
      eliminandoHistorial = false;
    }
  }, true);

  const botonLimpiar = obtenerElemento('limpiarHistorial');
  botonLimpiar.onclick = async () => {
    if (botonLimpiar.disabled || eliminandoHistorial) return;
    eliminandoHistorial = true;

    const textoOriginal = botonLimpiar.textContent;
    botonLimpiar.disabled = true;
    botonLimpiar.textContent = 'Limpiando...';

    try {
      if (!await confirmarAccionCookIQ({ mensaje: '¿Estás seguro de que deseas eliminar todo tu historial? Esta acción no se puede deshacer.' })) return;
      const respuesta = await fetch('/api/historial', {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const datos = await respuesta.json().catch(() => null);

      if (!respuesta.ok || !datos?.ok) {
        throw new Error(datos?.mensaje || 'No se pudo borrar el historial. Inténtalo nuevamente.');
      }

      busquedasMySQL = [];
      errorBusquedas = '';
      recetasVistasMySQL = [];
      errorRecetasVistas = '';
      pintar();
      mostrarNotificacionCookIQ('Historial eliminado.', 'exito');
    } catch (error) {
      console.error('No se pudo borrar el historial desde MySQL:', error);
      const mensaje = error instanceof TypeError
        ? 'No se pudo conectar con el servidor para borrar el historial. Inténtalo nuevamente.'
        : error.message || 'No se pudo borrar el historial. Inténtalo nuevamente.';
      mostrarNotificacionCookIQ(mensaje, 'error');
    } finally {
      botonLimpiar.disabled = false;
      botonLimpiar.textContent = textoOriginal;
      eliminandoHistorial = false;
    }
  };

  pintar();
  cargarBusquedas();
  cargarRecetasVistas();
  cargarFavoritosDesdeApi()
    .then(pintar)
    .catch(error => {
      pintar();
      window.alert(error.status === 401
        ? 'Inicia sesión para consultar el estado de tus favoritos.'
        : 'No se pudieron cargar los favoritos. Sus botones estarán disponibles cuando se recupere la conexión.');
    });
};

// ============================================================================
// PANTALLA DE DESPENSA Y LISTA DE COMPRAS
// Administra ingredientes disponibles, compras y sugerencias.
// ============================================================================

const iniciarDespensa = () => {
  const nuevoIngrediente = obtenerElemento('nuevoIngrediente');
  if (!nuevoIngrediente || nuevoIngrediente.dataset.inicializada) return;
  nuevoIngrediente.dataset.inicializada = 'true';
  const cantidadDespensa = obtenerElemento('cantidadDespensa');
  const unidadDespensa = obtenerElemento('unidadDespensa');
  const listaDespensa = obtenerElemento('listaDespensa');
  const sugerencias = obtenerElemento('sugerenciasDespensa');
  const mensaje = obtenerElemento('mensajeDespensa');
  let despensa = [];
  const mostrarMensaje = (texto, esError = false) => {
    if (!mensaje) return;
    mensaje.textContent = texto;
    mensaje.setAttribute('role', esError ? 'alert' : 'status');
  };
  const escaparHtml = texto => String(texto ?? '').replace(/[&<>"']/g, caracter => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[caracter]);

  const solicitarApi = async (url, opciones = {}) => {
    const respuesta = await fetch(url, opciones);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !datos.ok) {
      const error = new Error(datos.mensaje || 'No se pudo completar la operación.');
      error.status = respuesta.status;
      throw error;
    }
    return datos;
  };


  const pintar = () => {
    listaDespensa.innerHTML = despensa.map(item => `
      <span class="chip-ingrediente">
        ${escaparHtml(item.ingrediente)} ${escaparHtml(formatearCantidad(item.cantidad))} ${escaparHtml(item.abreviatura)}
        <button type="button" aria-label="Eliminar ${escaparHtml(item.ingrediente)}" onclick="quitarDespensa(${Number(item.id_ingrediente)})">×</button>
      </span>
    `).join('') || '<p class="sin-resultados">Aún no agregas ingredientes.</p>';
  };
  const cargarDespensa = async () => {
    const datos = await solicitarApi('/api/despensa');
    despensa = Array.isArray(datos.ingredientes) ? datos.ingredientes : [];
    pintar();
  };

  const cantidadValida = valor => {
    const texto = String(valor ?? '').trim();
    if (!/^\d+(?:\.\d{1,3})?$/.test(texto)) return null;
    const numero = Number(texto);
    return Number.isFinite(numero) && numero > 0 && numero <= 9999999.999 ? texto : null;
  };

  obtenerElemento('formDespensa').onsubmit = async evento => {
    evento.preventDefault();
    const nombre = nuevoIngrediente.value.trim();
    const cantidad = cantidadDespensa?.value.trim() || '';
    const idUnidad = unidadDespensa?.value || '';
    if (!nombre || !cantidad || !idUnidad) {
      mostrarMensaje('Completa el nombre, la cantidad y la unidad del ingrediente.', true);
      nuevoIngrediente.focus();
      return;
    }
    if (!cantidadValida(cantidad)) {
      mostrarMensaje('La cantidad debe ser positiva y tener hasta tres decimales.', true);
      cantidadDespensa?.focus();
      return;
    }

    const botonAgregar = obtenerElemento('agregarIngredienteDespensa');
    botonAgregar.disabled = true;
    try {
      const datos = await solicitarApi('/api/despensa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, cantidad, id_unidad: Number(idUnidad) })
      });
      nuevoIngrediente.value = '';
      cantidadDespensa.value = '';
      unidadDespensa.value = '';
      sugerencias.innerHTML = '';
      await cargarDespensa();
      mostrarMensaje(datos.mensaje || 'Ingrediente guardado.');
    } catch (error) {
      mostrarMensaje(error.message || 'No se pudo guardar el ingrediente.', true);
    } finally {
      botonAgregar.disabled = false;
    }
  };

  let eliminandoDespensa = false;
  const bloquearEliminacionDespensa = valor => {
    eliminandoDespensa = valor;
    listaDespensa.querySelectorAll('button').forEach(boton => { boton.disabled = valor; });
    obtenerElemento('limpiarDespensa').disabled = valor;
  };
  obtenerElemento('limpiarDespensa').onclick = async () => {
    if (eliminandoDespensa) return;
    bloquearEliminacionDespensa(true);
    try {
      if (!await confirmarAccionCookIQ({ mensaje: '¿Estás seguro de que deseas eliminar todos los ingredientes de tu despensa?' })) return;
      const datos = await solicitarApi('/api/despensa', { method: 'DELETE' });
      despensa = [];
      pintar();
      mostrarNotificacionCookIQ(datos.mensaje || 'Se vació tu despensa.', 'exito');
    } catch (error) {
      mostrarNotificacionCookIQ(error.message || 'No se pudo vaciar la despensa.', 'error');
    } finally { bloquearEliminacionDespensa(false); }
  };

  window.quitarDespensa = async idIngrediente => {
    const ingrediente = despensa.find(item => Number(item.id_ingrediente) === Number(idIngrediente));
    if (eliminandoDespensa || !ingrediente) return;
    bloquearEliminacionDespensa(true);
    try {
      if (!await confirmarAccionCookIQ({ mensaje: `¿Estás seguro de que deseas eliminar ${ingrediente.ingrediente} de tu despensa?` })) return;
      const datos = await solicitarApi(`/api/despensa/${encodeURIComponent(idIngrediente)}`, { method: 'DELETE' });
      despensa = despensa.filter(item => Number(item.id_ingrediente) !== Number(idIngrediente));
      pintar();
      mostrarNotificacionCookIQ(datos.mensaje || 'Ingrediente eliminado.', 'exito');
    } catch (error) {
      mostrarNotificacionCookIQ(error.message || 'No se pudo eliminar el ingrediente.', 'error');
    } finally { bloquearEliminacionDespensa(false); }
  };

  nuevoIngrediente.oninput = () => {
    const texto = nuevoIngrediente.value.trim().toLowerCase();
    const coincidencias = ingredientesDisponibles.filter(ingrediente => (
      ingrediente.includes(texto) && !despensa.some(item => item.ingrediente.toLowerCase() === ingrediente.toLowerCase())
    ));
    sugerencias.innerHTML = texto
      ? coincidencias.map(ingrediente => `<button type="button" class="sugerencia" data-ingrediente="${escaparHtml(ingrediente)}">+ ${escaparHtml(ingrediente)}</button>`).join('')
      : '';
    sugerencias.querySelectorAll('[data-ingrediente]').forEach(boton => {
      boton.onclick = () => window.elegirSugerenciaDespensa(boton.dataset.ingrediente);
    });
  };

  window.elegirSugerenciaDespensa = ingrediente => {
    nuevoIngrediente.value = `${ingrediente} `;
    sugerencias.innerHTML = '';
    nuevoIngrediente.focus();
  };


  pintar();
  solicitarApi('/api/lista-compra/unidades').then(datos => {
    unidadDespensa.innerHTML = '<option value="">Selecciona una unidad</option>' + datos.unidades.map(unidad =>
      `<option value="${Number(unidad.id_unidad)}">${escaparHtml(unidad.nombre)} (${escaparHtml(unidad.abreviatura)})</option>`).join('');
  }).catch(error => mostrarMensaje(error.message, true));
  const recargar = () => cargarDespensa().catch(error => mostrarMensaje(error.message || 'No se pudo cargar tu despensa.', true));
  window.addEventListener('cookiq:despensa-actualizada', recargar);
  recargar();
};

const iniciarVisibilidadContrasena = () => {
  document.querySelectorAll('.campo-contrasena').forEach(campo => {
    const entrada = campo.querySelector('input[type="password"]');
    const boton = campo.querySelector('.alternar-contrasena');
    if (!entrada || !boton) return;

    boton.addEventListener('click', () => {
      const mostrar = entrada.type === 'password';
      entrada.type = mostrar ? 'text' : 'password';
      boton.setAttribute('aria-pressed', String(mostrar));
      boton.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
      boton.title = mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña';
    });
  });
};

const iniciarLimpiezaContrasenaRegistro = () => {
  const formulario = obtenerElemento('formRegistro');
  const contrasena = obtenerElemento('registroPassword');
  if (!formulario || !contrasena) return;

  formulario.addEventListener('invalid', () => {
    contrasena.value = '';
  }, true);
};

// Cada inicializador detecta si la pantalla actual contiene sus elementos.
// Así un único archivo JavaScript puede compartirse entre todas las vistas.
iniciarSidebar();
iniciarPerfil();
iniciarLobby();
iniciarFavoritos();
iniciarHistorial();
iniciarDespensa();
mostrarFlashServidor();
iniciarVisibilidadContrasena();
iniciarLimpiezaContrasenaRegistro();
// Los formularios clásicos usan sus POST nativos para llegar a las rutas Express y MySQL.

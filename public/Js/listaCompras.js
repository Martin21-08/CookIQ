// Una sola lista persistente. Los respaldos antiguos del navegador no se borran.
(() => {
  const iniciar = () => {
    const contenedor = document.getElementById('listaComprasMysql');
    if (!contenedor || contenedor.dataset.inicializada) return;
    contenedor.dataset.inicializada = 'true';
    const formulario = document.getElementById('formListaCompras');
    const nombre = document.getElementById('nombreCompra');
    const cantidad = document.getElementById('cantidadCompra');
    const unidad = document.getElementById('unidadCompra');
    const limpiar = document.getElementById('limpiarCompras');
    const importar = document.getElementById('importarCompras');
    const estado = document.getElementById('mensajeListaCompras');
    let items = [];
    let listaCargada = false;
    let unidades = [];
    let ocupado = false;
    let claveImportacion = null;
    const avisar = (texto, tipo = 'info') => mostrarNotificacionCookIQ(texto, tipo);
    const escapar = valor => String(valor ?? '').replace(/[&<>"']/g, caracter => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caracter]);
    const formato = valor => valor == null ? '' : String(valor).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    const api = async (ruta = '', metodo = 'GET', cuerpo) => {
      const respuesta = await fetch(`/api/lista-compra${ruta}`, {
        method: metodo, headers: { 'Content-Type': 'application/json' },
        ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) })
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || datos.ok !== true) throw new Error(respuesta.status === 401
        ? 'Inicia sesión para consultar o modificar tu lista.' : datos.mensaje || 'No se pudo consultar o guardar la lista. Intenta nuevamente.');
      return datos;
    };
    const opciones = (familia, id, compacta = false) => `<option value="">${compacta ? 'Unidad' : 'Selecciona una unidad'}</option>` + unidades
      .filter(item => !familia || item.familia === familia)
      .map(item => `<option value="${Number(item.id_unidad)}" ${Number(id) === Number(item.id_unidad) ? 'selected' : ''}>${compacta ? escapar(item.abreviatura || item.nombre) : `${escapar(item.nombre)} (${escapar(item.abreviatura)})`}</option>`).join('');
    const pintar = () => {
      if (!listaCargada) {
        contenedor.innerHTML = '<p class="sin-resultados">Cargando lista de compras…</p>';
        return;
      }
      contenedor.innerHTML = items.map(item => `<article class="historial-item compra-item" data-item="${Number(item.id_item)}">
        <div class="compra-nombre"><b>${escapar(item.ingrediente)}</b>${item.cantidad == null ? '<small>Cantidad por definir</small>' : ''}</div>
        <div class="acciones-despensa">
          <input data-cantidad type="number" min="0.001" max="9999999.999" step="0.001" value="${escapar(formato(item.cantidad))}" placeholder="Cantidad" aria-label="Cantidad de ${escapar(item.ingrediente)}">
          <select data-unidad aria-label="Unidad de ${escapar(item.ingrediente)}">${opciones(item.familia_ingrediente, item.id_unidad, true)}</select>
          <button type="button" data-accion="guardar" title="Guardar cantidad y unidad" aria-label="Guardar cantidad y unidad de ${escapar(item.ingrediente)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2Z M7 3v6h10V3 M7 21v-8h10v8"/></svg></button>
          <button type="button" data-accion="completar" title="Completar y agregar a la despensa" aria-label="Completar compra de ${escapar(item.ingrediente)} y agregar a la despensa"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button>
          <button type="button" data-accion="eliminar" title="Eliminar de la lista" aria-label="Eliminar ${escapar(item.ingrediente)} de la lista"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div></article>`).join('') || '<p class="sin-resultados">Tu lista de compras está vacía.</p>';
      limpiar.disabled = ocupado || !items.length;
    };
    const cargar = async (conservarEdicion = false) => {
      const datos = await api();
      if (!Array.isArray(datos.items)) throw new Error('La respuesta de la lista no tiene el formato esperado.');
      if (conservarEdicion && (ocupado || contenedor.querySelector('.compra-editada'))) return;
      items = datos.items.filter(item => !Number(item.comprado));
      listaCargada = true;
      pintar();
      estado.textContent = '';
    };
    // Al volver desde Cocina, actualizar también una pestaña de Despensa abierta.
    let refrescando = false;
    const refrescarAlVolver = async () => {
      if (!listaCargada || ocupado || refrescando || contenedor.querySelector('.compra-editada')) return;
      refrescando = true;
      try { await cargar(true); }
      catch { avisar('No se pudo actualizar tu lista. Recarga la página para reintentar.', 'advertencia'); }
      finally { refrescando = false; }
    };
    window.addEventListener('focus', refrescarAlVolver);
    window.addEventListener('pageshow', evento => { if (evento.persisted) refrescarAlVolver(); });
    const recargarConfirmada = async () => {
      try { await cargar(); }
      catch { estado.textContent = 'La operación se guardó, pero no se pudo recargar la lista. Recarga la página para verificarla.'; }
    };
    const datosCantidad = (valor, idUnidad) => {
      const texto = valor.trim().replace(',', '.');
      if (!/^\d+(?:\.\d{1,3})?$/.test(texto) || Number(texto) <= 0 || Number(texto) > 9999999.999 || !idUnidad) {
        throw new Error('Indica una cantidad positiva de hasta tres decimales y una unidad válida.');
      }
      return { cantidad: texto, id_unidad: Number(idUnidad) };
    };
    const bloquear = valor => {
      ocupado = valor;
      formulario.querySelectorAll('button').forEach(boton => { boton.disabled = valor; });
      limpiar.disabled = valor || !items.length;
      importar.disabled = valor || !claveImportacion;
      contenedor.querySelectorAll('button, input, select').forEach(control => { control.disabled = valor; });
    };
    formulario.addEventListener('submit', async evento => {
      evento.preventDefault();
      if (ocupado) return;
      try {
        if (!nombre.value.trim()) throw new Error('Escribe el nombre del ingrediente.');
        const datos = datosCantidad(cantidad.value, unidad.value);
        bloquear(true);
        const resultado = await api('/items', 'POST', { nombre: nombre.value.trim(), ...datos });
        nombre.value = ''; cantidad.value = ''; unidad.value = '';
        await recargarConfirmada();
        avisar(resultado.mensaje, resultado.duplicado ? 'info' : 'exito');
      } catch (error) { avisar(error.message, 'error'); }
      finally { bloquear(false); }
    });
    // Solo indica cambios visualmente; guardar y completar conservan su flujo.
    const indicarCambios = evento => {
      const tarjeta = evento.target.closest('[data-item]');
      if (!tarjeta) return;
      const item = items.find(elemento => Number(elemento.id_item) === Number(tarjeta.dataset.item));
      if (!item) return;
      const cantidadActual = tarjeta.querySelector('[data-cantidad]').value;
      const unidadActual = tarjeta.querySelector('[data-unidad]').value;
      tarjeta.classList.toggle('compra-editada', cantidadActual !== formato(item.cantidad)
        || unidadActual !== String(item.id_unidad ?? ''));
    };
    contenedor.addEventListener('input', indicarCambios);
    contenedor.addEventListener('change', indicarCambios);
    contenedor.addEventListener('click', async evento => {
      const boton = evento.target.closest('[data-accion]');
      if (!boton || ocupado) return;
      const tarjeta = boton.closest('[data-item]');
      const id = Number(tarjeta.dataset.item);
      const item = items.find(elemento => Number(elemento.id_item) === id);
      if (!item) return;
      const accion = boton.dataset.accion;
      if (accion === 'eliminar') {
        bloquear(true);
        if (!await confirmarAccionCookIQ({ mensaje: `¿Estás seguro de que deseas eliminar ${item.ingrediente} de tu lista de compras?` })) {
          bloquear(false); return;
        }
      }
      try {
        const datos = accion === 'eliminar' ? null : datosCantidad(tarjeta.querySelector('[data-cantidad]').value, tarjeta.querySelector('[data-unidad]').value);
        bloquear(true);
        if (accion === 'eliminar') {
          await api(`/items/${id}`, 'DELETE');
          items = items.filter(elemento => Number(elemento.id_item) !== id); pintar();
          avisar('Ingrediente eliminado de la lista.', 'exito');
        } else {
          if (Number(item.cantidad) !== Number(datos.cantidad) || Number(item.id_unidad) !== datos.id_unidad) {
            await api(`/items/${id}`, 'PATCH', datos);
            Object.assign(item, datos);
          }
          if (accion === 'completar') {
            const resultado = await api(`/items/${id}/comprado`, 'PATCH');
            items = items.filter(elemento => Number(elemento.id_item) !== id); pintar();
            window.dispatchEvent(new Event('cookiq:despensa-actualizada'));
            avisar(resultado.yaProcesado ? resultado.mensaje : 'Ingrediente agregado correctamente a tu despensa.', resultado.yaProcesado ? 'info' : 'exito');
          } else {
            await recargarConfirmada(); avisar('Cantidad y unidad guardadas.', 'exito');
          }
        }
      } catch (error) { avisar(error.message, 'error'); }
      finally { bloquear(false); }
    });
    limpiar.addEventListener('click', async () => {
      if (ocupado) return;
      bloquear(true);
      try {
        if (!await confirmarAccionCookIQ({ mensaje: '¿Estás seguro de que deseas eliminar todos los ingredientes pendientes de tu lista de compras?' })) return;
        await api('/items', 'DELETE'); items = []; pintar();
        avisar('Lista de compras vaciada.', 'exito');
      } catch (error) { avisar(error.message, 'error'); }
      finally { bloquear(false); }
    });

    const leerLocal = (clave, defecto) => {
      try { return JSON.parse(localStorage.getItem(clave)) ?? defecto; } catch { return defecto; }
    };
    // La normalización antigua solo sirve para encontrar los metadatos del respaldo.
    const claveAntigua = nombre => String(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CL')
      .replace(/\s+/g, ' ').trim();
    importar.addEventListener('click', async () => {
      if (ocupado || !claveImportacion) return;
      bloquear(true);
      const confirmado = await confirmarAccionCookIQ({ mensaje: '¿Importar el respaldo de este navegador a la cuenta actual? Verifica que te pertenece. El respaldo local se conservará.', textoConfirmar: 'Sí, importar' });
      bloquear(false);
      if (!confirmado) return;
      const respaldo = leerLocal('miCocinaCompras', []);
      const metadatos = leerLocal('miCocinaComprasDatos', {});
      const completadas = leerLocal('miCocinaComprasCompletadas', []);
      const registro = leerLocal(claveImportacion, []);
      if (!Array.isArray(respaldo) || !Array.isArray(completadas) || !Array.isArray(registro)
          || !metadatos || typeof metadatos !== 'object' || Array.isArray(metadatos)) {
        avisar('El respaldo local tiene un formato no válido. No se importó ni se borró.', 'error');
        return;
      }
      const procesadas = new Set(registro);
      let guardadas = 0; let fallidas = 0;
      bloquear(true);
      try {
        for (const texto of Array.isArray(respaldo) ? respaldo : []) {
          if (typeof texto !== 'string' || completadas.includes(claveAntigua(texto))) continue;
          const extra = metadatos[claveAntigua(texto)] || {};
          const firma = JSON.stringify([texto.trim().toLowerCase(), extra.cantidad ?? null, extra.id_unidad ?? null]);
          if (procesadas.has(firma)) continue;
          try {
            await api('/items', 'POST', { nombre: texto, importar: true,
              ...(extra.cantidad && extra.id_unidad ? { cantidad: extra.cantidad, id_unidad: extra.id_unidad } : {}) });
            procesadas.add(firma);
            localStorage.setItem(claveImportacion, JSON.stringify([...procesadas]));
            guardadas++;
          } catch { fallidas++; }
        }
        await recargarConfirmada();
        avisar(`${guardadas} elementos verificados en MySQL. ${fallidas ? `${fallidas} requieren revisión manual de nombre, cantidad o unidad. ` : ''}El respaldo local se conserva.`, fallidas ? 'advertencia' : 'exito');
      } finally { bloquear(false); }
    });
    bloquear(true);
    Promise.all([cargar(), api('/unidades').then(datos => {
      unidades = datos.unidades; unidad.innerHTML = opciones(); pintar();
    })]).catch(error => {
      if (!listaCargada) contenedor.innerHTML = '<p class="sin-resultados">No se pudo cargar la lista. Recarga para reintentar.</p>';
      estado.textContent = error.message; estado.setAttribute('role', 'alert'); avisar(error.message, 'error');
    }).finally(() => bloquear(false));
    fetch('/api/firebase/sesion').then(respuesta => respuesta.ok ? respuesta.json() : null).then(datos => {
      const id = datos?.usuario?.id_usuario;
      if (Number.isSafeInteger(Number(id)) && Number(id) > 0) claveImportacion = `cookiq:compras:importadas:${id}`;
      importar.hidden = true;
      importar.disabled = ocupado || !claveImportacion;
    }).catch(() => { importar.disabled = true; });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

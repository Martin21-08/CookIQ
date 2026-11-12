(() => {
  const instancias = new WeakMap();
  let secuencia = 0;

  const solicitar = async (url, opciones = {}) => {
    const respuesta = await fetch(url, {
      ...opciones,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(opciones.headers || {}) }
    });
    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok || datos?.ok !== true) {
      throw new Error(respuesta.status === 401
        ? 'Inicia sesión para consultar o publicar reseñas.'
        : datos?.mensaje || 'No se pudo completar la solicitud de reseñas. Inténtalo nuevamente.');
    }
    return datos;
  };

  const montar = (contenedor, idReceta) => {
    instancias.get(contenedor)?.controlador.abort();
    const instancia = { controlador: new AbortController() };
    instancias.set(contenedor, instancia);
    const raiz = document.createElement('section');
    raiz.className = 'comentarios-receta';
    raiz.innerHTML = '<h3>Comentarios y valoración</h3><p role="status" aria-live="polite"></p><div data-contenido-resenas></div>';
    contenedor.appendChild(raiz);
    const mensaje = raiz.querySelector('p');
    const contenido = raiz.querySelector('[data-contenido-resenas]');
    const vigente = () => raiz.isConnected && instancias.get(contenedor) === instancia;
    const avisar = (texto, error = false) => {
      mensaje.textContent = texto;
      mensaje.setAttribute('role', error ? 'alert' : 'status');
    };
    const id = Number(idReceta);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
      avisar('Esta receta no quedó guardada. Las reseñas estarán disponibles cuando tenga un identificador válido.');
      return;
    }

    const url = `/api/recetas/${id}/resenas`;
    let resenas = [];
    let ocupada = false;
    let editando = false;

    const pintar = () => {
      contenido.replaceChildren();
      const propia = resenas.find(resena => resena.propia === true);
      if (!propia) {
        const informacion = document.createElement('p');
        informacion.className = 'resena-info';
        informacion.textContent = 'Puedes publicar una reseña por receta. Si después quieres cambiar tu opinión o agregar algo más, puedes editarla.';
        contenido.appendChild(informacion);
      }
      const formulario = document.createElement('form');
      formulario.hidden = Boolean(propia) && !editando;
      const campoId = `comentario-resena-${++secuencia}`;
      formulario.innerHTML = `
        <h4>Tu reseña</h4>
        <div class="estrellas-interactivas" role="group" aria-label="Calificación de 1 a 5 estrellas">
          ${[1, 2, 3, 4, 5].map(valor => `<button class="estrella-boton" type="button" data-estrellas="${valor}" aria-label="${valor} estrellas" aria-pressed="false">☆</button>`).join('')}
        </div>
        <label for="${campoId}">Comentario (máximo 2000 caracteres)</label>
        <textarea id="${campoId}" class="comentario-input" rows="3" maxlength="2000" required></textarea>
        <div class="resena-acciones">
          <button class="boton-generar" type="submit"></button>
          <button class="resena-accion" type="button" data-cancelar-resena>Cancelar</button>
        </div>`;
      const texto = formulario.querySelector('textarea');
      const publicar = formulario.querySelector('[type="submit"]');
      const cancelar = formulario.querySelector('[data-cancelar-resena]');
      const estrellasBotones = [...formulario.querySelectorAll('[data-estrellas]')];
      let estrellas = propia ? Number(propia.estrellas) : 0;
      const actualizarEstrellas = () => estrellasBotones.forEach(boton => {
        const valor = Number(boton.dataset.estrellas);
        boton.textContent = valor <= estrellas ? '★' : '☆';
        boton.classList.toggle('seleccionada', valor <= estrellas);
        boton.setAttribute('aria-pressed', String(valor === estrellas));
      });
      texto.value = propia?.comentario || '';
      publicar.textContent = propia ? 'Guardar cambios' : 'Publicar reseña';
      cancelar.hidden = !propia;
      cancelar.addEventListener('click', () => {
        if (ocupada) return;
        editando = false;
        pintar();
        avisar('');
      });
      actualizarEstrellas();
      estrellasBotones.forEach(boton => boton.addEventListener('click', () => {
        estrellas = Number(boton.dataset.estrellas);
        actualizarEstrellas();
      }));
      const bloquear = valor => {
        ocupada = valor;
        contenido.querySelectorAll('button, textarea').forEach(control => { control.disabled = valor; });
      };
      formulario.addEventListener('submit', async evento => {
        evento.preventDefault();
        if (ocupada) return;
        const comentario = texto.value.trim();
        if (!estrellas || !comentario || [...comentario].length > 2000) {
          avisar('Selecciona de 1 a 5 estrellas y escribe un comentario de hasta 2000 caracteres.', true);
          return;
        }
        bloquear(true);
        try {
          const datos = await solicitar(`${url}/mia`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estrellas, comentario })
          });
          if (!vigente()) return;
          resenas = [datos.resena, ...resenas.filter(resena => !resena.propia)];
          editando = false;
          pintar();
          avisar('Reseña guardada correctamente.');
        } catch (error) {
          if (vigente()) avisar(error.message, true);
        } finally { bloquear(false); }
      });
      const eliminarPropia = async () => {
        if (ocupada) return;
        bloquear(true);
        try {
          if (!await confirmarAccionCookIQ({ mensaje: '¿Estás seguro de que deseas eliminar tu reseña de esta receta?' }) || !vigente()) return;
          await solicitar(`${url}/mia`, { method: 'DELETE' });
          if (!vigente()) return;
          resenas = resenas.filter(resena => !resena.propia);
          editando = false;
          pintar();
          avisar('');
          mostrarNotificacionCookIQ('Tu reseña fue eliminada.', 'exito');
        } catch (error) {
          if (vigente()) mostrarNotificacionCookIQ(error.message, 'error');
        } finally { bloquear(false); }
      };
      contenido.appendChild(formulario);

      const lista = document.createElement('div');
      if (!resenas.length) {
        const vacia = document.createElement('p');
        vacia.className = 'sin-comentarios';
        vacia.textContent = 'Aún no hay reseñas para esta receta.';
        lista.appendChild(vacia);
      }
      resenas.forEach(resena => {
        const articulo = document.createElement('article');
        articulo.className = 'comentario-item';
        const cabecera = document.createElement('div');
        cabecera.className = 'comentario-cabecera';
        const autor = document.createElement('strong');
        autor.textContent = resena.propia ? 'Tu reseña' : resena.autor || 'Usuario';
        const calificacion = document.createElement('span');
        calificacion.className = 'estrellas-mostradas';
        const valor = Number(resena.estrellas);
        calificacion.textContent = '★'.repeat(valor) + '☆'.repeat(5 - valor);
        cabecera.append(autor, calificacion);
        const comentario = document.createElement('p');
        comentario.textContent = resena.comentario || '';
        articulo.append(cabecera, comentario);
        if (resena.propia) {
          const acciones = document.createElement('div');
          acciones.className = 'resena-acciones';
          acciones.hidden = editando;
          const editar = document.createElement('button');
          editar.type = 'button';
          editar.className = 'resena-accion';
          editar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg><span>Editar reseña</span>';
          editar.addEventListener('click', () => {
            if (ocupada) return;
            editando = true;
            pintar();
            avisar('');
            contenido.querySelector('textarea').focus();
          });
          const eliminar = document.createElement('button');
          eliminar.type = 'button';
          eliminar.className = 'resena-accion resena-accion--eliminar';
          eliminar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg><span>Eliminar reseña</span>';
          eliminar.addEventListener('click', eliminarPropia);
          acciones.append(editar, eliminar);
          articulo.appendChild(acciones);
        }
        lista.appendChild(articulo);
      });
      contenido.appendChild(lista);
    };

    const cargar = async () => {
      avisar('Cargando reseñas…');
      contenido.replaceChildren();
      try {
        const datos = await solicitar(url, { signal: instancia.controlador.signal });
        if (!vigente()) return;
        if (!Array.isArray(datos.resenas)) throw new Error('No se pudieron interpretar las reseñas.');
        resenas = datos.resenas;
        pintar();
        avisar('');
      } catch (error) {
        if (!vigente() || error.name === 'AbortError') return;
        avisar(error.message, true);
        const reintentar = document.createElement('button');
        reintentar.type = 'button';
        reintentar.textContent = 'Volver a cargar reseñas';
        reintentar.addEventListener('click', cargar);
        contenido.appendChild(reintentar);
      }
    };
    cargar();
  };

  window.CookIQResenas = { montar };
})();

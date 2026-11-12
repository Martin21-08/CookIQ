// Página pública informativa: no consulta modelos ni modifica la sesión.
const mostrar = (req, res) => {
    const id = Number(req.session?.usuario?.id_usuario);
    res.set('Cache-Control', 'private, no-store');
    return res.render('descubre', {
        autenticado: Number.isSafeInteger(id) && id > 0,
        anio: new Intl.DateTimeFormat('es-CL', { year: 'numeric', timeZone: 'America/Santiago' }).format(new Date()),
        funciones: [
            ['destello', 'Un poco de inspiración', 'Genera recetas con inteligencia artificial a partir de lo que quieres cocinar.'],
            ['hoja', 'Parte con tus ingredientes', 'Escribe los alimentos que tienes y descubre ideas para utilizarlos.'],
            ['reloj', 'A tu tiempo y a tu medida', 'Elige tiempo máximo, porciones y dificultad para orientar tus resultados.'],
            ['ajustes', 'Tus preferencias cuentan', 'Configura tus alergias e intolerancias. Revisa las indicaciones de cada receta y las etiquetas de los productos.'],
            ['corazon', 'Tus favoritas, a mano', 'Guarda las recetas que te gustan para volver a prepararlas.'],
            ['historial', 'Vuelve a una buena idea', 'Consulta tu historial y recupera recetas que ya descubriste.'],
            ['despensa', 'Mi Despensa', 'Organiza tus ingredientes y utiliza la opción de cocinar con tu despensa.', true],
            ['lista', 'Lista de Compras', 'Anota lo que necesitas, agrega faltantes de tus recetas y organiza tus compras.', true]
        ],
        pasos: [
            ['usuario', 'Entra a tu cocina', 'Regístrate o inicia sesión para comenzar.'],
            ['ajustes', 'Cuéntanos tus preferencias', 'Completa tu perfil y selecciona tus alergias e intolerancias alimentarias.'],
            ['hoja', '¿Qué quieres cocinar?', 'Escribe tus ingredientes, un plato o una idea que tengas en mente.'],
            ['reloj', 'Ajusta los detalles', 'Selecciona tiempo máximo, dificultad y cantidad de porciones.'],
            ['destello', 'Descubre tus recetas', 'Presiona Generar recetas y consulta las propuestas disponibles.'],
            ['libro', 'Manos a la cocina', 'Abre una receta y sigue sus instrucciones de preparación.'],
            ['corazon', 'Conserva la inspiración', 'Añade tus recetas favoritas y vuelve a ellas desde tu historial.'],
            ['lista', 'Organízate con MasterChef', 'Utiliza Mi Despensa y Lista de Compras para preparar tu próxima receta.']
        ],
        equipo: ['Amador Pizarro', 'Renato Inostroza', 'Andrés Salazar', 'Martin Espinoza']
    });
};
module.exports = { mostrar };

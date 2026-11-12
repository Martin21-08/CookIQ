// Solo reconoce construcciones explícitas. No recorta términos de composición
// (sin lactosa, con leche, de ajo...) ni divide ingredientes por una «y» genérica.
const limpiar = valor => String(valor ?? '').trim().replace(/\s+/g, ' ');
const clave = valor => limpiar(valor).toLocaleLowerCase('es-CL');
const normalizarIngredienteCulinario = entrada => {
    const item = typeof entrada === 'string' ? { nombre: entrada } : { ...entrada };
    // No transformar datos malformados en cadenas que el validador aceptaría.
    if (typeof item.nombre !== 'string' || (item.indicacion != null && typeof item.indicacion !== 'string')) return [item];
    let nombre = limpiar(item.nombre);
    const indicaciones = [limpiar(item.indicacion)].filter(Boolean);
    for (const campo of ['cantidad', 'unidad']) {
        if (typeof item[campo] === 'string' && /^(?:al gusto|una pizca|cantidad necesaria)$/i.test(limpiar(item[campo]))) {
            indicaciones.push(limpiar(item[campo]));
            item.cantidad = null; item.unidad = null;
        }
    }
    const sufijo = nombre.match(/(?:,?\s+)(al gusto|cantidad necesaria)$/i);
    if (sufijo) {
        indicaciones.push(sufijo[1]);
        nombre = nombre.slice(0, sufijo.index).trim();
    }
    const prefijo = nombre.match(/^(una pizca|un poco|cantidad necesaria)\s+de\s+(.+)$/i)
        || nombre.match(/^((?:un|uno|dos|tres|cuatro|cinco|seis|\d+)\s+dientes?)\s+de\s+(ajo)$/i);
    if (prefijo) { indicaciones.push(prefijo[1]); nombre = prefijo[2]; }
    const combinacion = nombre.match(/^sal\s+y\s+(pimienta(?:\s+(?:negra|blanca))?)$/i);
    const nombres = combinacion ? ['Sal', combinacion[1]] : [nombre];
    // Una cantidad conjunta no puede distribuirse de forma fiable.
    if (combinacion && item.cantidad != null && item.cantidad !== '') {
        indicaciones.push(`${limpiar(item.cantidad)} ${limpiar(item.unidad)} en total para ${nombre}`.trim());
    }
    if (combinacion && !indicaciones.length) indicaciones.push('cantidad no especificada');
    const indicacion = [...new Map(indicaciones.map(texto => [clave(texto), texto])).values()].join('; ');
    const sinCantidad = item.cantidad == null || item.cantidad === '';
    return nombres.map(nombreIndividual => ({ ...item, nombre: nombreIndividual,
        ...(combinacion || (sinCantidad && indicacion) ? { cantidad: null, unidad: null } : {}),
        ...(indicacion ? { indicacion } : {}) }));
};
const normalizarIngredientesCulinarios = ingredientes => ingredientes.flatMap(normalizarIngredienteCulinario);
const normalizarRecetaCulinaria = receta => ({ ...receta,
    ingredientes: normalizarIngredientesCulinarios(receta.ingredientes || []),
    ...(Array.isArray(receta.ingredientesFaltantes) ? {
        ingredientesFaltantes: normalizarIngredientesCulinarios(receta.ingredientesFaltantes).map(item => item.nombre)
    } : {})
});
const identidadCompuestaAmbigua = nombre => /\s+y\s+|[,;]/i.test(nombre);
// Solo para referencias dentro de pasos, nunca para renombrar el catalogo.
// Separa el complemento de una accion de su resultado culinario (hasta/cuando...).
const referenciasCombinacionPaso = texto => {
    const coincidencia = texto.match(/^\s+con\s+(.+?)(?=\s+(?:hasta|durante|a fuego|cuando|para|sin dejar de)\b|[.;:!?]|$)/i);
    if (!coincidencia) return null;
    // Son candidatos: el validador solo los separa si todos se identifican.
    return coincidencia[1].split(/\s*(?:,|\by\b)\s*/i).flatMap(referencia =>
        normalizarIngredienteCulinario(referencia.replace(/^(?:el|la|los|las)\s+/i, '')));
};
module.exports = { normalizarIngredienteCulinario, normalizarIngredientesCulinarios, normalizarRecetaCulinaria, identidadCompuestaAmbigua, referenciasCombinacionPaso };

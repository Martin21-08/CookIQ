// Validación determinista: la ausencia de una relación en MySQL no acredita seguridad.
const { normalizarRecetaCulinaria, normalizarIngredienteCulinario, identidadCompuestaAmbigua, referenciasCombinacionPaso } = require('./ingredientesCulinariosService');
const normalizar = valor => String(valor || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

const alimentos = new Map();
// Reconocimiento culinario, sin ninguna afirmacion sobre alergenos o composicion.
const nombresCulinarios = new Set(['harina', 'aceite', 'esencia de vainilla', 'extracto de vainilla', 'chocolate', 'cacao', 'chocolate en polvo', 'cacao en polvo', 'chocolate en polvo sin lactosa', 'cacao en polvo sin lactosa', 'polvo de hornear', 'jugo de naranja', 'gelatina']);
const registrar = (nombres, etiquetas = [], lactosa = 'ausente') => {
    nombres.split('|').forEach(nombre => alimentos.set(nombre, { etiquetas, lactosa }));
};
registrar('agua|sal|arroz|quinoa|papa|papas|patata|patatas|zanahoria|zanahorias|cebolla|cebollas|ajo|ajos|aceite de oliva|pollo|pechuga de pollo|carne de pollo|carne de res|carne de vacuno|cerdo');
registrar('manzana|manzanas|platano|platanos|banana|bananas|limon|limones|naranja|naranjas');
for (const [nombre, variantes] of Object.entries({
    huevo: 'huevo|huevos|clara de huevo|yema de huevo',
    mani: 'mani|manies|cacahuete|cacahuetes', trigo: 'trigo|harina de trigo',
    soja: 'soja|soya', almendras: 'almendra|almendras', nueces: 'nuez|nueces',
    avellanas: 'avellana|avellanas', 'castanas de caju': 'castana de caju|castanas de caju|anacardo|anacardos',
    pistachos: 'pistacho|pistachos', pescado: 'salmon|pescado|merluza|atun',
    mariscos: 'marisco|mariscos', camarones: 'camaron|camarones', cangrejo: 'cangrejo|cangrejos',
    sesamo: 'sesamo|ajonjoli', mostaza: 'mostaza|semilla de mostaza|semillas de mostaza', apio: 'apio', maiz: 'maiz|choclo',
    durazno: 'durazno|duraznos|melocoton|melocotones', kiwi: 'kiwi|kiwis',
    palta: 'palta|paltas|aguacate|aguacates', tomate: 'tomate|tomates',
    lentejas: 'lenteja|lentejas', porotos: 'poroto|porotos|frijol|frijoles', arvejas: 'arveja|arvejas|guisante|guisantes'
})) registrar(variantes, [nombre, ...(nombre === 'trigo' ? ['gluten'] : []), ...(['camarones', 'cangrejo'].includes(nombre) ? ['mariscos'] : [])]);
registrar('leche|leche de vaca|leche entera|leche descremada|leche en polvo|leche condensada|leche evaporada|crema de leche|nata|lactosa', ['leche'], 'presente');
registrar('leche sin lactosa|leche de vaca sin lactosa|leche deslactosada', ['leche']);
// No inferir el contenido de lactosa de todos los quesos, yogures o mantequillas.
registrar('queso|queso maduro|queso parmesano|yogur|yogurt|mantequilla|mantequilla derretida|suero de leche', ['leche'], 'desconocida');
registrar('caseina|caseinato', ['leche'], 'desconocida');

// Reglas de composición para alimentos simples, no para mezclas ni marcas comerciales.
registrar('lechuga|pepino|calabacin|pimiento rojo|pimiento verde|fresa|fresas|canela|pimienta negra|pimienta|perejil|cilantro|hielo|miel|azucar');
registrar('maicena|almidon de maiz', ['maiz']);
// Cereales con gluten: FDA, Gluten and Food Labeling. No equivaler a alergia a trigo.
registrar('cebada|harina de cebada|malta de cebada|centeno|harina de centeno', ['gluten']);
// Perfiles del alimento puro, no de mezclas comerciales ni certificaciones.
// Carob: Papaefstathiou et al., Food Sci Nutr. 2018, doi:10.1002/fsn3.776.
registrar('algarroba en polvo pura');
// Fuentes: FDA, Spilling the Beans: How Much Caffeine is Too Much?
// https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much
// Descafeinar reduce cafeina; no demuestra ausencia ni tolerancia individual.
const perfilesCafeina = new Map();
const registrarCafeina = (nombres, estado) => nombres.split('|').forEach(n => perfilesCafeina.set(n, estado));
registrarCafeina('cafe|cafe normal|cafe molido|cafe en grano|cafe soluble|cafe instantaneo|espresso|expreso|cafe espresso|te|te negro|te verde|te blanco|matcha|te matcha|yerba mate|mate|guarana|cacao|cacao puro|cacao en polvo|cacao en polvo sin lactosa|chocolate|chocolate negro|chocolate amargo|chocolate en polvo|chocolate en polvo sin lactosa|chocolate en trozos|cafeina', 'presente');
registrarCafeina('cafe descafeinado|cafe instantaneo descafeinado|cafe soluble descafeinado|cafe sin cafeina|te descafeinado', 'residual');
registrarCafeina('bebida energetica|bebidas energeticas|sustituto de cafe|sucedaneo de cafe|chocolate blanco', 'desconocida');
registrarCafeina('algarroba en polvo pura', 'ausente');
const variantesPresentacion = new Map([
    ['salmon fresco', 'salmon'], ['durazno fresco', 'durazno']
]);
const alteraComposicion = nombre => /\b(con|sin|rellen[oa]|mezcla|compuest[oa]|sabor|ahumad[oa]|empanad[oa]|marinad[oa])\b/.test(nombre);
// Identificar una bebida/harina de un alimento conocido NO documenta su formula.
const baseProductoCulinario = nombre => {
    const coincidencia = normalizar(nombre).match(/^(?:bebida|leche|harina|aceite|jugo) de (.+)$/);
    return coincidencia ? alimentos.get(coincidencia[1]) || alimentos.get(variantesPresentacion.get(coincidencia[1])) : null;
};
// Identidad de un producto culinario; no documenta su formula ni sus alergenos.
const esGelatinaCulinaria = nombre => /^gelatinas?(?: sin sabor| sabor (?!.*\b(?:con|sin|para|relleno|mezcla)\b)[a-z]+(?: [a-z]+){0,2})?$/.test(normalizar(nombre));
const esIngredienteCulinarioReconocido = nombre => alimentos.has(normalizar(nombre))
    || nombresCulinarios.has(normalizar(nombre)) || variantesPresentacion.has(normalizar(nombre))
    || esGelatinaCulinaria(nombre) || perfilesCafeina.has(normalizar(nombre)) || Boolean(baseProductoCulinario(nombre));
// Equivalencias de nombres de restricciones; no equivalencias entre alimentos.
const nombreRestriccion = nombre => {
    const clave = normalizar(nombre).replace(/^(?:alergia|intolerancia)\s+(?:a|al)\s+(?:(?:la|el|los|las)\s+)?/, '');
    return ({ soya: 'soja', cacahuete: 'mani', cacahuetes: 'mani', huevos: 'huevo',
        'proteina de leche': 'leche', 'proteinas de leche': 'leche', 'proteina de la leche': 'leche',
        'proteinas de la leche': 'leche', 'frutos de cascara': 'frutos secos' }[clave] || clave);
};
const frutosSecos = ['almendras', 'nueces', 'avellanas', 'castanas de caju', 'pistachos'];
// Mantener completo el nombre de una bebida de otro alimento: el prefijo
// culinario "leche de almendra" no declara leche de vaca.
const nombresBebidas = [...new Set([...alimentos.entries()].filter(([,dato]) => !dato.etiquetas.includes('leche'))
    .map(([nombre]) => nombre).concat(['avena', 'coco']))]
    .flatMap(nombre => [`leche de ${nombre}`, `bebida de ${nombre}`]);
const crearValidador = ({ alergias = [], intolerancias = [] }, vinculos = [], excepciones = [], catalogo = []) => {
    const indice = new Map();
    for (const fila of catalogo) {
        for (const valor of [fila.nombre, fila.alias].filter(Boolean)) {
            const clave = normalizar(valor);
            const entradas = indice.get(clave) || new Map();
            entradas.set(fila.id_ingrediente, fila);
            indice.set(clave, entradas);
        }
    }
    const resolver = nombre => {
        const clave = normalizar(nombre);
        const coincidencias = [...(indice.get(clave)?.values() || [])];
        if (coincidencias.length > 1) return { clave, motivo: 'IDENTIDAD_AMBIGUA' };
        const fila = coincidencias[0];
        if (fila && (!fila.activo || !['validado', 'pendiente'].includes(fila.estado))) {
            return { clave, motivo: 'INGREDIENTE_NO_HABILITADO' };
        }
        const canonico = fila ? normalizar(fila.nombre) : clave;
        const aliasConComposicion = canonico !== clave && (alteraComposicion(clave) || alteraComposicion(canonico));
        // Una regla del nombre completo prevalece: no borrar «sin lactosa», por ejemplo.
        const presentacion = valor => valor.replace(/\s+(?:batid[oa]s?|picad[oa]s?|rallad[oa]s?|derretid[oa]s?|cocid[oa]s?|tibi[oa]s?|calientes?|fri[oa]s?)$/, '');
        const regla = alimentos.has(clave) ? clave
            : variantesPresentacion.get(clave)
            || (!alteraComposicion(clave) && alimentos.has(presentacion(clave)) ? presentacion(clave) : null)
            || (!aliasConComposicion ? (alimentos.has(canonico) ? canonico : variantesPresentacion.get(canonico)
                || (!alteraComposicion(canonico) && alimentos.has(presentacion(canonico)) ? presentacion(canonico) : null)) : null);
        return { clave, canonico: aliasConComposicion ? clave : canonico, id: fila?.id_ingrediente,
            estadoCatalogo: fila?.estado || null, existeEnCatalogo: Boolean(fila), dato: regla ? alimentos.get(regla) : null,
            evidencia: regla ? `${regla === clave ? 'regla_alimento_simple' : 'identidad_y_regla'}:${regla}` : null };
    };
    const restricciones = [
        ...alergias.map(nombre => ({ tipo: 'alergia', nombre: nombreRestriccion(nombre) })),
        ...intolerancias.map(nombre => ({ tipo: 'intolerancia', nombre: nombreRestriccion(nombre) }))
    ];
    const alergiasConocidas = new Set(['leche', 'frutos secos', ...[...alimentos.values()].flatMap(item => item.etiquetas)]);
    // Buscar componentes explicitos aunque el nombre completo figure en el catalogo.
    // Los nombres completos prevalecen: leche sin lactosa no se divide en leche.
    const nombresComponentes = [...new Set([...alimentos.keys(), ...perfilesCafeina.keys(), ...variantesPresentacion.keys(), ...nombresBebidas,
        ...vinculos.flatMap(f => [f.ingrediente, f.alias]).filter(Boolean).map(normalizar),
        ...catalogo.filter(f => resolver(f.nombre).dato).flatMap(f => [f.nombre, f.alias]).filter(Boolean).map(normalizar)])]
        .sort((a,b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const patronComponentes = new RegExp(`(^|[^a-z])(${nombresComponentes.join('|')})(?=$|[^a-z])`, 'g');
    const componentesExplicitos = nombre => [...normalizar(nombre).matchAll(patronComponentes)].filter(m =>
        !/\b(?:sin|libre de|no contiene)\s+$/.test(normalizar(nombre).slice(0, m.index + m[1].length)))
        .map(m => ({ nombre: m[2], identidad: resolver(m[2]) }));
    const esSustanciaNoApta = nombre => /\b(paracetamol|ibuprofeno|aspirina|codeina|cocaina|heroina|metanfetamina|lejia|detergente|cloro|medicamento|droga)\b/.test(normalizar(nombre));
    const analizar = nombre => {
        const problemasIdentidad = [];
        if (esSustanciaNoApta(nombre)) problemasIdentidad.push({ estado: 'incompatible', tipo: 'sustancia_no_apta', ingrediente: nombre });
        if (identidadCompuestaAmbigua(nombre) && indice.get(normalizar(nombre))?.size !== 1) {
            problemasIdentidad.push({ estado: 'no_verificable', ingrediente: nombre, motivo: 'EXPRESION_CULINARIA_AMBIGUA' });
        }
        if (!restricciones.length) return problemasIdentidad;
        const identidad = resolver(nombre);
        const { clave, dato } = identidad;
        const componentes = componentesExplicitos(nombre);
        const nombresRelacionados = [clave, identidad.canonico, ...componentes.flatMap(c => [c.nombre, c.identidad.canonico])];
        const relaciones = vinculos.filter(fila => [fila.ingrediente, fila.alias].some(valor => valor &&
            nombresRelacionados.includes(normalizar(valor))));
        if (identidad.motivo) problemasIdentidad.push({ estado: 'no_verificable', ingrediente: nombre, motivo: identidad.motivo });
        const fuentes = [dato, baseProductoCulinario(clave), ...componentes.flatMap(c => [c.identidad.dato, baseProductoCulinario(c.nombre)])].filter(Boolean);
        const conflictos = restricciones.filter(r => relaciones.some(f => f.tipo === r.tipo && nombreRestriccion(f.restriccion) === r.nombre)
            || fuentes.some(f => r.tipo === 'alergia' && (f.etiquetas.includes(r.nombre)
                || r.nombre === 'frutos secos' && f.etiquetas.some(t => frutosSecos.includes(t)))
                || r.tipo === 'intolerancia' && (r.nombre === 'lactosa' && f.lactosa === 'presente'
                    || r.nombre === 'gluten' && f.etiquetas.includes('gluten'))));
        const resultados = conflictos.map(r => ({ estado: 'incompatible', ingrediente: nombre,
            tipo: r.tipo, restriccion: r.nombre, motivo: 'INCOMPATIBILIDAD_EXPLICITA',
            evidencia: relaciones.some(f => f.tipo === r.tipo && nombreRestriccion(f.restriccion) === r.nombre)
                ? 'relacion_mysql' : 'componente_explicito' }));
        resultados.push(...restricciones.filter(r => !conflictos.some(c => c.tipo === r.tipo && c.nombre === r.nombre)).flatMap(({ tipo, nombre: restriccion }) => {
            const resultado = estado => [{ estado, ingrediente: nombre, tipo, restriccion,
                ...(estado === 'sin_conflicto_identificado' ? { motivo: 'SIN_INCOMPATIBILIDAD_EXPLICITA', composicionVerificada: false } : {}),
                ...(estado === 'requiere_adaptacion' ? { motivo: 'DERIVADO_LACTEO_SIN_ADAPTACION' } : {}) }];
            if (tipo === 'intolerancia' && restriccion === 'cafeina') {
                const perfiles = [perfilesCafeina.get(clave), perfilesCafeina.get(identidad.canonico),
                    ...componentes.map(c => perfilesCafeina.get(c.nombre) || perfilesCafeina.get(c.identidad.canonico))].filter(Boolean);
                if (perfiles.some(p => p === 'presente' || p === 'residual')) return [{ estado: 'incompatible', ingrediente: nombre,
                    tipo, restriccion, motivo: perfiles.includes('residual') ? 'CAFEINA_RESIDUAL' : 'FUENTE_CAFEINA', evidencia: 'perfil_cafeina_documentado' }];
                if (!problemasIdentidad.length && !perfiles.includes('desconocida') && dato) return [{ estado: 'compatible', ingrediente: nombre,
                    tipo, restriccion, evidencia: identidad.evidencia }];
                return [{ estado: 'no_verificable', ingrediente: nombre, tipo, restriccion,
                    motivo: 'CONTENIDO_CAFEINA_NO_VERIFICADO', composicionVerificada: false }];
            }
            if (tipo === 'intolerancia' && restriccion === 'lactosa'
                && fuentes.some(f => f.etiquetas.includes('leche') && f.lactosa === 'desconocida')) return resultado('requiere_adaptacion');
            if (!dato) {
                const reconocido = identidad.existeEnCatalogo || esIngredienteCulinarioReconocido(clave) || esIngredienteCulinarioReconocido(identidad.canonico);
                return reconocido ? resultado('sin_conflicto_identificado')
                    : [{ estado: 'no_verificable', ingrediente: nombre, tipo, restriccion, motivo: 'IDENTIDAD_NO_RESUELTA' }];
            }
            if (tipo === 'alergia') {
                if (dato.etiquetas.includes(restriccion)) return resultado('incompatible');
                if (restriccion === 'frutos secos' && dato.etiquetas.some(t => frutosSecos.includes(t))) return resultado('incompatible');
                if (!alergiasConocidas.has(restriccion)) return resultado('sin_conflicto_identificado');
            } else if (restriccion === 'lactosa') {
                if (dato.lactosa !== 'ausente') return resultado(dato.lactosa === 'presente' ? 'incompatible' : 'requiere_adaptacion');
            } else if (restriccion === 'gluten') {
                if (dato.etiquetas.includes('gluten')) return resultado('incompatible');
            } else return resultado('sin_conflicto_identificado');
            return [];
        }));
        return [...problemasIdentidad, ...resultados];
    };
    const conflictosIntolerancia = nombres => nombres.flatMap(nombre => {
        const resultados = analizar(nombre);
        if (resultados.some(item => item.composicionIncompleta || item.estado === 'no_verificable'
            || item.estado === 'requiere_adaptacion' || item.estado === 'incompatible' && item.tipo !== 'intolerancia')) return [];
        return resultados.filter(item => item.tipo === 'intolerancia' && item.estado === 'incompatible');
    });
    const evaluarCompatibilidad = nombre => {
        const resultados = analizar(nombre);
        // No autorizar nada si existe alergia, sustancia no apta o incertidumbre.
        const autorizado = item => item.tipo === 'intolerancia' && !item.composicionIncompleta && excepciones.some(excepcion =>
            normalizar(excepcion.ingrediente) === normalizar(nombre) && nombreRestriccion(excepcion.restriccion) === item.restriccion);
        const detalles = resultados.map(item => item.estado === 'incompatible' && autorizado(item)
            ? { ...item, estado: 'compatible', intoleranciaAutorizada: true } : item);
        const bloqueo = resultados.find(item => item.tipo === 'alergia' && item.estado === 'incompatible')
            || resultados.find(item => item.estado === 'incompatible' && !autorizado(item))
            || resultados.find(item => item.estado === 'requiere_adaptacion')
            || resultados.find(item => item.estado === 'no_verificable');
        if (bloqueo) return { ...bloqueo, resultados: detalles };
        const sinConflicto = resultados.find(item => item.estado === 'sin_conflicto_identificado');
        if (sinConflicto) return { ...sinConflicto, resultados: detalles };
        return { estado: 'compatible', ingrediente: nombre,
            resultados: detalles,
            ...(restricciones.length ? { evidencia: resolver(nombre).evidencia } : {}),
            ...(resultados.some(item => item.estado === 'incompatible' && autorizado(item))
                ? { intoleranciaAutorizada: true, restriccionesAutorizadas: resultados.filter(item => item.estado === 'incompatible' && autorizado(item)).map(item => item.restriccion) } : {}) };
    };
    const evaluaciones = new Map();
    const evaluar = nombre => {
        const clave = normalizar(nombre);
        if (evaluaciones.has(clave)) return { ...evaluaciones.get(clave), ingrediente: nombre };
        const identidad = resolver(nombre);
        const resultado = { ...evaluarCompatibilidad(nombre), identificacion: {
            reconocido: !identidad.motivo && (Boolean(identidad.dato) || identidad.existeEnCatalogo || esIngredienteCulinarioReconocido(identidad.clave) || esIngredienteCulinarioReconocido(identidad.canonico)),
            existeEnCatalogo: Boolean(identidad.existeEnCatalogo),
            estadoCatalogo: identidad.estadoCatalogo || null
        } };
        evaluaciones.set(clave, resultado);
        return resultado;
    };
    const permiteGeneracion = resultado => ['compatible', 'sin_conflicto_identificado'].includes(resultado.estado);
    const ingredientesConsulta = consulta => [...normalizar(consulta).matchAll(patronAlimentos())].map(item => item[2]);
    const filtrar = nombres => nombres.filter(nombre => permiteGeneracion(evaluar(nombre)));
    const patronAlimentos = (declarados = []) => new RegExp(`(^|[^a-z])(${[...new Set([...declarados, ...nombresCulinarios, ...perfilesCafeina.keys(), ...nombresBebidas, ...alimentos.keys(), ...variantesPresentacion.keys(), ...indice.keys(), 'sal y pimienta al gusto', 'sal y pimienta'])]
        .sort((a, b) => b.length - a.length).map(nombre => nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^a-z])`, 'g');
    const revisarConsulta = consulta => consulta;
    const diagnosticarReceta = receta => {
        receta = normalizarRecetaCulinaria(receta);
        const detallar = (evaluacion, origen) => {
            const { resultados: detalles, ...resumen } = evaluacion;
            return detalles?.length ? detalles.map(item => ({ ...item, identificacion: resumen.identificacion,
                ...(resumen.referenciaEnPaso ? { referenciaEnPaso: resumen.referenciaEnPaso } : {}), origen }))
                : [{ ...resumen, origen }];
        };
        const declarados = [...new Set((receta.ingredientes || []).map(i => normalizar(i.nombre)))];
        const resultados = (receta.ingredientes || []).flatMap(item => detallar(evaluar(item.nombre), 'ingredientes'));
        for (const sustitucion of receta.sustituciones || []) {
            if (typeof sustitucion?.alternativa === 'string') resultados.push(...detallar(evaluar(sustitucion.alternativa), 'sustituciones'));
        }
        for (const faltante of receta.ingredientesFaltantes || []) {
            // Solo quitar una cantidad y una unidad reconocibles; no cambiar el alimento.
            const nombre = typeof faltante === 'string'
                ? normalizar(faltante).replace(/^\d+(?:[.,]\d+)?\s*(?:kg|g|gr|ml|l|gramos?|kilogramos?|mililitros?|litros?|unidades?|un|tazas?|cucharadas?|cucharaditas?|cda|cdta)\b\s*(?:de\s+)?/, '')
                : faltante?.nombre;
            resultados.push(...detallar(evaluar(nombre), 'faltantes'));
        }
        // Los pasos tampoco pueden reintroducir alimentos omitidos de la lista.
        const pasosConAcentos = (receta.pasos || []).map(paso => typeof paso === 'string'
            ? paso : paso?.descripcion || paso?.instruccion || paso?.texto || '').join('. ')
            .normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
        const pasos = normalizar(pasosConAcentos);
        if (esSustanciaNoApta(pasos)) resultados.push({ estado: 'incompatible', tipo: 'sustancia_no_apta', ingrediente: 'Sustancia no apta en los pasos', origen: 'pasos' });
        for (const coincidencia of pasos.matchAll(patronAlimentos(declarados))) {
            // «Te recomiendo...» es un pronombre, no el ingrediente té. Admitir
            // te sin tilde si esta declarado o es complemento de una adicion.
            const inicio = coincidencia.index + coincidencia[1].length;
            if (coincidencia[2] === 'te' && !declarados.includes('te')
                && pasosConAcentos.slice(inicio, inicio + 2) !== 'té'
                && !/\b(?:agregar|anadir|incorporar|verter|mezclar|disolver)\s+(?:(?:el|un poco de)\s+)?$/.test(pasos.slice(0, inicio))) continue;
            const despues = pasos.slice(coincidencia.index + coincidencia[0].length);
            let descriptor = despues.match(/^\s+(?:con|sin|rellen[oa]|procesad[oa]|mezcla|compuest[oa]|sabor)\b.*?(?=\s+(?:para|hasta|durante|cuando|a fuego)\b|[.;:!?]|$)/);
            const combinacion = referenciasCombinacionPaso(despues);
            if (combinacion && declarados.includes(coincidencia[2])
                && combinacion.every(i => declarados.includes(normalizar(i.nombre)))) descriptor = null;
            // La separacion es sintactica, no un permiso alimentario. Incluso
            // un complemento incompatible debe evaluarse por su propio nombre.
            if (combinacion && evaluar(coincidencia[2]).identificacion.reconocido
                && combinacion.every(i => evaluar(i.nombre).identificacion.reconocido)) descriptor = null;
            for (const item of normalizarIngredienteCulinario(coincidencia[2] + (descriptor ? descriptor[0] : ''))) {
            let resultado = evaluar(item.nombre);
            // «La leche» puede referirse a la única leche declarada, pero no introduce
            // un permiso para otra leche ni para crema, polvo u otros derivados.
            if (!descriptor &&
                /^\s*(?:[.,;:!?)]|$|hasta\b|durante\b|y\b|con\b|para\b|a\b|a fuego\b)/.test(despues)) {
                const candidatos = declarados.filter(nombre => nombre === normalizar(item.nombre) || nombre.startsWith(`${normalizar(item.nombre)} `));
                if (candidatos.length === 1) {
                    const declarado = evaluar(candidatos[0]);
                    resultado = { ...declarado, referenciaEnPaso: coincidencia[2] };
                } else if (candidatos.length > 1) resultado = { estado: 'no_verificable', ingrediente: item.nombre, motivo: 'REFERENCIA_AMBIGUA' };
            }
            resultados.push(...detallar(resultado, 'pasos'));
            }
        }
        const agrupados = new Map();
        for (const resultado of resultados) {
            const identidad = resolver(resultado.ingrediente);
            const clave = JSON.stringify([identidad.canonico || identidad.clave, resultado.estado, resultado.tipo, resultado.restriccion, resultado.motivo]);
            const grupo = agrupados.get(clave) || { ...resultado, origenes: [] };
            if (!grupo.origenes.includes(resultado.origen)) grupo.origenes.push(resultado.origen);
            agrupados.set(clave, grupo);
        }
        return [...agrupados.values()];
    };
    const revisarReceta = receta => diagnosticarReceta(receta).filter(item => !permiteGeneracion(item));
    const nombresVerificables = () => [...new Set([...alimentos.keys(), ...variantesPresentacion.keys(), ...indice.keys()])]
        .filter(nombre => evaluar(nombre).estado === 'compatible');
    const alternativasVerificables = nombres => [...new Set(nombres)].map(nombre => {
        const identidad = resolver(nombre);
        const base = identidad.canonico || normalizar(nombre);
        return { solicitado: nombre, alternativas: nombresVerificables().filter(n =>
            normalizar(n).startsWith(`${base} sin `)
            || (!identidad.dato && !identidad.motivo && normalizar(n).startsWith(`${base} de `))),
            estado: evaluar(nombre).estado, requiereEleccionCulinaria: true };
    }).filter(item => !['compatible', 'sin_conflicto_identificado'].includes(item.estado));
    const prepararAdaptacion = nombres => ({
        restricciones: restricciones.map(r => ({ tipo: r.tipo, nombre: r.nombre })),
        // Relaciones de las restricciones activas, incluso si su ingrediente
        // no fue solicitado. No enviar IDs de usuarios ni inferir sustitutos.
        incompatibilidadesConocidas: [...new Map(vinculos.filter(f => restricciones.some(r =>
            r.tipo === f.tipo && r.nombre === nombreRestriccion(f.restriccion)))
            .map(f => { const dato = { tipo: f.tipo, restriccion: f.restriccion,
                ingrediente: f.ingrediente, ...(f.alias ? { alias: f.alias } : {}) };
                return [JSON.stringify(dato), dato]; })).values()],
        limitaciones: restricciones.filter(r => r.tipo === 'alergia' ? !alergiasConocidas.has(r.nombre) : !['lactosa', 'gluten', 'cafeina'].includes(r.nombre))
            .map(r => ({ tipo: r.tipo, nombre: r.nombre, motivo: 'No hay evidencia general suficiente; las relaciones positivas del catalogo siguen bloqueando incompatibilidades.' })),
        evaluaciones: [...new Set(nombres)].map(nombre => ({ ingrediente: nombre, resultado: evaluar(nombre), detalles: analizar(nombre) })),
        alternativasMismoAlimento: alternativasVerificables(nombres),
        ingredientesCompatibles: nombresVerificables()
    });
    return { evaluar, permiteGeneracion, filtrar, revisarConsulta, revisarReceta, diagnosticarReceta, conflictosIntolerancia, ingredientesConsulta, nombresVerificables, alternativasVerificables, prepararAdaptacion };
};

module.exports = { crearValidador, esIngredienteCulinarioReconocido };

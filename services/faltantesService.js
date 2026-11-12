// Aritmética decimal exacta. No convierte entre familias ni redondea déficits.
const escalado = (valor, precision) => {
    const texto = String(valor);
    const patron = new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`);
    if (!patron.test(texto)) throw Object.assign(new Error('Cantidad o factor no válido.'), { code: 'INVALID_DECIMAL' });
    const [entero, fraccion = ''] = texto.split('.');
    return BigInt(entero) * 10n ** BigInt(precision) + BigInt(fraccion.padEnd(precision, '0'));
};
const decimal = valor => `${valor / 1000n}${valor % 1000n ? '.' + String(valor % 1000n).padStart(3, '0').replace(/0+$/, '') : ''}`;
const calcularFaltante = (item, existencia, manual = false) => {
    const desconocido = motivo => ({ ...item, cantidad: null, id_unidad: null, motivo, estado: 'cantidad_no_verificable' });
    if (item.cantidad === null || !item.id_unidad) return desconocido('La receta no tiene una cantidad y unidad únicas. Indícalas antes de completar la compra.');
    if (item.familia !== item.familia_ingrediente) return desconocido('La receta usa otra familia de medida. No se convirtió: indica una cantidad y unidad compatibles antes de completar.');
    const requerida = escalado(item.cantidad, 3);
    const factor = escalado(item.factor_a_base, 6);
    if (factor <= 0n || requerida <= 0n) return desconocido('La cantidad o el factor no permiten calcular el faltante.');
    if (existencia) {
        if (existencia.familia !== item.familia) return desconocido('Las unidades de receta y despensa pertenecen a familias distintas.');
        const factorDisponible = escalado(existencia.factor_a_base, 6);
        const disponible = escalado(existencia.cantidad, 3) * factorDisponible;
        if (disponible >= requerida * factor) return null;
        if (manual) return desconocido('El ingrediente también fue indicado manualmente, sin cantidad disponible verificable.');
        const diferencia = requerida * factor - disponible;
        if (diferencia % factor !== 0n) return desconocido('El déficit no puede expresarse con tres decimales sin redondear.');
        return { ...item, cantidad: decimal(diferencia / factor), estado: 'faltante' };
    }
    if (manual) return desconocido('El ingrediente fue indicado manualmente, pero no conocemos su cantidad disponible.');
    return { ...item, cantidad: decimal(requerida), estado: 'faltante' };
};
module.exports = { calcularFaltante };

const db = require('../config/db');

// Guarda las alergias e intolerancias seleccionadas por un usuario.
const preferenciasModel = {
    obtenerVinculosRestricciones: async idUsuario => {
        const [filas] = await db.query(`
            SELECT 'alergia' AS tipo, c.nombre AS restriccion, i.nombre AS ingrediente, ia.alias
            FROM alergia_usuario u
            JOIN catalogo_alergia c ON c.id_alergia = u.id_alergia
            JOIN alergia_ingrediente ai ON ai.id_alergia = u.id_alergia
            JOIN ingrediente i ON i.id_ingrediente = ai.id_ingrediente
            LEFT JOIN ingrediente_alias ia ON ia.id_ingrediente = i.id_ingrediente
            WHERE u.id_usuario = ?
            UNION ALL
            SELECT 'intolerancia', c.nombre, i.nombre, ia.alias
            FROM intolerancia_usuario u
            JOIN catalogo_intolerancia c ON c.id_intolerancia = u.id_intolerancia
            JOIN intolerancia_ingrediente ti ON ti.id_intolerancia = u.id_intolerancia
            JOIN ingrediente i ON i.id_ingrediente = ti.id_ingrediente
            LEFT JOIN ingrediente_alias ia ON ia.id_ingrediente = i.id_ingrediente
            WHERE u.id_usuario = ?
        `, [idUsuario, idUsuario]);
        return filas;
    },

    obtenerRestricciones: async (id_usuario) => {
        const [filas] = await db.query(
            `SELECT 'alergia' AS tipo, c.nombre
             FROM alergia_usuario u
             INNER JOIN catalogo_alergia c ON c.id_alergia = u.id_alergia
             WHERE u.id_usuario = ?
             UNION ALL
             SELECT 'intolerancia' AS tipo, c.nombre
             FROM intolerancia_usuario u
             INNER JOIN catalogo_intolerancia c ON c.id_intolerancia = u.id_intolerancia
             WHERE u.id_usuario = ?`,
            [id_usuario, id_usuario]
        );
        if (filas.some(fila => typeof fila.nombre !== 'string' || !fila.nombre.trim())) {
            throw new Error('Las preferencias guardadas contienen un nombre inválido.');
        }
        return {
            alergias: filas.filter(fila => fila.tipo === 'alergia').map(fila => fila.nombre.trim()),
            intolerancias: filas.filter(fila => fila.tipo === 'intolerancia').map(fila => fila.nombre.trim())
        };
    },

    // Recupera los IDs de las preferencias actuales del usuario.
    obtenerPreferencias: async (id_usuario) => {
        const [alergias] = await db.query(
            'SELECT id_alergia FROM alergia_usuario WHERE id_usuario = ?',
            [id_usuario]
        );

        const [intolerancias] = await db.query(
            'SELECT id_intolerancia FROM intolerancia_usuario WHERE id_usuario = ?',
            [id_usuario]
        );

        return {
            alergias: alergias.map(fila => fila.id_alergia),
            intolerancias: intolerancias.map(fila => fila.id_intolerancia)
        };
    },

    guardarPreferencias: async (id_usuario, alergias, intolerancias, conexionCompartida = null) => {

        // Obtenemos una conexión del pool.
        const conexion = conexionCompartida || await db.getConnection();

        try {

            // Comenzamos una transacción.
            if (!conexionCompartida) await conexion.beginTransaction();

            // -------------------------------------------------
            // ELIMINAR ALERGIAS ANTERIORES
            // -------------------------------------------------

            await conexion.query(
                'DELETE FROM alergia_usuario WHERE id_usuario = ?',
                [id_usuario]
            );

            // -------------------------------------------------
            // GUARDAR NUEVAS ALERGIAS
            // -------------------------------------------------

            if (alergias.length > 0) {

                const valoresAlergias = alergias.map(id_alergia => [
                    id_usuario,
                    id_alergia
                ]);

                await conexion.query(
                    'INSERT INTO alergia_usuario (id_usuario, id_alergia) VALUES ?',
                    [valoresAlergias]
                );
            }

            // -------------------------------------------------
            // ELIMINAR INTOLERANCIAS ANTERIORES
            // -------------------------------------------------

            await conexion.query(
                'DELETE FROM intolerancia_usuario WHERE id_usuario = ?',
                [id_usuario]
            );

            // -------------------------------------------------
            // GUARDAR NUEVAS INTOLERANCIAS
            // -------------------------------------------------

            if (intolerancias.length > 0) {

                const valoresIntolerancias = intolerancias.map(id_intolerancia => [
                    id_usuario,
                    id_intolerancia
                ]);

                await conexion.query(
                    'INSERT INTO intolerancia_usuario (id_usuario, id_intolerancia) VALUES ?',
                    [valoresIntolerancias]
                );
            }

            // Confirmamos todos los cambios.
            if (!conexionCompartida) await conexion.commit();

        } catch (error) {

            // Si algo falla, deshacemos todos los cambios.
            if (!conexionCompartida) await conexion.rollback();

            throw error;

        } finally {

            // Liberamos la conexión.
            if (!conexionCompartida) conexion.release();
        }
    }
};

module.exports = preferenciasModel;

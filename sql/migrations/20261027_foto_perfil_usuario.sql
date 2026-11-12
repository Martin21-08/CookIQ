-- Ejecutar UNA vez en la base existente, tras revisión y respaldo.
-- No ejecutar schema.sql para actualizar una instalación existente.
ALTER TABLE usuario
    ADD COLUMN foto_perfil_ruta VARCHAR(255) NULL AFTER telefono;

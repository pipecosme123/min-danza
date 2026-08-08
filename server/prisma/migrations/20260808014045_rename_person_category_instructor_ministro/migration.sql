-- Rename PersonCategory enum values without losing existing data.
-- Postgres 10+ supports ALTER TYPE ... RENAME VALUE, which renames the
-- label of an existing enum value in place (the underlying OID / stored
-- value is unchanged), so every `person.category` row currently set to
-- 'ELEGIBLE_LIDER' or 'COLABORADOR' transparently becomes 'INSTRUCTOR' /
-- 'MINISTRO' with no UPDATE needed and no data loss.
ALTER TYPE "person_category" RENAME VALUE 'ELEGIBLE_LIDER' TO 'INSTRUCTOR';
ALTER TYPE "person_category" RENAME VALUE 'COLABORADOR' TO 'MINISTRO';

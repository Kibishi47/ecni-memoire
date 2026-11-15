-- Ajoute le type de signalement WEBSITE_ERROR pour les retours généraux sur le site (UI, Hub, textes, affichage)
ALTER TYPE bug_type_enum ADD VALUE IF NOT EXISTS 'WEBSITE_ERROR';

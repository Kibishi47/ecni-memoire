-- Migration initiale : Schéma Pokémon TCG Backend (cartes, decks méta, signalements de bugs)

-- ENUMS
CREATE TYPE bug_type_enum AS ENUM ('CARD_MODEL_ERROR', 'ENGINE_RULE_ERROR');
CREATE TYPE bug_status_enum AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX');

-- 1. TABLE CARDS
CREATE TABLE cards (
    id SERIAL PRIMARY KEY,
    card_id VARCHAR(32) NOT NULL UNIQUE,
    name_fr VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    set_id VARCHAR(16) NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cards_card_id ON cards(card_id);
CREATE INDEX idx_cards_data_gin ON cards USING GIN (data);

-- 2. TABLE DECKS
CREATE TABLE decks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    archetype VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_decks_is_active ON decks(is_active);

-- 3. TABLE CARD_DECK (Table de liaison)
CREATE TABLE card_deck (
    id_deck INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    id_card INT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
    count SMALLINT NOT NULL CHECK (count BETWEEN 1 AND 59),
    PRIMARY KEY (id_deck, id_card)
);

-- 4. TABLE BUG_REPORTS
CREATE TABLE bug_reports (
    id SERIAL PRIMARY KEY,
    type bug_type_enum NOT NULL,
    card_id VARCHAR(32) REFERENCES cards(card_id) ON DELETE SET NULL,
    match_logs JSONB,
    user_comment TEXT,
    github_issue_url VARCHAR(255),
    github_issue_number INT,
    status bug_status_enum DEFAULT 'OPEN',
    client_ip VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_bug_reports_created_at ON bug_reports(created_at);

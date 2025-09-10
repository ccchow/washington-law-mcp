import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '../../data/washington-laws.db');

export function addCourtRulesTables(): void {
  const db = new Database(DB_PATH);
  
  // Create court_rules table for IRLJ, CRLJ, etc.
  db.exec(`
    CREATE TABLE IF NOT EXISTS court_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_set TEXT NOT NULL,      -- 'IRLJ', 'CRLJ', etc.
      rule_number TEXT NOT NULL,    -- '1.1', '2.4', etc.
      rule_name TEXT,               -- 'Scope and Purpose of Rules'
      full_text TEXT NOT NULL,
      effective_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(rule_set, rule_number)
    );

    CREATE INDEX IF NOT EXISTS idx_court_rules_set ON court_rules(rule_set);
    CREATE INDEX IF NOT EXISTS idx_court_rules_number ON court_rules(rule_number);
  `);

  // Create FTS5 virtual table for court rules
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS court_rules_fts USING fts5(
      rule_set,
      rule_number,
      rule_name,
      full_text,
      content=court_rules,
      content_rowid=id
    );
  `);

  // Create triggers to keep FTS table in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS court_rules_ai AFTER INSERT ON court_rules BEGIN
      INSERT INTO court_rules_fts(rowid, rule_set, rule_number, rule_name, full_text)
      VALUES (new.id, new.rule_set, new.rule_number, new.rule_name, new.full_text);
    END;

    CREATE TRIGGER IF NOT EXISTS court_rules_ad AFTER DELETE ON court_rules BEGIN
      DELETE FROM court_rules_fts WHERE rowid = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS court_rules_au AFTER UPDATE ON court_rules BEGIN
      DELETE FROM court_rules_fts WHERE rowid = old.id;
      INSERT INTO court_rules_fts(rowid, rule_set, rule_number, rule_name, full_text)
      VALUES (new.id, new.rule_set, new.rule_number, new.rule_name, new.full_text);
    END;
  `);

  console.log('Court rules tables created successfully');
  db.close();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addCourtRulesTables();
}
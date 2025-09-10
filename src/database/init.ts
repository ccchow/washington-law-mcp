import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '../../data');
const DB_PATH = join(DATA_DIR, 'washington-laws.db');

export function initializeDatabase(): Database.Database {
  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  
  // Enable foreign keys and WAL mode for better performance
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Create RCW table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rcw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      citation TEXT UNIQUE NOT NULL,
      title_num TEXT NOT NULL,
      chapter_num TEXT NOT NULL,
      section_num TEXT NOT NULL,
      title_name TEXT,
      chapter_name TEXT,
      section_name TEXT,
      full_text TEXT NOT NULL,
      effective_date TEXT,
      last_amended TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_rcw_citation ON rcw(citation);
    CREATE INDEX IF NOT EXISTS idx_rcw_title ON rcw(title_num);
    CREATE INDEX IF NOT EXISTS idx_rcw_chapter ON rcw(chapter_num);
  `);

  // Create WAC table
  db.exec(`
    CREATE TABLE IF NOT EXISTS wac (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      citation TEXT UNIQUE NOT NULL,
      title_num TEXT NOT NULL,
      chapter_num TEXT NOT NULL,
      section_num TEXT NOT NULL,
      title_name TEXT,
      chapter_name TEXT,
      section_name TEXT,
      full_text TEXT NOT NULL,
      effective_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_wac_citation ON wac(citation);
    CREATE INDEX IF NOT EXISTS idx_wac_title ON wac(title_num);
    CREATE INDEX IF NOT EXISTS idx_wac_chapter ON wac(chapter_num);
  `);

  // Create FTS5 virtual tables for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS rcw_fts USING fts5(
      citation,
      title_name,
      chapter_name,
      section_name,
      full_text,
      content=rcw,
      content_rowid=id
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS wac_fts USING fts5(
      citation,
      title_name,
      chapter_name,
      section_name,
      full_text,
      content=wac,
      content_rowid=id
    );
  `);

  // Create triggers to keep FTS tables in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS rcw_ai AFTER INSERT ON rcw BEGIN
      INSERT INTO rcw_fts(rowid, citation, title_name, chapter_name, section_name, full_text)
      VALUES (new.id, new.citation, new.title_name, new.chapter_name, new.section_name, new.full_text);
    END;

    CREATE TRIGGER IF NOT EXISTS rcw_ad AFTER DELETE ON rcw BEGIN
      DELETE FROM rcw_fts WHERE rowid = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS rcw_au AFTER UPDATE ON rcw BEGIN
      DELETE FROM rcw_fts WHERE rowid = old.id;
      INSERT INTO rcw_fts(rowid, citation, title_name, chapter_name, section_name, full_text)
      VALUES (new.id, new.citation, new.title_name, new.chapter_name, new.section_name, new.full_text);
    END;

    CREATE TRIGGER IF NOT EXISTS wac_ai AFTER INSERT ON wac BEGIN
      INSERT INTO wac_fts(rowid, citation, title_name, chapter_name, section_name, full_text)
      VALUES (new.id, new.citation, new.title_name, new.chapter_name, new.section_name, new.full_text);
    END;

    CREATE TRIGGER IF NOT EXISTS wac_ad AFTER DELETE ON wac BEGIN
      DELETE FROM wac_fts WHERE rowid = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS wac_au AFTER UPDATE ON wac BEGIN
      DELETE FROM wac_fts WHERE rowid = old.id;
      INSERT INTO wac_fts(rowid, citation, title_name, chapter_name, section_name, full_text)
      VALUES (new.id, new.citation, new.title_name, new.chapter_name, new.section_name, new.full_text);
    END;
  `);

  // Create metadata table
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create scraper progress table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scraper_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title_num TEXT,
      chapter_num TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_scraper_type_status ON scraper_progress(type, status);
  `);

  console.log(`Database initialized at: ${DB_PATH}`);
  return db;
}

// Run initialization if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = initializeDatabase();
  
  // Set initial metadata
  const setMetadata = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  setMetadata.run('version', '1.0.0');
  setMetadata.run('last_update', new Date().toISOString());
  
  const stats = db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM rcw) as rcw_count,
      (SELECT COUNT(*) FROM wac) as wac_count
  `).get() as any;
  
  console.log('Database statistics:');
  console.log(`- RCW sections: ${stats.rcw_count}`);
  console.log(`- WAC sections: ${stats.wac_count}`);
  
  db.close();
}
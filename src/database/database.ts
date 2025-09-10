import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RCWSection, WACSection, SearchResult } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '../../data/washington-laws.db');

export class LawDatabase {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH, { readonly: true });
    this.db.pragma('journal_mode = WAL');
  }

  getRCW(citation: string): RCWSection | null {
    const stmt = this.db.prepare(`
      SELECT 
        citation,
        title_num as titleNum,
        chapter_num as chapterNum,
        section_num as sectionNum,
        title_name as titleName,
        chapter_name as chapterName,
        section_name as sectionName,
        full_text as fullText,
        effective_date as effectiveDate,
        last_amended as lastAmended
      FROM rcw
      WHERE citation = ?
    `);

    const result = stmt.get(citation) as RCWSection | undefined;
    return result || null;
  }

  getWAC(citation: string): WACSection | null {
    const stmt = this.db.prepare(`
      SELECT 
        citation,
        title_num as titleNum,
        chapter_num as chapterNum,
        section_num as sectionNum,
        title_name as titleName,
        chapter_name as chapterName,
        section_name as sectionName,
        full_text as fullText,
        effective_date as effectiveDate
      FROM wac
      WHERE citation = ?
    `);

    const result = stmt.get(citation) as WACSection | undefined;
    return result || null;
  }

  getCourtRule(ruleSet: string, ruleNumber: string): any | null {
    // First try exact match
    let stmt = this.db.prepare(`
      SELECT 
        rule_set as ruleSet,
        rule_number as ruleNumber,
        rule_name as ruleName,
        full_text as fullText,
        updated_at as updatedAt
      FROM court_rules
      WHERE rule_set = ? AND rule_number = ?
    `);

    let result = stmt.get(ruleSet, ruleNumber);
    
    // If no exact match and number doesn't contain a decimal, try adding .0
    if (!result && !ruleNumber.includes('.')) {
      result = stmt.get(ruleSet, ruleNumber + '.0');
    }
    
    return result || null;
  }

  listCourtRules(ruleSet?: string): Array<{ ruleSet: string; ruleNumber: string; ruleName: string }> {
    let stmt;
    if (ruleSet) {
      stmt = this.db.prepare(`
        SELECT 
          rule_set as ruleSet,
          rule_number as ruleNumber,
          rule_name as ruleName
        FROM court_rules
        WHERE rule_set = ?
        ORDER BY CAST(SUBSTR(rule_number, 1, INSTR(rule_number || '.', '.') - 1) AS INTEGER),
                 CAST(SUBSTR(rule_number, INSTR(rule_number || '.', '.') + 1) AS INTEGER)
      `);
      return stmt.all(ruleSet) as any[];
    } else {
      stmt = this.db.prepare(`
        SELECT 
          rule_set as ruleSet,
          rule_number as ruleNumber,
          rule_name as ruleName
        FROM court_rules
        ORDER BY rule_set,
                 CAST(SUBSTR(rule_number, 1, INSTR(rule_number || '.', '.') - 1) AS INTEGER),
                 CAST(SUBSTR(rule_number, INSTR(rule_number || '.', '.') + 1) AS INTEGER)
      `);
      return stmt.all() as any[];
    }
  }

  searchLaws(query: string, limit: number = 20): SearchResult[] {
    const results: SearchResult[] = [];
    const perTypeLimit = Math.floor(limit / 3);

    // Search RCW
    const rcwStmt = this.db.prepare(`
      SELECT 
        r.citation,
        r.title_name as titleName,
        r.chapter_name as chapterName,
        r.section_name as sectionName,
        snippet(rcw_fts, 4, '<b>', '</b>', '...', 64) as snippet,
        rank as score
      FROM rcw_fts
      JOIN rcw r ON rcw_fts.rowid = r.id
      WHERE rcw_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const rcwResults = rcwStmt.all(query, perTypeLimit) as any[];
    for (const row of rcwResults) {
      results.push({
        type: 'RCW',
        citation: row.citation,
        titleName: row.titleName,
        chapterName: row.chapterName,
        sectionName: row.sectionName,
        snippet: row.snippet,
        score: Math.abs(row.score)
      });
    }

    // Search WAC
    const wacStmt = this.db.prepare(`
      SELECT 
        w.citation,
        w.title_name as titleName,
        w.chapter_name as chapterName,
        w.section_name as sectionName,
        snippet(wac_fts, 4, '<b>', '</b>', '...', 64) as snippet,
        rank as score
      FROM wac_fts
      JOIN wac w ON wac_fts.rowid = w.id
      WHERE wac_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const wacResults = wacStmt.all(query, perTypeLimit) as any[];
    for (const row of wacResults) {
      results.push({
        type: 'WAC',
        citation: row.citation,
        titleName: row.titleName,
        chapterName: row.chapterName,
        sectionName: row.sectionName,
        snippet: row.snippet,
        score: Math.abs(row.score)
      });
    }

    // Search Court Rules
    try {
      const courtRulesStmt = this.db.prepare(`
        SELECT 
          cr.rule_set || ' ' || cr.rule_number as citation,
          cr.rule_set as titleName,
          cr.rule_name as sectionName,
          snippet(court_rules_fts, 3, '<b>', '</b>', '...', 64) as snippet,
          rank as score
        FROM court_rules_fts
        JOIN court_rules cr ON court_rules_fts.rowid = cr.id
        WHERE court_rules_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      const courtResults = courtRulesStmt.all(query, perTypeLimit) as any[];
      for (const row of courtResults) {
        results.push({
          type: 'Court Rule' as any,
          citation: row.citation,
          titleName: row.titleName,
          chapterName: '',
          sectionName: row.sectionName,
          snippet: row.snippet,
          score: Math.abs(row.score)
        });
      }
    } catch (e) {
      // Court rules table might not exist in older databases
    }

    // Sort combined results by score
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    return results.slice(0, limit);
  }

  listRCWTitles(): Array<{ titleNum: string; titleName: string; count: number }> {
    const stmt = this.db.prepare(`
      SELECT 
        title_num as titleNum,
        title_name as titleName,
        COUNT(*) as count
      FROM rcw
      GROUP BY title_num, title_name
      ORDER BY CAST(title_num AS INTEGER), title_num
    `);

    return stmt.all() as any[];
  }

  listRCWChapters(titleNum: string): Array<{ chapterNum: string; chapterName: string; count: number }> {
    const stmt = this.db.prepare(`
      SELECT 
        chapter_num as chapterNum,
        chapter_name as chapterName,
        COUNT(*) as count
      FROM rcw
      WHERE title_num = ?
      GROUP BY chapter_num, chapter_name
      ORDER BY chapter_num
    `);

    return stmt.all(titleNum) as any[];
  }

  listRCWSections(chapterNum: string): Array<{ citation: string; sectionName: string }> {
    const stmt = this.db.prepare(`
      SELECT 
        citation,
        section_name as sectionName
      FROM rcw
      WHERE chapter_num = ?
      ORDER BY citation
    `);

    return stmt.all(chapterNum) as any[];
  }

  getStatistics(): { rcwCount: number; wacCount: number; courtRulesCount: number; lastUpdate: string } {
    const stats = this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM rcw) as rcwCount,
        (SELECT COUNT(*) FROM wac) as wacCount,
        (SELECT COUNT(*) FROM court_rules) as courtRulesCount,
        (SELECT value FROM metadata WHERE key = 'last_update') as lastUpdate
    `).get() as any;

    return {
      rcwCount: stats.rcwCount || 0,
      wacCount: stats.wacCount || 0,
      courtRulesCount: stats.courtRulesCount || 0,
      lastUpdate: stats.lastUpdate || 'Unknown'
    };
  }

  close(): void {
    this.db.close();
  }
}
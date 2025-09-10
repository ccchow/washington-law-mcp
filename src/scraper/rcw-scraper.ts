import axios from 'axios';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import pLimit from 'p-limit';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RCWSection } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://app.leg.wa.gov';
const RCW_URL = `${BASE_URL}/RCW/`;
const DB_PATH = join(__dirname, '../../data/washington-laws.db');

// Rate limiting to be respectful
const limit = pLimit(2); // Max 2 concurrent requests
const DELAY_MS = 500; // Delay between requests

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class RCWScraper {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private updateProgressStmt: Database.Statement;

  constructor() {
    this.db = new Database(DB_PATH);
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO rcw (
        citation, title_num, chapter_num, section_num,
        title_name, chapter_name, section_name, full_text,
        effective_date, last_amended, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    this.updateProgressStmt = this.db.prepare(`
      INSERT OR REPLACE INTO scraper_progress (type, title_num, chapter_num, status, error_message, updated_at)
      VALUES ('RCW', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
  }

  async scrapeAllTitles(): Promise<void> {
    console.log('Starting RCW scraper...');
    console.log('Fetching list of titles...');

    try {
      const response = await axios.get(RCW_URL);
      const $ = cheerio.load(response.data);
      
      // Find all title links
      const titleLinks: { num: string; name: string; url: string }[] = [];
      
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        // Match title links like "default.aspx?cite=1" or "default.aspx?cite=1A"
        if (href && /default\.aspx\?cite=\d+[A-Z]?$/i.test(href)) {
          const match = href.match(/cite=(\d+[A-Z]?)$/i);
          if (match) {
            titleLinks.push({
              num: match[1],
              name: text,
              url: `${RCW_URL}${href}`
            });
          }
        }
      });

      console.log(`Found ${titleLinks.length} titles to scrape`);

      // Process each title
      for (const title of titleLinks) {
        console.log(`\nProcessing Title ${title.num}: ${title.name}`);
        await this.scrapeTitle(title.num, title.name, title.url);
        await delay(DELAY_MS);
      }

      console.log('\nRCW scraping completed!');
      this.printStats();
    } catch (error) {
      console.error('Error scraping titles:', error);
      throw error;
    } finally {
      this.db.close();
    }
  }

  async scrapeTitle(titleNum: string, titleName: string, titleUrl: string): Promise<void> {
    try {
      const response = await axios.get(titleUrl);
      const $ = cheerio.load(response.data);
      
      // Find all chapter links within this title
      const chapterLinks: { num: string; name: string; url: string }[] = [];
      
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        // Skip PDF links
        if (href && href.includes('pdf=true')) return;
        
        // Match chapter links like "default.aspx?cite=1.01" or absolute URLs
        const chapterPattern = new RegExp(`cite=${titleNum}\\.\\d+(?:\\.\\d+)?`, 'i');
        if (href && chapterPattern.test(href)) {
          const match = href.match(/cite=([\d.]+[A-Z]?)/i);
          if (match) {
            // Handle both relative and absolute URLs
            const url = href.startsWith('http') ? href : `${RCW_URL}${href}`;
            chapterLinks.push({
              num: match[1],
              name: text,
              url: url
            });
          }
        }
      });

      console.log(`  Found ${chapterLinks.length} chapters in Title ${titleNum}`);

      // Process chapters with rate limiting
      const chapterPromises = chapterLinks.map(chapter => 
        limit(async () => {
          await this.scrapeChapter(titleNum, titleName, chapter.num, chapter.name, chapter.url);
          await delay(DELAY_MS);
        })
      );

      await Promise.all(chapterPromises);
      
      this.updateProgressStmt.run(titleNum, null, 'completed', null);
    } catch (error) {
      console.error(`Error scraping title ${titleNum}:`, error);
      this.updateProgressStmt.run(titleNum, null, 'error', (error as Error).message);
    }
  }

  async scrapeChapter(
    titleNum: string,
    titleName: string,
    chapterNum: string,
    chapterName: string,
    chapterUrl: string
  ): Promise<void> {
    try {
      const response = await axios.get(chapterUrl);
      const $ = cheerio.load(response.data);
      
      // Find all section links within this chapter
      const sectionLinks: { num: string; name: string; url: string }[] = [];
      
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        // Skip PDF links
        if (href && href.includes('pdf=true')) return;
        
        // Match section links like "default.aspx?cite=1.01.010"
        const sectionPattern = new RegExp(`cite=${chapterNum.replace('.', '\\.')}\\.\\d+`, 'i');
        if (href && sectionPattern.test(href)) {
          const match = href.match(/cite=([\d.]+)/);
          if (match && !sectionLinks.find(s => s.num === match[1])) {
            // Handle both relative and absolute URLs
            const url = href.startsWith('http') ? href : `${RCW_URL}${href}`;
            sectionLinks.push({
              num: match[1],
              name: text,
              url: url
            });
          }
        }
      });

      console.log(`    Chapter ${chapterNum}: ${sectionLinks.length} sections`);

      // Process sections with rate limiting
      const sectionPromises = sectionLinks.map(section =>
        limit(async () => {
          await this.scrapeSection(
            titleNum, titleName,
            chapterNum, chapterName,
            section.num, section.name, section.url
          );
          await delay(DELAY_MS);
        })
      );

      await Promise.all(sectionPromises);
      
      this.updateProgressStmt.run(null, chapterNum, 'completed', null);
    } catch (error) {
      console.error(`Error scraping chapter ${chapterNum}:`, error);
      this.updateProgressStmt.run(null, chapterNum, 'error', (error as Error).message);
    }
  }

  async scrapeSection(
    titleNum: string,
    titleName: string,
    chapterNum: string,
    chapterName: string,
    sectionNum: string,
    sectionName: string,
    sectionUrl: string
  ): Promise<void> {
    try {
      console.log(`      Scraping section ${sectionNum}...`);
      const response = await axios.get(sectionUrl);
      const $ = cheerio.load(response.data);
      
      // Extract the full text of the section
      let fullText = '';
      
      // Remove all script and style tags first
      $('script, style, nav, .navigation, .breadcrumb, .footer, .header').remove();
      
      // Try to get just the body text
      fullText = $('body').text()
        .replace(/\s+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Make sure we have content
      if (!fullText || fullText.length < 50) {
        console.warn(`      Warning: Section ${sectionNum} has very little content (${fullText.length} chars)`);
      }

      // Extract effective date if present
      let effectiveDate: string | undefined;
      const effectiveDateMatch = fullText.match(/\[(\d{4}) c \d+ § \d+(?:; )?([^\]]*)\]/);
      if (effectiveDateMatch) {
        effectiveDate = effectiveDateMatch[0];
      }

      // Save to database
      const result = this.insertStmt.run(
        sectionNum,           // citation
        titleNum,             // title_num
        chapterNum,           // chapter_num
        sectionNum.split('.').pop(), // section_num
        titleName || '',      // title_name
        chapterName || '',    // chapter_name
        sectionName || '',    // section_name
        fullText || '',       // full_text
        effectiveDate || null,// effective_date
        null                  // last_amended
      );
      
      if (result.changes > 0) {
        console.log(`      ✓ Saved section ${sectionNum}`);
      } else {
        console.warn(`      Warning: Failed to save section ${sectionNum}`);
      }

    } catch (error) {
      console.error(`      Error scraping section ${sectionNum}:`, error);
    }
  }

  private printStats(): void {
    const stats = this.db.prepare(`
      SELECT COUNT(*) as count FROM rcw
    `).get() as any;
    
    console.log(`\nScraping complete! Total RCW sections: ${stats.count}`);
  }
}

// Run the scraper
if (import.meta.url === `file://${process.argv[1]}`) {
  const scraper = new RCWScraper();
  scraper.scrapeAllTitles().catch(console.error);
}
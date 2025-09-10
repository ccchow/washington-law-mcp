import axios from 'axios';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://app.leg.wa.gov';
const RCW_URL = `${BASE_URL}/RCW/`;
const DB_PATH = join(__dirname, '../../data/washington-laws.db');

// Simplified scraper focusing on getting the data
class SimpleRCWScraper {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  
  constructor() {
    this.db = new Database(DB_PATH);
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO rcw (
        citation, title_num, chapter_num, section_num,
        title_name, chapter_name, section_name, full_text,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
  }

  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async scrapeAll(): Promise<void> {
    console.log('Starting simplified RCW scraper...');
    
    // Start with just a few specific titles for testing
    const testTitles = [
      { num: '1', name: 'General Provisions' },
      { num: '9', name: 'Crimes and Punishments' },
      { num: '9A', name: 'Criminal Code' },
      { num: '46', name: 'Motor Vehicles' }
    ];

    for (const title of testTitles) {
      console.log(`\nProcessing Title ${title.num}: ${title.name}`);
      await this.scrapeTitle(title.num, title.name);
      await this.delay(1000); // Be respectful
    }

    this.printStats();
    this.db.close();
  }

  async scrapeTitle(titleNum: string, titleName: string): Promise<void> {
    try {
      const url = `${RCW_URL}default.aspx?cite=${titleNum}`;
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      
      // Find all unique chapter numbers
      const chapters = new Set<string>();
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        if (href && href.includes(`cite=${titleNum}.`)) {
          const match = href.match(/cite=([\d.A-Z]+)/i);
          if (match) {
            const cite = match[1];
            // Extract chapter number (e.g., "46.61" from "46.61.502")
            const parts = cite.split('.');
            if (parts.length >= 2) {
              const chapterNum = `${parts[0]}.${parts[1]}`;
              chapters.add(chapterNum);
            }
          }
        }
      });

      console.log(`  Found ${chapters.size} chapters`);
      
      // Process each chapter
      for (const chapterNum of Array.from(chapters).sort()) {
        await this.scrapeChapter(titleNum, titleName, chapterNum);
        await this.delay(500);
      }
    } catch (error) {
      console.error(`Error scraping title ${titleNum}:`, error);
    }
  }

  async scrapeChapter(titleNum: string, titleName: string, chapterNum: string): Promise<void> {
    try {
      const url = `${RCW_URL}default.aspx?cite=${chapterNum}`;
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      
      // Extract chapter name
      const chapterName = $('title').text().replace(/^Chapter [\d.]+ RCW: /, '').trim() || '';
      
      // Find all section links
      const sections = new Set<string>();
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        if (href && href.includes(`cite=${chapterNum}.`) && !href.includes('pdf=true')) {
          const match = href.match(/cite=([\d.]+)/);
          if (match) {
            sections.add(match[1]);
          }
        }
      });

      console.log(`    Chapter ${chapterNum}: ${sections.size} sections`);
      
      // Process each section
      let count = 0;
      for (const sectionNum of Array.from(sections).sort()) {
        await this.scrapeSection(titleNum, titleName, chapterNum, chapterName, sectionNum);
        count++;
        if (count % 10 === 0) {
          console.log(`      Processed ${count}/${sections.size} sections`);
        }
        await this.delay(200); // Small delay between sections
      }
    } catch (error) {
      console.error(`Error scraping chapter ${chapterNum}:`, error);
    }
  }

  async scrapeSection(
    titleNum: string,
    titleName: string,
    chapterNum: string,
    chapterName: string,
    sectionNum: string
  ): Promise<void> {
    try {
      const url = `${RCW_URL}default.aspx?cite=${sectionNum}`;
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      
      // Extract section name from title or heading
      const pageTitle = $('title').text();
      const sectionName = pageTitle.replace(/^RCW [\d.]+/, '').replace(/[—–-]/, '').trim() || '';
      
      // Remove all navigation and script elements
      $('script, style, nav, .navigation, .breadcrumb, .footer, .header, .menu').remove();
      
      // Get the main text content
      let fullText = $('body').text()
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Try to extract just the law text (remove menu items, etc.)
      const startMarkers = ['RCW ' + sectionNum, sectionNum + ' >>', 'PDF'];
      for (const marker of startMarkers) {
        const idx = fullText.indexOf(marker);
        if (idx > 0) {
          fullText = fullText.substring(idx);
          break;
        }
      }
      
      // Clean up common navigation text
      fullText = fullText
        .replace(/Menu Website Search.*?PDF/g, '')
        .replace(/Beginning of Chapter.*?>>/g, '')
        .replace(/<<.*?>>/g, '')
        .trim();
      
      // Save to database
      this.insertStmt.run(
        sectionNum,
        titleNum,
        chapterNum,
        sectionNum.split('.').pop() || '',
        titleName,
        chapterName,
        sectionName,
        fullText
      );
      
    } catch (error) {
      console.error(`Error scraping section ${sectionNum}:`, (error as Error).message);
    }
  }

  private printStats(): void {
    const stats = this.db.prepare('SELECT COUNT(*) as count FROM rcw').get() as any;
    console.log(`\nScraping complete! Total RCW sections: ${stats.count}`);
  }
}

// Run the scraper
if (import.meta.url === `file://${process.argv[1]}`) {
  const scraper = new SimpleRCWScraper();
  scraper.scrapeAll().catch(console.error);
}
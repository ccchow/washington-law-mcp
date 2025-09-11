import axios from 'axios';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '../../data/washington-laws.db');
const BASE_URL = 'https://www.courts.wa.gov';

interface RALJRule {
  ruleSet: string;
  ruleNumber: string;
  ruleName: string;
  pdfUrl: string;
}

class RALJScraper {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  
  constructor() {
    this.db = new Database(DB_PATH);
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO court_rules (
        rule_set, rule_number, rule_name, full_text, updated_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
  }

  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async scrapeAll(): Promise<void> {
    console.log('Starting RALJ (Rules for Appeal of Decisions of Courts of Limited Jurisdiction) scraper...\n');
    
    await this.scrapeRALJ();
    
    this.printStats();
    this.db.close();
  }

  async scrapeRALJ(): Promise<void> {
    console.log('Processing RALJ - Rules for Appeal of Decisions of Courts of Limited Jurisdiction');
    
    try {
      // Get list of RALJ rules
      const listUrl = `${BASE_URL}/court_rules/?fa=court_rules.list&group=clj&set=RALJ`;
      console.log(`  Fetching rule list from: ${listUrl}`);
      
      const response = await axios.get(listUrl);
      const $ = cheerio.load(response.data);
      
      const rules: RALJRule[] = [];
      
      // Find all PDF links for RALJ rules
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        // Match PDF links like "../court_rules/pdf/RALJ/CLJ_RALJ_01_01_00.pdf"
        if (href && href.includes('.pdf') && href.includes('RALJ')) {
          // Extract rule number from filename (e.g., CLJ_RALJ_01_01_00.pdf -> 1.1)
          const fileMatch = href.match(/CLJ_RALJ_(\d+)_(\d+)_(\d+)\.pdf/i);
          if (fileMatch) {
            // Build rule number (e.g., 1.1 or 1.1a if third part is not 00)
            let ruleNumber = `${parseInt(fileMatch[1])}.${parseInt(fileMatch[2])}`;
            
            // Handle sub-rules if the third part is not 00
            if (fileMatch[3] !== '00') {
              // Some rules might have sub-parts like 1.1(a), but for RALJ they typically don't
              // We'll handle them as decimal extensions if they exist
              const subPart = parseInt(fileMatch[3]);
              if (subPart > 0) {
                ruleNumber += `.${subPart}`;
              }
            }
            
            // Build full URL
            let pdfUrl = href;
            if (href.startsWith('../')) {
              pdfUrl = `${BASE_URL}/${href.substring(3)}`;
            } else if (!href.startsWith('http')) {
              pdfUrl = `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
            }
            
            // Extract rule name from text
            let ruleName = text;
            // Remove "RALJ X.X" prefix if present
            ruleName = ruleName.replace(/^RALJ\s+[\d.]+\s*[-–]?\s*/i, '').trim();
            if (!ruleName || ruleName === text) {
              // Try to extract from the full text
              const nameMatch = text.match(/RALJ\s+[\d.]+\s*[-–]\s*(.+)/i);
              if (nameMatch) {
                ruleName = nameMatch[1].trim();
              } else {
                ruleName = `Rule ${ruleNumber}`;
              }
            }
            
            // Avoid duplicates
            if (!rules.find(r => r.ruleNumber === ruleNumber)) {
              rules.push({
                ruleSet: 'RALJ',
                ruleNumber,
                ruleName,
                pdfUrl
              });
            }
          }
        }
      });

      console.log(`  Found ${rules.length} RALJ rules to download and parse`);
      
      // Sort rules by rule number for better progress tracking
      rules.sort((a, b) => {
        const aParts = a.ruleNumber.split('.');
        const bParts = b.ruleNumber.split('.');
        
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aNum = parseInt(aParts[i] || '0');
          const bNum = parseInt(bParts[i] || '0');
          if (aNum !== bNum) return aNum - bNum;
        }
        return 0;
      });
      
      // Download and parse each PDF
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        console.log(`    Processing RALJ ${rule.ruleNumber}: ${rule.ruleName}...`);
        
        try {
          await this.downloadAndParseRule(rule);
        } catch (error) {
          console.error(`      Error: ${(error as Error).message}`);
        }
        
        if ((i + 1) % 5 === 0) {
          console.log(`    Processed ${i + 1}/${rules.length} rules`);
        }
        
        await this.delay(300); // Be respectful to the server
      }
      
      console.log(`  ✓ Completed RALJ: ${rules.length} rules`);
      
    } catch (error) {
      console.error(`Error scraping RALJ:`, error);
    }
  }

  async downloadAndParseRule(rule: RALJRule): Promise<void> {
    try {
      // Download PDF
      const response = await axios.get(rule.pdfUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      
      // Convert to Uint8Array for pdfjs-dist
      const pdfData = new Uint8Array(response.data);
      
      // Load PDF document
      const loadingTask = getDocument({ data: pdfData });
      const pdf = await loadingTask.promise;
      
      // Extract text from all pages
      let fullText = '';
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += pageText + '\n';
      }
      
      // Clean up the text
      fullText = fullText
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Try to extract just the rule content (remove headers/footers)
      const ruleStart = fullText.search(new RegExp(`RALJ\\s+${rule.ruleNumber.replace(/\./g, '\\.')}`, 'i'));
      if (ruleStart > 0 && ruleStart < 100) {
        fullText = fullText.substring(ruleStart);
      }
      
      // Remove common footer/header text
      fullText = fullText
        .replace(/Page \d+ of \d+/gi, '')
        .replace(/Effective \d+\/\d+\/\d+/gi, '')
        .replace(/\[.*?Reserved\]/gi, '')
        .trim();
      
      // Try to extract a better rule name from the PDF content if needed
      if (rule.ruleName === `Rule ${rule.ruleNumber}`) {
        const nameMatch = fullText.match(new RegExp(`RALJ\\s+${rule.ruleNumber.replace(/\./g, '\\.')}\\s*[-–]?\\s*([A-Z][^.\\n]+)`, 'i'));
        if (nameMatch) {
          rule.ruleName = nameMatch[1].trim();
        }
      }
      
      // Save to database
      this.insertStmt.run(
        rule.ruleSet,
        rule.ruleNumber,
        rule.ruleName,
        fullText
      );
      
    } catch (error) {
      throw new Error(`Failed to process PDF for RALJ ${rule.ruleNumber}: ${(error as Error).message}`);
    }
  }

  private printStats(): void {
    const raljCount = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM court_rules 
      WHERE rule_set = 'RALJ'
    `).get() as any;
    
    console.log('\n=== RALJ Scraping Complete ===');
    console.log(`  RALJ: ${raljCount.count} rules`);
    
    const total = this.db.prepare('SELECT COUNT(*) as count FROM court_rules').get() as any;
    console.log(`  Total court rules in database: ${total.count}`);
  }
}

// Run the scraper
if (import.meta.url === `file://${process.argv[1]}`) {
  const scraper = new RALJScraper();
  scraper.scrapeAll().catch(console.error);
}
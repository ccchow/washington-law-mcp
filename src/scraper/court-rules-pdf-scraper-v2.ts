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

interface CourtRulePDF {
  ruleSet: string;
  ruleNumber: string;
  ruleName: string;
  pdfUrl: string;
}

class CourtRulesPDFScraperV2 {
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
    console.log('Starting Court Rules PDF scraper (v2)...\n');
    
    // Scrape IRLJ rules
    await this.scrapeRuleSet('IRLJ', 'Infraction Rules for Courts of Limited Jurisdiction');
    
    // Scrape CRLJ rules  
    await this.scrapeRuleSet('CRLJ', 'Civil Rules for Courts of Limited Jurisdiction');
    
    this.printStats();
    this.db.close();
  }

  async scrapeRuleSet(ruleSet: string, description: string): Promise<void> {
    console.log(`\nProcessing ${ruleSet} - ${description}`);
    
    try {
      // Get list of PDF rules
      const listUrl = `${BASE_URL}/court_rules/?fa=court_rules.list&group=clj&set=${ruleSet}`;
      console.log(`  Fetching rule list from: ${listUrl}`);
      
      const response = await axios.get(listUrl);
      const $ = cheerio.load(response.data);
      
      const rules: CourtRulePDF[] = [];
      
      // Find all PDF links
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        // Match PDF links like "../court_rules/pdf/IRLJ/CLJ_IRLJ_01_01_00.pdf"
        if (href && href.includes('.pdf') && href.includes(ruleSet)) {
          // Extract rule number from filename
          const fileMatch = href.match(/CLJ_[A-Z]+_(\d+)_(\d+)_\d+\.pdf/i);
          if (fileMatch) {
            const ruleNumber = `${parseInt(fileMatch[1])}.${parseInt(fileMatch[2])}`;
            
            // Build full URL
            let pdfUrl = href;
            if (href.startsWith('../')) {
              pdfUrl = `${BASE_URL}/${href.substring(3)}`;
            } else if (!href.startsWith('http')) {
              pdfUrl = `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
            }
            
            // Extract rule name from text or use default
            const ruleName = text.replace(new RegExp(`${ruleSet}\\s+${ruleNumber}\\s*`, 'i'), '').trim() || 
                           `Rule ${ruleNumber}`;
            
            // Avoid duplicates
            if (!rules.find(r => r.ruleNumber === ruleNumber)) {
              rules.push({
                ruleSet,
                ruleNumber,
                ruleName,
                pdfUrl
              });
            }
          }
        }
      });

      console.log(`  Found ${rules.length} PDF rules to download and parse`);
      
      // Download and parse each PDF
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        console.log(`    Processing ${ruleSet} ${rule.ruleNumber}...`);
        
        try {
          await this.downloadAndParseRule(rule);
        } catch (error) {
          console.error(`      Error: ${(error as Error).message}`);
        }
        
        if ((i + 1) % 5 === 0) {
          console.log(`    Processed ${i + 1}/${rules.length} rules`);
        }
        
        await this.delay(500); // Be respectful
      }
      
      console.log(`  ✓ Completed ${ruleSet}: ${rules.length} rules`);
      
    } catch (error) {
      console.error(`Error scraping ${ruleSet}:`, error);
    }
  }

  async downloadAndParseRule(rule: CourtRulePDF): Promise<void> {
    try {
      // Download PDF
      const response = await axios.get(rule.pdfUrl, {
        responseType: 'arraybuffer'
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
      const ruleStart = fullText.search(new RegExp(`${rule.ruleSet}\\s+${rule.ruleNumber}`, 'i'));
      if (ruleStart > 0) {
        fullText = fullText.substring(ruleStart);
      }
      
      // Remove common footer text
      fullText = fullText
        .replace(/Page \d+ of \d+/gi, '')
        .replace(/Effective \d+\/\d+\/\d+/gi, '')
        .trim();
      
      // Extract rule name from the text if not already set
      if (!rule.ruleName || rule.ruleName === `Rule ${rule.ruleNumber}`) {
        const nameMatch = fullText.match(new RegExp(`${rule.ruleSet}\\s+${rule.ruleNumber}\\s+([A-Z][^.]+)`, 'i'));
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
      throw new Error(`Failed to process PDF: ${(error as Error).message}`);
    }
  }

  private printStats(): void {
    const stats = this.db.prepare(`
      SELECT rule_set, COUNT(*) as count 
      FROM court_rules 
      GROUP BY rule_set
    `).all() as any[];
    
    console.log('\n=== Court Rules PDF Scraping Complete ===');
    for (const stat of stats) {
      console.log(`  ${stat.rule_set}: ${stat.count} rules`);
    }
    
    const total = this.db.prepare('SELECT COUNT(*) as count FROM court_rules').get() as any;
    console.log(`  Total: ${total.count} court rules`);
  }
}

// Run the scraper
if (import.meta.url === `file://${process.argv[1]}`) {
  const scraper = new CourtRulesPDFScraperV2();
  scraper.scrapeAll().catch(console.error);
}
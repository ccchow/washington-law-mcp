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

interface RPCRule {
  ruleSet: string;
  ruleNumber: string;
  ruleName: string;
  pdfUrl: string;
}

class RPCScraper {
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
    console.log('Starting RPC (Rules of Professional Conduct) scraper...\n');
    
    await this.scrapeRPC();
    
    this.printStats();
    this.db.close();
  }

  async scrapeRPC(): Promise<void> {
    console.log('Processing RPC - Rules of Professional Conduct');
    
    try {
      // Get list of RPC rules
      const listUrl = `${BASE_URL}/court_rules/?fa=court_rules.list&group=ga&set=RPC`;
      console.log(`  Fetching rule list from: ${listUrl}`);
      
      const response = await axios.get(listUrl);
      const $ = cheerio.load(response.data);
      
      const rules: RPCRule[] = [];
      
      // Find all PDF links for RPC rules
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        // Match PDF links like "/court_rules/pdf/RPC/GA_RPC_01_07_00.pdf"
        if (href && href.includes('.pdf') && href.includes('RPC')) {
          // Extract rule number from filename (e.g., GA_RPC_01_07_00.pdf -> 1.7)
          const fileMatch = href.match(/GA_RPC_(\d+)_(\d+)_(\d+)\.pdf/i);
          if (fileMatch) {
            // Build rule number (e.g., 1.7 or 1.7a if third part is not 00)
            let ruleNumber = `${parseInt(fileMatch[1])}.${parseInt(fileMatch[2])}`;
            if (fileMatch[3] !== '00') {
              // Handle sub-rules like 1.7a
              const subRule = String.fromCharCode(96 + parseInt(fileMatch[3])); // Convert to letter
              ruleNumber += subRule;
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
            // Remove "RPC X.X" prefix if present
            ruleName = ruleName.replace(/^RPC\s+[\d.]+[a-z]?\s*[-–]\s*/i, '').trim();
            if (!ruleName || ruleName === text) {
              // Try to extract from the full text
              const nameMatch = text.match(/RPC\s+[\d.]+[a-z]?\s*[-–]\s*(.+)/i);
              if (nameMatch) {
                ruleName = nameMatch[1].trim();
              } else {
                ruleName = `Rule ${ruleNumber}`;
              }
            }
            
            // Avoid duplicates
            if (!rules.find(r => r.ruleNumber === ruleNumber)) {
              rules.push({
                ruleSet: 'RPC',
                ruleNumber,
                ruleName,
                pdfUrl
              });
            }
          }
        }
      });

      console.log(`  Found ${rules.length} RPC rules to download and parse`);
      
      // Sort rules by rule number for better progress tracking
      rules.sort((a, b) => {
        const aParts = a.ruleNumber.match(/(\d+)\.(\d+)([a-z]?)/);
        const bParts = b.ruleNumber.match(/(\d+)\.(\d+)([a-z]?)/);
        if (aParts && bParts) {
          const aMain = parseInt(aParts[1]) * 1000 + parseInt(aParts[2]);
          const bMain = parseInt(bParts[1]) * 1000 + parseInt(bParts[2]);
          if (aMain !== bMain) return aMain - bMain;
          return (aParts[3] || '').localeCompare(bParts[3] || '');
        }
        return a.ruleNumber.localeCompare(b.ruleNumber);
      });
      
      // Download and parse each PDF
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        console.log(`    Processing RPC ${rule.ruleNumber}: ${rule.ruleName}...`);
        
        try {
          await this.downloadAndParseRule(rule);
        } catch (error) {
          console.error(`      Error: ${(error as Error).message}`);
        }
        
        if ((i + 1) % 10 === 0) {
          console.log(`    Processed ${i + 1}/${rules.length} rules`);
        }
        
        await this.delay(300); // Be respectful to the server
      }
      
      console.log(`  ✓ Completed RPC: ${rules.length} rules`);
      
    } catch (error) {
      console.error(`Error scraping RPC:`, error);
    }
  }

  async downloadAndParseRule(rule: RPCRule): Promise<void> {
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
      const ruleStart = fullText.search(new RegExp(`RPC\\s+${rule.ruleNumber.replace('.', '\\.')}`, 'i'));
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
        const nameMatch = fullText.match(new RegExp(`RPC\\s+${rule.ruleNumber.replace('.', '\\.')}\\s*[-–]?\\s*([A-Z][^.\\n]+)`, 'i'));
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
      throw new Error(`Failed to process PDF for RPC ${rule.ruleNumber}: ${(error as Error).message}`);
    }
  }

  private printStats(): void {
    const rpcCount = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM court_rules 
      WHERE rule_set = 'RPC'
    `).get() as any;
    
    console.log('\n=== RPC Scraping Complete ===');
    console.log(`  RPC: ${rpcCount.count} rules`);
    
    const total = this.db.prepare('SELECT COUNT(*) as count FROM court_rules').get() as any;
    console.log(`  Total court rules in database: ${total.count}`);
  }
}

// Run the scraper
if (import.meta.url === `file://${process.argv[1]}`) {
  const scraper = new RPCScraper();
  scraper.scrapeAll().catch(console.error);
}
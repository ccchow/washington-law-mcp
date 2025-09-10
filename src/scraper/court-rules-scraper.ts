import axios from 'axios';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '../../data/washington-laws.db');
const BASE_URL = 'https://www.courts.wa.gov';

interface CourtRule {
  ruleSet: string;
  ruleNumber: string;
  ruleName: string;
  url: string;
}

class CourtRulesScraper {
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
    console.log('Starting Court Rules scraper...\n');
    
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
      // Get list of rules
      const listUrl = `${BASE_URL}/court_rules/?fa=court_rules.list&group=clj&set=${ruleSet}`;
      console.log(`  Fetching rule list from: ${listUrl}`);
      
      const response = await axios.get(listUrl);
      const $ = cheerio.load(response.data);
      
      const rules: CourtRule[] = [];
      
      // Find all rule links
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();
        
        // Match rule display links
        if (href && href.includes('court_rules.display') && href.includes(`set=${ruleSet}`)) {
          // Extract rule number from href
          const ruleMatch = href.match(/ruleid=clj[a-z]+(.+?)$/i);
          if (ruleMatch) {
            let ruleNumber = ruleMatch[1];
            // Clean up rule number
            ruleNumber = ruleNumber.replace(/^[a-z]+/i, '');
            
            // Extract rule name from text (format: "IRLJ 1.1 Scope and Purpose of Rules")
            const textMatch = text.match(new RegExp(`${ruleSet}\\s+([\\d.]+)\\s*(.*)`, 'i'));
            const ruleName = textMatch ? textMatch[2].trim() : text;
            const cleanRuleNum = textMatch ? textMatch[1] : ruleNumber;
            
            rules.push({
              ruleSet,
              ruleNumber: cleanRuleNum,
              ruleName: ruleName || '',
              url: href.startsWith('http') ? href : `${BASE_URL}${href}`
            });
          }
        }
      });

      // Remove duplicates
      const uniqueRules = Array.from(new Map(rules.map(r => [`${r.ruleSet}-${r.ruleNumber}`, r])).values());
      
      console.log(`  Found ${uniqueRules.length} rules to scrape`);
      
      // Scrape each rule
      for (let i = 0; i < uniqueRules.length; i++) {
        const rule = uniqueRules[i];
        await this.scrapeRule(rule);
        
        if ((i + 1) % 10 === 0) {
          console.log(`    Processed ${i + 1}/${uniqueRules.length} rules`);
        }
        
        await this.delay(300); // Be respectful
      }
      
      console.log(`  ✓ Completed ${ruleSet}: ${uniqueRules.length} rules`);
      
    } catch (error) {
      console.error(`Error scraping ${ruleSet}:`, error);
    }
  }

  async scrapeRule(rule: CourtRule): Promise<void> {
    try {
      const response = await axios.get(rule.url);
      const $ = cheerio.load(response.data);
      
      // Remove navigation elements
      $('script, style, nav, .navigation, .breadcrumb, .footer, .header').remove();
      
      // Try to find the rule content
      let fullText = '';
      
      // Look for specific content areas
      const contentSelectors = [
        '.rule-content',
        '.content',
        '#content',
        '.main-content',
        'main',
        'article'
      ];
      
      for (const selector of contentSelectors) {
        const content = $(selector).first();
        if (content.length > 0) {
          fullText = content.text().trim();
          break;
        }
      }
      
      // Fallback to body text
      if (!fullText) {
        fullText = $('body').text().trim();
      }
      
      // Clean up the text
      fullText = fullText
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Try to extract just the rule text (remove navigation text)
      const rulePattern = new RegExp(`${rule.ruleSet}\\s+${rule.ruleNumber}`, 'i');
      const ruleIndex = fullText.search(rulePattern);
      if (ruleIndex > 0) {
        fullText = fullText.substring(ruleIndex);
      }
      
      // Clean up common navigation patterns
      fullText = fullText
        .replace(/Washington State Courts.*?Court Rules/g, '')
        .replace(/Search Court Rules.*?Search/g, '')
        .replace(/<<.*?>>/g, '')
        .trim();
      
      // Save to database
      this.insertStmt.run(
        rule.ruleSet,
        rule.ruleNumber,
        rule.ruleName,
        fullText
      );
      
    } catch (error) {
      console.error(`    Error scraping ${rule.ruleSet} ${rule.ruleNumber}:`, (error as Error).message);
    }
  }

  private printStats(): void {
    const stats = this.db.prepare(`
      SELECT rule_set, COUNT(*) as count 
      FROM court_rules 
      GROUP BY rule_set
    `).all() as any[];
    
    console.log('\n=== Court Rules Scraping Complete ===');
    for (const stat of stats) {
      console.log(`  ${stat.rule_set}: ${stat.count} rules`);
    }
    
    const total = this.db.prepare('SELECT COUNT(*) as count FROM court_rules').get() as any;
    console.log(`  Total: ${total.count} court rules`);
  }
}

// Run the scraper
if (import.meta.url === `file://${process.argv[1]}`) {
  const scraper = new CourtRulesScraper();
  scraper.scrapeAll().catch(console.error);
}
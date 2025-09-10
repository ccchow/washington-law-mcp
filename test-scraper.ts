import axios from 'axios';
import * as cheerio from 'cheerio';

async function testScrape() {
  try {
    // Test scraping a single section
    const url = 'https://app.leg.wa.gov/RCW/default.aspx?cite=1.04.010';
    console.log(`Fetching: ${url}`);
    
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // Remove navigation elements
    $('script, style, nav, .navigation, .breadcrumb, .footer, .header').remove();
    
    // Get the text
    const fullText = $('body').text()
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log('Content length:', fullText.length);
    console.log('First 500 chars:', fullText.substring(0, 500));
    
    // Also test finding links on a chapter page
    const chapterUrl = 'https://app.leg.wa.gov/RCW/default.aspx?cite=1.04';
    console.log(`\nFetching chapter: ${chapterUrl}`);
    
    const chapterResponse = await axios.get(chapterUrl);
    const $chapter = cheerio.load(chapterResponse.data);
    
    const sectionLinks: string[] = [];
    $chapter('a').each((_, element) => {
      const href = $chapter(element).attr('href');
      if (href && href.includes('cite=1.04.') && !href.includes('pdf=true')) {
        sectionLinks.push(href);
      }
    });
    
    console.log('Found section links:', sectionLinks.length);
    console.log('First 5 links:', sectionLinks.slice(0, 5));
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testScrape();
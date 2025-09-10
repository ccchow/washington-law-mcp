# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Build and Development
```bash
npm run build           # Compile TypeScript to JavaScript
npm run dev            # Watch mode for TypeScript compilation
npm start              # Run the MCP server
npm test               # Test with MCP Inspector
```

### Database Operations
```bash
npm run init:db        # Initialize SQLite database with schema
sqlite3 data/washington-laws.db  # Direct database access
```

### Data Collection (Scrapers)
```bash
npm run scrape:rcw     # Scrape RCW laws (uses simple-rcw-scraper.ts)
npm run scrape:rpc     # Scrape RPC (Rules of Professional Conduct) PDFs
npx tsx src/scraper/court-rules-pdf-scraper-v2.ts  # Scrape IRLJ/CRLJ court rules PDFs
```

### Testing Specific Laws
```bash
# Query RCW sections directly
sqlite3 data/washington-laws.db "SELECT citation, substr(full_text, 1, 200) FROM rcw WHERE citation = '46.61.502';"

# Query court rules
sqlite3 data/washington-laws.db "SELECT rule_set, rule_number, rule_name FROM court_rules WHERE rule_set = 'CRLJ' AND rule_number = '60.0';"
```

## Architecture Overview

### MCP Server Architecture
The system implements a Model Context Protocol (MCP) server that provides offline access to Washington State laws (RCW, WAC, and Court Rules including RPC). The architecture ensures complete offline operation after initial data collection.

**Key Design Principles:**
- All law texts are persisted locally in SQLite (no runtime web/API calls)
- Read-only database access during MCP server operation
- Full-text search via SQLite FTS5 indexes
- Separate data collection phase from serving phase

### Data Flow
1. **Data Collection Phase** (one-time or periodic updates):
   - Web scrapers fetch RCW sections from apps.leg.wa.gov
   - PDF scrapers download and parse court rules from courts.wa.gov using pdfjs-dist
   - Data stored in SQLite with FTS5 indexes for search

2. **MCP Server Runtime**:
   - `src/index.ts` initializes StdioServerTransport
   - Exposes 7+ tools for law retrieval via MCP protocol
   - `LawDatabase` class (`src/database/database.ts`) provides read-only access
   - All queries served from local database

### Database Schema
Four main tables with Full-Text Search:
- `rcw`: RCW sections with citation, title/chapter/section hierarchy, full_text
- `court_rules`: IRLJ/CRLJ/RPC rules from PDFs with rule_set, rule_number, full_text  
- `wac`: WAC sections (placeholder, not yet populated)
- FTS5 tables: `rcw_fts`, `court_rules_fts`, `wac_fts` for search functionality
- Triggers maintain FTS indexes on insert/update/delete

### Scraper Implementation Details

**RCW Scraper** (`simple-rcw-scraper.ts`):
- Targets specific titles (1, 9, 9A, 46) in `testTitles` array
- Rate-limited with 200-500ms delays between requests
- Handles both relative and absolute URLs from legislature website
- Uses cheerio for HTML parsing

**Court Rules PDF Scraper** (`court-rules-pdf-scraper-v2.ts`):
- Uses pdfjs-dist for PDF parsing (pdf-parse had dependency issues)
- Downloads IRLJ (26 rules) and CRLJ (74 rules) as PDFs
- Extracts text and cleans formatting artifacts
- Stores in `court_rules` table with rule_set, rule_number, rule_name, full_text

**RPC Scraper** (`rpc-scraper.ts`):
- Downloads RPC (Rules of Professional Conduct) PDFs from courts.wa.gov
- Processes 60 RPC rules (1.1 through 8.5)
- Extracts and cleans text from PDFs using pdfjs-dist
- Stores in same `court_rules` table with rule_set='RPC'

### MCP Tools Implementation
Tools defined in `src/index.ts` with parameter validation:
- `get_rcw`: Direct citation lookup (e.g., "46.61.502")
- `get_court_rule`: Retrieve court rules by rule set and number (supports IRLJ, CRLJ, RPC)
- `list_court_rules`: List all court rules with optional rule set filter (IRLJ, CRLJ, RPC)
- `search_laws`: FTS5-powered full-text search across RCW, WAC, and Court Rules (including RPC)
- `list_rcw_titles/chapters/sections`: Hierarchical browsing
- `get_statistics`: Returns counts for all law types and last update time

### Claude Desktop Configuration
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "washington-law": {
      "command": "node",
      "args": ["/absolute/path/to/law_rule_mcp/dist/index.js"]
    }
  }
}
```

## Known Issues and Solutions
- **pdf-parse error "ENOENT ./test/data/05-versions-space.pdf"**: Use pdfjs-dist instead (implemented in court-rules-pdf-scraper-v2.ts)
- **NPM permission errors**: Use `--cache ./.npm-cache` flag
- **Missing RCW sections**: Check if title is included in `testTitles` array in simple-rcw-scraper.ts
- **Court rule number format**: Database stores with ".0" suffix (e.g., "60.0"), but `getCourtRule()` handles both "60" and "60.0"
- **TypeScript undefined args**: Use optional chaining (`args?.property`) in MCP server
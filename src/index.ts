#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { LawDatabase } from './database/database.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '../data/washington-laws.db');

// Check if database exists
if (!existsSync(DB_PATH)) {
  console.error('Database not found! Please run the scraper first:');
  console.error('  npm run init:db');
  console.error('  npm run scrape:rcw');
  process.exit(1);
}

const server = new Server(
  {
    name: 'washington-law-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Initialize database
const db = new LawDatabase();

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_rcw',
        description: 'Retrieve the full text of a specific RCW (Revised Code of Washington) section by citation',
        inputSchema: {
          type: 'object',
          properties: {
            citation: {
              type: 'string',
              description: 'RCW citation (e.g., "46.61.502" for DUI law)',
            },
          },
          required: ['citation'],
        },
      },
      {
        name: 'get_court_rule',
        description: 'Retrieve the full text of a specific court rule (IRLJ, CRLJ, RPC, or RALJ) by rule set and number',
        inputSchema: {
          type: 'object',
          properties: {
            ruleSet: {
              type: 'string',
              description: 'Rule set (e.g., "IRLJ", "CRLJ", "RPC", or "RALJ")',
              enum: ['IRLJ', 'CRLJ', 'RPC', 'RALJ'],
            },
            ruleNumber: {
              type: 'string',
              description: 'Rule number (e.g., "6.7" or "60.0")',
            },
          },
          required: ['ruleSet', 'ruleNumber'],
        },
      },
      {
        name: 'list_court_rules',
        description: 'List all court rules, optionally filtered by rule set',
        inputSchema: {
          type: 'object',
          properties: {
            ruleSet: {
              type: 'string',
              description: 'Optional: Filter by rule set (IRLJ, CRLJ, RPC, or RALJ)',
              enum: ['IRLJ', 'CRLJ', 'RPC', 'RALJ'],
            },
          },
        },
      },
      {
        name: 'get_wac',
        description: 'Retrieve the full text of a specific WAC (Washington Administrative Code) section by citation',
        inputSchema: {
          type: 'object',
          properties: {
            citation: {
              type: 'string',
              description: 'WAC citation (e.g., "296-24-12005")',
            },
          },
          required: ['citation'],
        },
      },
      {
        name: 'search_laws',
        description: 'Search Washington laws (RCW, WAC, and Court Rules including RPC) by keywords or phrases',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (keywords or phrases)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 20)',
              default: 20,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_rcw_titles',
        description: 'List all RCW titles with their names and section counts',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_rcw_chapters',
        description: 'List all chapters within a specific RCW title',
        inputSchema: {
          type: 'object',
          properties: {
            titleNum: {
              type: 'string',
              description: 'Title number (e.g., "46" for Motor Vehicles)',
            },
          },
          required: ['titleNum'],
        },
      },
      {
        name: 'list_rcw_sections',
        description: 'List all sections within a specific RCW chapter',
        inputSchema: {
          type: 'object',
          properties: {
            chapterNum: {
              type: 'string',
              description: 'Chapter number (e.g., "46.61" for Rules of the Road)',
            },
          },
          required: ['chapterNum'],
        },
      },
      {
        name: 'get_statistics',
        description: 'Get statistics about the law database',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_rcw': {
        const citation = args?.citation as string;
        const rcw = db.getRCW(citation);
        
        if (!rcw) {
          return {
            content: [
              {
                type: 'text',
                text: `RCW ${citation} not found in database.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `# RCW ${rcw.citation}${rcw.sectionName ? ': ' + rcw.sectionName : ''}

**Title ${rcw.titleNum}**: ${rcw.titleName || 'Unknown'}
**Chapter ${rcw.chapterNum}**: ${rcw.chapterName || 'Unknown'}

## Full Text

${rcw.fullText}

${rcw.effectiveDate ? `\n**Effective Date**: ${rcw.effectiveDate}` : ''}
${rcw.lastAmended ? `\n**Last Amended**: ${rcw.lastAmended}` : ''}`,
            },
          ],
        };
      }

      case 'get_wac': {
        const citation = args?.citation as string;
        const wac = db.getWAC(citation);
        
        if (!wac) {
          return {
            content: [
              {
                type: 'text',
                text: `WAC ${citation} not found in database.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `# WAC ${wac.citation}${wac.sectionName ? ': ' + wac.sectionName : ''}

**Title ${wac.titleNum}**: ${wac.titleName || 'Unknown'}
**Chapter ${wac.chapterNum}**: ${wac.chapterName || 'Unknown'}

## Full Text

${wac.fullText}

${wac.effectiveDate ? `\n**Effective Date**: ${wac.effectiveDate}` : ''}`,
            },
          ],
        };
      }

      case 'get_court_rule': {
        const ruleSet = args?.ruleSet as string;
        const ruleNumber = args?.ruleNumber as string;
        const rule = db.getCourtRule(ruleSet, ruleNumber);
        
        if (!rule) {
          return {
            content: [
              {
                type: 'text',
                text: `${ruleSet} ${ruleNumber} not found in database.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `# ${rule.ruleSet} ${rule.ruleNumber}${rule.ruleName ? ': ' + rule.ruleName : ''}

## Full Text

${rule.fullText}

${rule.updatedAt ? `\n**Last Updated**: ${rule.updatedAt}` : ''}`,
            },
          ],
        };
      }

      case 'list_court_rules': {
        const ruleSet = args?.ruleSet as string | undefined;
        const rules = db.listCourtRules(ruleSet);
        
        if (rules.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: ruleSet ? `No rules found for ${ruleSet}` : 'No court rules found',
              },
            ],
          };
        }

        let response = ruleSet ? `# ${ruleSet} Rules\n\n` : '# Court Rules\n\n';
        let currentSet = '';
        
        for (const rule of rules) {
          if (!ruleSet && rule.ruleSet !== currentSet) {
            currentSet = rule.ruleSet;
            response += `\n## ${currentSet}\n\n`;
          }
          response += `- **${rule.ruleSet} ${rule.ruleNumber}**: ${rule.ruleName}\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: response,
            },
          ],
        };
      }

      case 'search_laws': {
        const query = args?.query as string;
        const limit = (args?.limit as number) || 20;
        const results = db.searchLaws(query, limit);

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No results found for query: "${query}"`,
              },
            ],
          };
        }

        let response = `# Search Results for "${query}"\n\nFound ${results.length} results:\n\n`;
        
        for (const result of results) {
          response += `## ${result.type} ${result.citation}`;
          if (result.sectionName) {
            response += `: ${result.sectionName}`;
          }
          response += '\n';
          
          if (result.chapterName) {
            response += `**Chapter**: ${result.chapterName}\n`;
          }
          
          response += `**Snippet**: ${result.snippet}\n\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: response,
            },
          ],
        };
      }

      case 'list_rcw_titles': {
        const titles = db.listRCWTitles();
        
        let response = '# RCW Titles\n\n';
        for (const title of titles) {
          response += `- **Title ${title.titleNum}**: ${title.titleName} (${title.count} sections)\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: response,
            },
          ],
        };
      }

      case 'list_rcw_chapters': {
        const titleNum = args?.titleNum as string;
        const chapters = db.listRCWChapters(titleNum);

        if (chapters.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No chapters found for Title ${titleNum}`,
              },
            ],
          };
        }

        let response = `# RCW Title ${titleNum} Chapters\n\n`;
        for (const chapter of chapters) {
          response += `- **Chapter ${chapter.chapterNum}**: ${chapter.chapterName} (${chapter.count} sections)\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: response,
            },
          ],
        };
      }

      case 'list_rcw_sections': {
        const chapterNum = args?.chapterNum as string;
        const sections = db.listRCWSections(chapterNum);

        if (sections.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No sections found for Chapter ${chapterNum}`,
              },
            ],
          };
        }

        let response = `# RCW Chapter ${chapterNum} Sections\n\n`;
        for (const section of sections) {
          response += `- **${section.citation}**: ${section.sectionName}\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: response,
            },
          ],
        };
      }

      case 'get_statistics': {
        const stats = db.getStatistics();
        
        return {
          content: [
            {
              type: 'text',
              text: `# Washington Law Database Statistics

- **RCW Sections**: ${stats.rcwCount.toLocaleString()}
- **WAC Sections**: ${stats.wacCount.toLocaleString()}
- **Court Rules**: ${stats.courtRulesCount?.toLocaleString() || '0'} (IRLJ & CRLJ)
- **Last Update**: ${stats.lastUpdate}

Database is stored locally and operates completely offline.`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${(error as Error).message}`,
        },
      ],
    };
  }
});

// Handle resource listing
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const stats = db.getStatistics();
  
  return {
    resources: [
      {
        uri: 'law://washington/statistics',
        name: 'Washington Law Database Statistics',
        description: `Local database with ${stats.rcwCount} RCW sections, ${stats.wacCount} WAC sections, and ${stats.courtRulesCount || 0} court rules`,
        mimeType: 'text/plain',
      },
    ],
  };
});

// Handle resource reading
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'law://washington/statistics') {
    const stats = db.getStatistics();
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: `Washington Law Database Statistics:
- RCW Sections: ${stats.rcwCount}
- WAC Sections: ${stats.wacCount}
- Court Rules: ${stats.courtRulesCount || 0}
- Last Update: ${stats.lastUpdate}`,
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Washington Law MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
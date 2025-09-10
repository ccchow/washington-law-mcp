export interface RCWSection {
  id?: number;
  citation: string;
  titleNum: string;
  chapterNum: string;
  sectionNum: string;
  titleName?: string;
  chapterName?: string;
  sectionName?: string;
  fullText: string;
  effectiveDate?: string;
  lastAmended?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WACSection {
  id?: number;
  citation: string;
  titleNum: string;
  chapterNum: string;
  sectionNum: string;
  titleName?: string;
  chapterName?: string;
  sectionName?: string;
  fullText: string;
  effectiveDate?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SearchResult {
  type: 'RCW' | 'WAC';
  citation: string;
  titleName?: string;
  chapterName?: string;
  sectionName?: string;
  snippet: string;
  score?: number;
}

export interface LawMetadata {
  lastUpdate: Date;
  rcwCount: number;
  wacCount: number;
  version: string;
}
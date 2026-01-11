/**
 * Knowledge extraction service
 *
 * Uses Claude Agent SDK to analyze conversations and extract structured knowledge
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadConfig } from '../shared/config.js';
import type { KnowledgeItem } from './summarizer.js';
import {
  type ParsedConversation,
  extractQAPairs,
  extractWebResearch,
  getConversationForAnalysis,
} from './transcript.js';
import { summarizeQA, summarizeWebPage, mergeKnowledge } from './summarizer.js';

/**
 * Run a query using Claude Agent SDK
 * Uses Claude Code's existing authentication - no API key needed
 */
async function runQuery(prompt: string): Promise<string | null> {
  const config = loadConfig();

  if (!config.summarization.enabled) {
    return null;
  }

  try {
    const result = query({
      prompt,
      options: {
        model: config.summarization.model,
        maxTurns: 1,
        tools: [], // Explicitly disable tools - read-only extraction
      }
    });

    // Collect the result from the async generator
    for await (const message of result) {
      if (message.type === 'result' && message.subtype === 'success') {
        return message.result;
      }
    }
    return null;
  } catch (error) {
    console.error('Agent SDK query failed:', error);
    return null;
  }
}

/**
 * Extract JSON from a response that might contain markdown code blocks
 */
function extractJson(text: string): string {
  // Try to extract JSON from markdown code block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  // Otherwise assume the whole response is JSON
  return text.trim();
}

/**
 * Extract all knowledge from a parsed conversation
 */
export async function extractKnowledge(
  conversation: ParsedConversation,
  projectName: string,
  sessionId: string
): Promise<KnowledgeItem[]> {
  const knowledge: KnowledgeItem[] = [];

  // 1. Extract and summarize Q&A pairs
  const qaPairs = extractQAPairs(conversation);
  for (const qa of qaPairs.slice(0, 10)) {
    // Limit to prevent too many API calls
    const summarized = await summarizeQA(qa.question, qa.answer);
    if (summarized) {
      summarized.sourceSession = sessionId;
      knowledge.push(summarized);
    }
  }

  // 2. Extract and summarize web research
  const research = extractWebResearch(conversation);
  for (const item of research.slice(0, 10)) {
    const summarized = await summarizeWebPage(
      item.url || `${item.tool}: ${item.query}`,
      item.content,
      item.query
    );
    if (summarized) {
      summarized.sourceSession = sessionId;
      knowledge.push(summarized);
    }
  }

  // 3. Use AI to extract deeper knowledge (explanations, decisions, learnings)
  const conversationText = getConversationForAnalysis(conversation);
  if (conversationText.length > 500) {
    const extracted = await extractDeepKnowledge(conversationText, projectName);
    for (const item of extracted) {
      item.sourceSession = sessionId;
      knowledge.push(item);
    }
  }

  // 4. Merge and deduplicate
  const merged = await mergeKnowledge(knowledge);

  return merged;
}

/**
 * Extract deeper knowledge (explanations, decisions, learnings) using AI
 */
async function extractDeepKnowledge(
  conversationText: string,
  projectName: string
): Promise<KnowledgeItem[]> {
  const config = loadConfig();
  if (!config.summarization.enabled) return [];

  const prompt = `Analyze this conversation and extract valuable knowledge. Focus on things worth remembering for future reference.

Project: ${projectName}

Conversation:
${conversationText.substring(0, 25000)}

Extract the following types of knowledge (only include items that are genuinely useful):

1. **Explanations** - Concepts or approaches that were explained in detail
2. **Decisions** - Technical choices made with rationale
3. **Learnings** - Tips, patterns, gotchas, or insights discovered

For each item, provide:
- type: "explanation" | "decision" | "learning"
- title: Concise title (5-10 words)
- context: When this knowledge is useful (1 sentence)
- summary: Key information (max 150 words for explanations, 100 words for others)
- keyPoints: Array of actionable points
- topics: Array of relevant topic tags

Respond with a JSON array only (no markdown, no explanation). Return [] if no significant knowledge to extract.

[
  {
    "type": "explanation",
    "title": "...",
    "context": "...",
    "summary": "...",
    "keyPoints": ["...", "..."],
    "topics": ["...", "..."]
  }
]`;

  try {
    const response = await runQuery(prompt);
    if (!response) return [];

    const parsed = JSON.parse(extractJson(response));
    if (!Array.isArray(parsed)) return [];

    return parsed.map(item => ({
      type: item.type as KnowledgeItem['type'],
      title: item.title || 'Untitled',
      context: item.context || '',
      content: item.summary || '',
      keyPoints: item.keyPoints || [],
      topics: item.topics || [],
    }));
  } catch {
    return [];
  }
}

/**
 * Extract knowledge from a single tool response (for real-time capture)
 */
export async function extractToolKnowledge(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: string,
  sessionId: string
): Promise<KnowledgeItem | null> {
  // Handle WebFetch
  if (toolName === 'WebFetch') {
    const url = toolInput.url as string;
    const queryText = toolInput.prompt as string;
    const summarized = await summarizeWebPage(url, toolOutput, queryText);
    if (summarized) {
      summarized.sourceSession = sessionId;
      return summarized;
    }
  }

  // Handle WebSearch
  if (toolName === 'WebSearch') {
    const queryText = toolInput.query as string;
    const summarized = await summarizeWebPage(`WebSearch: ${queryText}`, toolOutput, queryText);
    if (summarized) {
      summarized.sourceSession = sessionId;
      summarized.type = 'research';
      return summarized;
    }
  }

  // Handle Context7 docs
  if (toolName.includes('context7') && toolName.includes('query-docs')) {
    const libraryId = toolInput.libraryId as string;
    const queryText = toolInput.query as string;
    const summarized = await summarizeWebPage(
      `Context7: ${libraryId}`,
      toolOutput,
      queryText
    );
    if (summarized) {
      summarized.sourceSession = sessionId;
      summarized.type = 'research';
      summarized.title = `${libraryId.split('/').pop()} - ${summarized.title}`;
      return summarized;
    }
  }

  return null;
}

/**
 * Filter knowledge items to only include significant ones
 */
export function filterSignificantKnowledge(items: KnowledgeItem[]): KnowledgeItem[] {
  return items.filter(item => {
    // Must have meaningful content
    if (!item.content || item.content.length < 20) return false;
    if (!item.title || item.title.length < 5) return false;

    // Must have at least one key point
    if (!item.keyPoints || item.keyPoints.length === 0) return false;

    return true;
  });
}

/**
 * Score knowledge items by significance
 */
export function scoreKnowledge(item: KnowledgeItem): number {
  let score = 0;

  // Content length (up to 50 points)
  score += Math.min(item.content.length / 10, 50);

  // Key points (10 points each, up to 30)
  score += Math.min(item.keyPoints.length * 10, 30);

  // Topics (5 points each, up to 15)
  score += Math.min(item.topics.length * 5, 15);

  // Type bonus
  if (item.type === 'decision') score += 10;
  if (item.type === 'explanation') score += 5;

  // Source URL bonus (external research)
  if (item.sourceUrl) score += 10;

  return score;
}

/**
 * Get top N knowledge items by score
 */
export function getTopKnowledge(items: KnowledgeItem[], n: number = 10): KnowledgeItem[] {
  return items
    .map(item => ({ item, score: scoreKnowledge(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(x => x.item);
}

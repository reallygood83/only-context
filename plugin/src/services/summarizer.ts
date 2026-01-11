/**
 * Summarization service for knowledge capture
 *
 * Key principle: Never store raw content, always summarize and extract key points
 * Uses Claude Agent SDK to leverage Claude Code's existing subscription
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadConfig } from '../shared/config.js';

export interface SummarizedContent {
  title: string;
  summary: string;
  keyPoints: string[];
  topics: string[];
}

export interface KnowledgeItem {
  type: 'qa' | 'explanation' | 'decision' | 'research' | 'learning';
  title: string;
  context: string;
  content: string;
  keyPoints: string[];
  topics: string[];
  sourceUrl?: string;
  sourceSession?: string;
}

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
        tools: [], // Explicitly disable tools - read-only summarization
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
 * Summarize general content
 */
export async function summarizeContent(
  content: string,
  maxWords: number = 200
): Promise<SummarizedContent | null> {
  const prompt = `Summarize the following content in ${maxWords} words or less. Extract the key actionable insights, not narrative.

Content:
${content.substring(0, 10000)}

Respond with JSON only (no markdown, no explanation):
{
  "title": "Concise title (5-10 words)",
  "summary": "Summary in ${maxWords} words or less",
  "keyPoints": ["Point 1", "Point 2", ...],
  "topics": ["topic1", "topic2", ...]
}`;

  try {
    const response = await runQuery(prompt);
    if (!response) return null;

    return JSON.parse(extractJson(response)) as SummarizedContent;
  } catch {
    return null;
  }
}

/**
 * Summarize web page content from WebFetch/WebSearch
 */
export async function summarizeWebPage(
  url: string,
  content: string,
  queryText?: string
): Promise<KnowledgeItem | null> {
  const prompt = `Summarize this web page content for future reference. Focus on actionable information.

URL: ${url}
${queryText ? `Search Query: ${queryText}` : ''}

Content (truncated):
${content.substring(0, 8000)}

Respond with JSON only (no markdown, no explanation):
{
  "title": "What this page is about (5-10 words)",
  "context": "Why this was looked up (1 sentence)",
  "summary": "Key information from the page (max 150 words)",
  "keyPoints": ["Actionable point 1", "Actionable point 2", ...],
  "topics": ["topic1", "topic2", ...]
}`;

  try {
    const response = await runQuery(prompt);
    if (!response) return null;

    const parsed = JSON.parse(extractJson(response));
    return {
      type: 'research',
      title: parsed.title,
      context: parsed.context,
      content: parsed.summary,
      keyPoints: parsed.keyPoints || [],
      topics: parsed.topics || [],
      sourceUrl: url,
    };
  } catch {
    return null;
  }
}

/**
 * Summarize Q&A from conversation
 */
export async function summarizeQA(
  question: string,
  answer: string
): Promise<KnowledgeItem | null> {
  const prompt = `Distill this Q&A exchange to its essential points. Max 100 words for the answer.

Question: ${question.substring(0, 2000)}

Answer: ${answer.substring(0, 5000)}

Respond with JSON only (no markdown, no explanation):
{
  "title": "What the question is about (5-10 words)",
  "context": "The core question (1 sentence, rephrased)",
  "summary": "The key answer (max 100 words)",
  "keyPoints": ["Key point 1", "Key point 2", ...],
  "topics": ["topic1", "topic2", ...]
}`;

  try {
    const response = await runQuery(prompt);
    if (!response) return null;

    const parsed = JSON.parse(extractJson(response));
    return {
      type: 'qa',
      title: parsed.title,
      context: parsed.context,
      content: parsed.summary,
      keyPoints: parsed.keyPoints || [],
      topics: parsed.topics || [],
    };
  } catch {
    return null;
  }
}

/**
 * Summarize an explanation from conversation
 */
export async function summarizeExplanation(
  topic: string,
  explanation: string
): Promise<KnowledgeItem | null> {
  const prompt = `Extract the core concepts from this explanation. Max 150 words.

Topic: ${topic}

Explanation: ${explanation.substring(0, 6000)}

Respond with JSON only (no markdown, no explanation):
{
  "title": "Concept title (5-10 words)",
  "context": "When this knowledge is useful (1 sentence)",
  "summary": "Core concepts explained (max 150 words)",
  "keyPoints": ["Key concept 1", "Key concept 2", ...],
  "topics": ["topic1", "topic2", ...]
}`;

  try {
    const response = await runQuery(prompt);
    if (!response) return null;

    const parsed = JSON.parse(extractJson(response));
    return {
      type: 'explanation',
      title: parsed.title,
      context: parsed.context,
      content: parsed.summary,
      keyPoints: parsed.keyPoints || [],
      topics: parsed.topics || [],
    };
  } catch {
    return null;
  }
}

/**
 * Summarize a technical decision
 */
export async function summarizeDecision(
  context: string,
  decision: string,
  rationale?: string
): Promise<KnowledgeItem | null> {
  const prompt = `Summarize this technical decision. Max 100 words.

Context: ${context.substring(0, 2000)}

Decision: ${decision.substring(0, 2000)}

${rationale ? `Rationale: ${rationale.substring(0, 2000)}` : ''}

Respond with JSON only (no markdown, no explanation):
{
  "title": "Decision title (5-10 words)",
  "context": "Problem or situation (1 sentence)",
  "summary": "What was decided and why (max 100 words)",
  "keyPoints": ["Key aspect 1", "Key aspect 2", ...],
  "topics": ["topic1", "topic2", ...]
}`;

  try {
    const response = await runQuery(prompt);
    if (!response) return null;

    const parsed = JSON.parse(extractJson(response));
    return {
      type: 'decision',
      title: parsed.title,
      context: parsed.context,
      content: parsed.summary,
      keyPoints: parsed.keyPoints || [],
      topics: parsed.topics || [],
    };
  } catch {
    return null;
  }
}

/**
 * Merge and deduplicate multiple knowledge items
 */
export async function mergeKnowledge(
  items: KnowledgeItem[]
): Promise<KnowledgeItem[]> {
  if (items.length <= 1) return items;

  const config = loadConfig();
  if (!config.summarization.enabled) return items;

  // Group by type
  const grouped = new Map<string, KnowledgeItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.type) || [];
    existing.push(item);
    grouped.set(item.type, existing);
  }

  const merged: KnowledgeItem[] = [];

  for (const [type, typeItems] of grouped) {
    if (typeItems.length === 1) {
      merged.push(typeItems[0]);
      continue;
    }

    // Ask AI to identify duplicates and merge
    const prompt = `These knowledge items may have duplicates or related content. Identify which should be merged and return consolidated items.

Items:
${typeItems.map((item, i) => `${i + 1}. Title: ${item.title}\n   Content: ${item.content}`).join('\n\n')}

Return JSON array of merged items. Combine related items, remove duplicates, keep unique items separate.
Respond with JSON only (no markdown, no explanation):
[
  {
    "title": "...",
    "context": "...",
    "summary": "...",
    "keyPoints": [...],
    "topics": [...],
    "mergedFrom": [1, 2]
  }
]`;

    try {
      const response = await runQuery(prompt);
      if (response) {
        const parsed = JSON.parse(extractJson(response));
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            merged.push({
              type: type as KnowledgeItem['type'],
              title: item.title,
              context: item.context,
              content: item.summary,
              keyPoints: item.keyPoints || [],
              topics: item.topics || [],
              // Preserve source info from first merged item
              sourceUrl: typeItems[0].sourceUrl,
              sourceSession: typeItems[0].sourceSession,
            });
          }
          continue;
        }
      }
    } catch {
      // Fall through to add items as-is
    }

    // If merging failed, add items as-is
    merged.push(...typeItems);
  }

  return merged;
}

/**
 * Summarize a session based on knowledge items
 */
export async function summarizeSession(
  knowledge: KnowledgeItem[],
  filesModified: string[],
  commandsRun: number,
  errorsEncountered: number
): Promise<string> {
  if (knowledge.length === 0) {
    return `Session completed. Modified ${filesModified.length} files, ran ${commandsRun} commands, encountered ${errorsEncountered} errors.`;
  }

  const config = loadConfig();
  if (!config.summarization.enabled) {
    // Fallback: Generate summary from knowledge items without AI
    const topics = [...new Set(knowledge.flatMap(k => k.topics))].slice(0, 5);
    const types = [...new Set(knowledge.map(k => k.type))];
    return `Session covered ${types.join(', ')} on topics: ${topics.join(', ')}. Modified ${filesModified.length} files.`;
  }

  const prompt = `Summarize this coding session in 2-3 sentences based on the knowledge captured.

Knowledge Items:
${knowledge.map(k => `- [${k.type}] ${k.title}: ${k.content.substring(0, 100)}...`).join('\n')}

Session Stats:
- Files modified: ${filesModified.length}
- Commands run: ${commandsRun}
- Errors: ${errorsEncountered}

Write a concise summary focusing on what was learned and accomplished. Return only the summary text, no JSON.`;

  try {
    const response = await runQuery(prompt);
    return response || `Session captured ${knowledge.length} knowledge items.`;
  } catch {
    return `Session captured ${knowledge.length} knowledge items across ${[...new Set(knowledge.map(k => k.type))].join(', ')}.`;
  }
}

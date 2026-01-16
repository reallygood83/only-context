#!/usr/bin/env bun

/**
 * Session End Hook
 *
 * Runs when a Claude Code session ends (stop or natural end).
 *
 * Key design:
 * - Immediately persists session to vault (no AI - synchronous)
 * - Spawns background script for AI summarization (async)
 * - Background script updates session note with AI-generated summary
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { loadConfig, sanitizeProjectName } from '../../src/shared/config.js';
import { endSession, readSession, clearSessionFile, getPreCompactKnowledge } from '../../src/shared/session-store.js';
import { VaultManager } from '../../src/mcp-server/utils/vault.js';
import { readStdinJson } from './utils/helpers.js';
import type { SessionEndInput, Session, Observation } from '../../src/shared/types.js';

async function main() {
  try {
    const config = loadConfig();

    // Global toggle - exit immediately if disabled (0 tokens)
    if (config.enabled === false) {
      process.exit(0);
    }

    const args = process.argv.slice(2);
    const endType = (args.find(a => a.startsWith('--type='))?.split('=')[1] || 'end') as 'stop' | 'end';

    const input = await readStdinJson<SessionEndInput>();

    // Validate session_id from input
    if (!input.session_id) {
      console.error('No session_id provided');
      return;
    }

    // Verify session exists and belongs to this session_id
    const existingSession = readSession(input.session_id);
    if (!existingSession) {
      console.error(`Session not found: ${input.session_id}`);
      return;
    }

    // End the specific session by ID
    const session = endSession(input.session_id, endType);
    if (!session) {
      return;
    }

    // Get pre-compact knowledge paths (captured before any compaction)
    const preCompactPaths = getPreCompactKnowledge(input.session_id);

    // Generate simple summary without AI (fast, synchronous)
    session.summary = generateSimpleSummary(session, preCompactPaths.length);

    // Persist session to vault immediately (no waiting for AI)
    const sessionPath = await persistSession(session, config, preCompactPaths);

    // Link session to pre-compact knowledge items
    if (preCompactPaths.length > 0 && sessionPath) {
      try {
        const vault = new VaultManager(config.vault.path, config.vault.memFolder);
        await vault.linkSessionToKnowledge(sessionPath, preCompactPaths);
      } catch (error) {
        console.error('Failed to link session to knowledge:', error);
      }
    }

    // Spawn background script for AI summarization (if enabled and transcript available)
    if (config.summarization.enabled && input.transcript_path) {
      const backgroundInput = JSON.stringify({
        transcript_path: input.transcript_path,
        session_id: input.session_id,
        project: session.project,
        session_path: sessionPath,
        trigger: 'session-end',
        mem_folder: config.vault.memFolder,
      });

      const scriptPath = path.join(__dirname, 'background-summarize.ts');

      spawn('bun', ['run', scriptPath, backgroundInput], {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(scriptPath),
      }).unref();

      console.error('SessionEnd: Spawned background summarization');
    }

    // Clear the session file after successful persistence
    clearSessionFile(input.session_id);

    console.error(`SessionEnd: Session ${input.session_id.substring(0, 8)} persisted to vault`);

  } catch (error) {
    // Silently fail to not break Claude Code
    console.error('Session end hook error:', error);
  }
}

/**
 * Generate a simple summary without AI
 */
function generateSimpleSummary(session: Session, knowledgeCount: number): string {
  const parts: string[] = [];

  // Duration
  if (session.durationMinutes && session.durationMinutes > 0) {
    parts.push(`${session.durationMinutes} minute session`);
  }

  // Files
  if (session.filesModified.length > 0) {
    parts.push(`modified ${session.filesModified.length} files`);
  }

  // Commands
  if (session.commandsRun > 0) {
    parts.push(`ran ${session.commandsRun} commands`);
  }

  // Errors
  if (session.errorsEncountered > 0) {
    parts.push(`encountered ${session.errorsEncountered} errors`);
  }

  // Knowledge
  if (knowledgeCount > 0) {
    parts.push(`captured ${knowledgeCount} knowledge items`);
  }

  if (parts.length === 0) {
    return 'Session completed.';
  }

  // Capitalize first part
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);

  return parts.join(', ') + '.';
}

/**
 * Persist session to vault as markdown
 */
async function persistSession(
  session: Session,
  config: ReturnType<typeof loadConfig>,
  knowledgePaths: string[] = []
): Promise<string> {
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);

  const projectPath = path.join(
    vault.getMemPath(),
    'projects',
    sanitizeProjectName(session.project),
    'sessions'
  );

  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  const fileName = `${session.startTime.split('T')[0]}_${session.id.substring(0, 8)}.md`;
  const filePath = path.join(projectPath, fileName);
  const relativePath = `projects/${sanitizeProjectName(session.project)}/sessions/${fileName}`;

  // Parent link to sessions category index (sessions/sessions.md)
  const parentLink = `[[${config.vault.memFolder}/projects/${sanitizeProjectName(session.project)}/sessions/sessions]]`;

  const knowledgeCount = knowledgePaths.length;
  const frontmatter = `---
type: session
title: "Session ${session.startTime.split('T')[0]}"
project: ${session.project}
created: ${session.startTime}
updated: ${new Date().toISOString()}
tags:
  - session
  - project/${sanitizeProjectName(session.project)}
parent: "${parentLink}"
session_id: ${session.id}
start_time: ${session.startTime}
end_time: ${session.endTime || new Date().toISOString()}
duration_minutes: ${session.durationMinutes || 0}
status: ${session.status}
observations_count: ${session.observations.length}
files_modified: ${session.filesModified.length}
commands_run: ${session.commandsRun}
errors_encountered: ${session.errorsEncountered}
knowledge_captured: ${knowledgeCount}
---

`;

  const content = generateSessionContent(session);

  fs.writeFileSync(filePath, frontmatter + content);

  return relativePath;
}

/**
 * Generate session note content
 */
function generateSessionContent(session: Session): string {
  const lines: string[] = [];

  lines.push(`# Session: ${session.startTime.split('T')[0]}`);
  lines.push('');

  // Summary section
  lines.push('## Summary');
  lines.push('');
  if (session.summary) {
    lines.push(session.summary);
  } else {
    lines.push('> [!note] Session completed');
    lines.push(`> Duration: ${session.durationMinutes || 0} minutes`);
    lines.push(`> Files modified: ${session.filesModified.length}`);
    lines.push(`> Commands run: ${session.commandsRun}`);
    lines.push(`> Errors: ${session.errorsEncountered}`);
  }
  lines.push('');

  // User prompts section - what the user asked
  const userPrompts = session.observations.filter(obs => obs.tool === 'UserPrompt');
  if (userPrompts.length > 0) {
    lines.push('## User Requests');
    lines.push('');
    for (const prompt of userPrompts.slice(0, 10)) {
      const data = prompt.data as { prompt?: string };
      const promptText = data.prompt || '';
      const preview = promptText.length > 200 ? promptText.substring(0, 200) + '...' : promptText;
      const time = prompt.timestamp.split('T')[1]?.substring(0, 5) || '';
      lines.push(`### ${time}`);
      lines.push('');
      lines.push(`> ${preview.replace(/\n/g, '\n> ')}`);
      lines.push('');
    }
    if (userPrompts.length > 10) {
      lines.push(`_... and ${userPrompts.length - 10} more requests_`);
      lines.push('');
    }
  }

  // Key actions (excluding user prompts)
  const toolActions = session.observations.filter(obs => obs.tool !== 'UserPrompt');
  if (toolActions.length > 0) {
    lines.push('## Actions Taken');
    lines.push('');

    // Group by type
    const fileEdits = toolActions.filter(obs => obs.type === 'file_edit');
    const commands = toolActions.filter(obs => obs.type === 'command');
    const errors = toolActions.filter(obs => obs.type === 'error' || obs.isError);
    const other = toolActions.filter(obs =>
      obs.type !== 'file_edit' && obs.type !== 'command' && obs.type !== 'error' && !obs.isError
    );

    if (fileEdits.length > 0) {
      lines.push(`**File Edits**: ${fileEdits.length}`);
      for (const edit of fileEdits.slice(0, 5)) {
        const data = edit.data as { path?: string; changeType?: string };
        lines.push(`- \`${data.path}\` (${data.changeType || 'modified'})`);
      }
      if (fileEdits.length > 5) {
        lines.push(`- _... and ${fileEdits.length - 5} more edits_`);
      }
      lines.push('');
    }

    if (commands.length > 0) {
      lines.push(`**Commands Run**: ${commands.length}`);
      for (const cmd of commands.slice(0, 5)) {
        const data = cmd.data as { command?: string };
        const cmdText = (data.command || '').substring(0, 60);
        lines.push(`- \`${cmdText}${(data.command || '').length > 60 ? '...' : ''}\``);
      }
      if (commands.length > 5) {
        lines.push(`- _... and ${commands.length - 5} more commands_`);
      }
      lines.push('');
    }

    if (errors.length > 0) {
      lines.push(`**Errors Encountered**: ${errors.length}`);
      for (const err of errors.slice(0, 3)) {
        const data = err.data as { message?: string; type?: string };
        lines.push(`- ${data.type || 'Error'}: ${(data.message || '').substring(0, 100)}`);
      }
      if (errors.length > 3) {
        lines.push(`- _... and ${errors.length - 3} more errors_`);
      }
      lines.push('');
    }

    if (other.length > 0) {
      lines.push(`**Other Actions**: ${other.length}`);
      for (const action of other.slice(0, 3)) {
        lines.push(`- ${action.tool}`);
      }
      lines.push('');
    }
  }

  // Files modified (full list)
  if (session.filesModified.length > 0) {
    lines.push('## Files Modified');
    lines.push('');
    for (const file of session.filesModified.slice(0, 20)) {
      lines.push(`- \`${file}\``);
    }
    if (session.filesModified.length > 20) {
      lines.push(`- _... and ${session.filesModified.length - 20} more files_`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

main();

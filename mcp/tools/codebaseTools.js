/**
 * MCP Codebase & Project Modification Tools
 * 
 * Empowers AI agents (Claude, ChatGPT, Cursor) to inspect and modify
 * the RoundOne AI codebase directly through MCP tools:
 * - read_project_file
 * - write_project_file
 * - edit_project_file
 * - list_project_files
 * - run_project_command
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';

const execAsync = promisify(exec);
const PROJECT_ROOT = path.resolve(process.cwd());

function resolveSafePath(userPath) {
  const clean = path.normalize(String(userPath || '').trim());
  const resolved = path.isAbsolute(clean)
    ? path.resolve(clean)
    : path.resolve(PROJECT_ROOT, clean);

  // Security barrier: prevent path traversal outside project root
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error(`Access denied: Path "${userPath}" is outside project directory.`);
  }
  return resolved;
}

export function registerCodebaseTools(server) {
  // 1. read_project_file
  server.tool(
    'read_project_file',
    'Read the text contents of any source file in the RoundOne AI project.',
    {
      file_path: z.string().describe('Relative path to the file from project root (e.g. "backend/src/server.js", "frontend/public/index.html")')
    },
    async ({ file_path }) => {
      try {
        const safe = resolveSafePath(file_path);
        if (!fs.existsSync(safe)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Error: File not found at "${file_path}"` }]
          };
        }
        const stats = fs.statSync(safe);
        if (stats.isDirectory()) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Error: "${file_path}" is a directory, not a file. Use list_project_files instead.` }]
          };
        }
        const text = fs.readFileSync(safe, 'utf8');
        return {
          content: [{
            type: 'text',
            text: `### 📄 File: ${file_path} (${text.split('\n').length} lines, ${stats.size} bytes)\n\n\`\`\`\n${text}\n\`\`\``
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to read file "${file_path}": ${err.message}` }]
        };
      }
    }
  );

  // 2. write_project_file
  server.tool(
    'write_project_file',
    'Create or overwrite a source code file in the project with new contents.',
    {
      file_path: z.string().describe('Relative path to the file to create or overwrite'),
      content: z.string().describe('The full UTF-8 text content to write into the file')
    },
    async ({ file_path, content }) => {
      try {
        const safe = resolveSafePath(file_path);
        fs.mkdirSync(path.dirname(safe), { recursive: true });
        fs.writeFileSync(safe, content, 'utf8');
        return {
          content: [{
            type: 'text',
            text: `✅ Successfully wrote ${content.length} characters to \`${file_path}\`.`
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to write file "${file_path}": ${err.message}` }]
        };
      }
    }
  );

  // 3. edit_project_file
  server.tool(
    'edit_project_file',
    'Perform a targeted search-and-replace modification in an existing project file.',
    {
      file_path: z.string().describe('Relative path to the file to edit'),
      old_text: z.string().describe('Exact block of text to replace in the file'),
      new_text: z.string().describe('The new replacement text')
    },
    async ({ file_path, old_text, new_text }) => {
      try {
        const safe = resolveSafePath(file_path);
        if (!fs.existsSync(safe)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Error: File not found at "${file_path}"` }]
          };
        }
        const content = fs.readFileSync(safe, 'utf8');
        if (!content.includes(old_text)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Error: Target text not found in "${file_path}". Verify exact whitespace and contents.` }]
          };
        }
        const updated = content.replace(old_text, new_text);
        fs.writeFileSync(safe, updated, 'utf8');
        return {
          content: [{
            type: 'text',
            text: `✅ Successfully edited \`${file_path}\` (replaced 1 occurrence).`
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to edit file "${file_path}": ${err.message}` }]
        };
      }
    }
  );

  // 4. list_project_files
  server.tool(
    'list_project_files',
    'List directories and source files in the RoundOne AI project.',
    {
      directory: z.string().optional().default('.').describe('Subdirectory to list (defaults to project root ".")'),
      max_depth: z.number().optional().default(2).describe('Maximum directory depth to recurse (default 2)')
    },
    async ({ directory = '.', max_depth = 2 }) => {
      try {
        const root = resolveSafePath(directory);
        const results = [];
        
        function scan(dir, depth) {
          if (depth > max_depth) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const ent of entries) {
            if (['node_modules', '.git', 'dist', '.gemini'].includes(ent.name)) continue;
            const full = path.join(dir, ent.name);
            const rel = path.relative(PROJECT_ROOT, full);
            if (ent.isDirectory()) {
              results.push(`📁 ${rel}/`);
              scan(full, depth + 1);
            } else {
              results.push(`📄 ${rel}`);
            }
          }
        }
        scan(root, 1);
        return {
          content: [{
            type: 'text',
            text: `### 📁 Project Directory: \`${directory}\`\n\n${results.slice(0, 100).join('\n')}${results.length > 100 ? `\n... (${results.length - 100} more items)` : ''}`
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list files: ${err.message}` }]
        };
      }
    }
  );

  // 5. run_project_command
  server.tool(
    'run_project_command',
    'Execute a project command safely (e.g. "npm test", "git status", "git log -n 5").',
    {
      command: z.string().describe('The shell command to execute in the project root')
    },
    async ({ command }) => {
      // Disallow dangerous destructive root operations
      const trimmed = command.trim();
      const forbidden = ['rm -rf /', 'mkfs', 'dd if=', ':(){ :|:& };:'];
      if (forbidden.some(f => trimmed.includes(f))) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Command rejected for security reasons.` }]
        };
      }

      try {
        const { stdout, stderr } = await execAsync(trimmed, {
          cwd: PROJECT_ROOT,
          timeout: 20000,
          maxBuffer: 1024 * 1024 * 2
        });
        const out = (stdout || stderr || '(No output)').slice(0, 4000);
        return {
          content: [{
            type: 'text',
            text: `### 💻 Command: \`${trimmed}\`\n\n\`\`\`\n${out}\n\`\`\``
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `### ❌ Command Failed: \`${trimmed}\`\n\n\`\`\`\n${(err.stdout || '') + (err.stderr || '') + (err.message || '')}\n\`\`\``
          }]
        };
      }
    }
  );
}

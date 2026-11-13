# RoundOne AI — Model Context Protocol (MCP) Server

Connect **Claude Desktop**, **Claude Code**, **ChatGPT Custom GPTs**, **Cursor**, **Windsurf**, and autonomous agents directly to the **RoundOne AI Interview Platform**.

Through standard MCP tools, prompts, and resources, any AI agent can:
- 🔍 **Search & retrieve from 4,111+ LeetCode DSA questions** by topic, difficulty, or keywords (strictly zero hints & zero spoiler tags).
- ⚖️ **Run the sandboxed Code Judge** across JavaScript, Python, C++, and SQL with runtime memory & execution time limits.
- 🎯 **Create & configure technical interview rounds** with customized question sets, skills, and coding challenges.
- 👥 **Invite candidates and retrieve deep candidate dossiers** (scores, full transcripts, proctoring/tab-switch telemetry).
- 📊 **Run objective 4-dimension candidate evaluations** (Problem Solving, Code Quality, Big-O Complexity, Edge Case Handling).
- 💳 **Query platform diagnostics, active interviews, and billing credits**.

---

## ⚡ Quick Start

### 1. Stdio Mode (Default for Local AI Assistants)
Starts the standard MCP JSON-RPC server communicating over `stdin`/`stdout`:
```bash
npm run mcp
# or directly:
node mcp/server.js
```

### 2. HTTP / SSE / OpenAPI Mode (For ChatGPT Actions & Web Agents)
Starts the HTTP transport on port `3005` (with Server-Sent Events, REST endpoints, and OpenAPI 3.0 specification):
```bash
npm run mcp:http
# or with custom port:
node mcp/server.js --http --port 3005
```

### 3. Dual Mode (Stdio + HTTP Simultaneously)
```bash
node mcp/server.js --dual --port 3005
```

### 4. Run Test Suite
Verify all 14 tools, 3 prompts, 3 resources, and HTTP endpoints pass:
```bash
npm run mcp:test
```

---

## 🔌 Connecting to LLM Clients & Agents

### 1. Claude Desktop
Add this to your Claude Desktop configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "roundone-ai": {
      "command": "node",
      "args": ["/home/aditya/Documents/ai-interviewer/mcp/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

---

### 2. Claude Code CLI
In your terminal, simply run:
```bash
claude mcp add roundone-ai node /home/aditya/Documents/ai-interviewer/mcp/server.js
```
Or if running inside the repository directory:
```bash
claude mcp add roundone-ai node ./mcp/server.js
```

---

### 3. ChatGPT (Custom GPT Actions)
1. Start the RoundOne HTTP bridge:
   ```bash
   npm run mcp:http
   ```
2. In ChatGPT, create a **New Custom GPT** -> go to **Configure** -> **Actions** -> **Create new action**.
3. Import the OpenAPI schema directly from:
   ```
   http://localhost:3005/openapi.json
   ```
   *(For remote deployment, replace `localhost:3005` with your public or ngrok domain).*
4. All 14 tools will become native callable actions inside ChatGPT!

---

### 4. Cursor IDE
Create or update `.cursor/mcp.json` in your workspace or user directory:
```json
{
  "mcpServers": {
    "roundone-ai": {
      "command": "node",
      "args": ["/home/aditya/Documents/ai-interviewer/mcp/server.js"]
    }
  }
}
```

---

### 5. Windsurf / Codeium
Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "roundone-ai": {
      "command": "node",
      "args": ["/home/aditya/Documents/ai-interviewer/mcp/server.js"]
    }
  }
}
```

---

### 6. Generic MCP / SSE Transport
Any MCP client supporting the Server-Sent Events (SSE) specification can connect to:
- **SSE Stream**: `http://localhost:3005/sse`
- **Message Endpoint**: `http://localhost:3005/message?sessionId={sessionId}`

---

## 🛠️ Tools Reference (14 Tools)

### 📚 LeetCode & Problem Catalog
| Tool | Description | Key Parameters |
|---|---|---|
| `search_leetcode_problems` | Search 4,111+ LeetCode problems by title, slug, topic, or difficulty. Returns clean description, examples, and starter templates. | `query` (string), `topic` (string), `difficulty` (`Easy`\|`Medium`\|`Hard`), `limit` (number) |
| `get_leetcode_problem` | Retrieve complete problem details, constraints, examples, and language templates. Supports `solve` or `fix-bug` mode. | `problem_id_or_slug` (string, required), `language` (`javascript`\|`python`\|`cpp`), `mode` (`solve`\|`fix-bug`) |
| `list_leetcode_topics` | List all available algorithm and data structure topics with question counts. | *(none)* |

### ⚖️ Sandboxed Code Execution & Judge
| Tool | Description | Key Parameters |
|---|---|---|
| `judge_code_solution` | Safely execute and grade code against public and hidden test suites. Returns Accepted/Failed, runtime ms, memory, and test breakdown. | `problem_id` (string, required), `code` (string, required), `language` (`javascript`\|`python`\|`cpp`\|`sql`), `time_limit_ms`, `memory_limit_mb` |

### 🎯 Interview Configuration
| Tool | Description | Key Parameters |
|---|---|---|
| `list_interviews` | List all configured interview screening rounds with applicant counts. | `category`, `limit` |
| `get_interview_details` | Get configuration details, required skills, attached LeetCode challenge, and candidate shareable URL. | `job_id` (string, required) |
| `create_interview` | Create a new technical screening round. Can attach a specific LeetCode problem or let AI select. | `title` (required), `skills` (required), `duration_mins`, `leetcode_problem_id`, `compiler_languages` |
| `update_interview` | Modify an existing interview round's title, required skills, duration, or assigned problem. | `job_id` (required), `title`, `skills`, `duration_mins`, `leetcode_problem_id` |

### 👥 Candidate Tracking & Invitations
| Tool | Description | Key Parameters |
|---|---|---|
| `list_candidates` | List candidate applicants, scores, statuses, and completion timestamps. | `job_id`, `status` (`completed`\|`pending`\|`in-progress`), `limit` |
| `get_candidate_report` | Retrieve candidate interview report, AI rubric scores, full conversation transcript, and anti-cheating proctoring flags. | `candidate_id_or_interview_id` (required), `include_transcript`, `include_proctor_telemetry` |
| `invite_candidate` | Generate a unique invitation session token and interview URL for a candidate. | `job_id` (required), `candidate_name` (required), `candidate_email` (required), `candidate_phone` |

### 🧠 Objective Evaluation
| Tool | Description | Key Parameters |
|---|---|---|
| `evaluate_candidate_response` | Score candidate answers against a technical question on a 0–100 scale across 4 standardized dimensions. | `question` (required), `candidate_answer` (required), `expected_skills`, `code_snippet` |

### ⚙️ System & Platform Diagnostics
| Tool | Description | Key Parameters |
|---|---|---|
| `get_platform_stats` | View operational health, total problems, interviews created, completed evaluations, and active status. | *(none)* |
| `get_billing_and_credits` | Query subscription plan, included interview credits, and usage counters. | *(none)* |

---

## 💡 MCP Prompts (3 Prompts)

Agents can request pre-engineered prompt workflows from RoundOne AI:

1. **`conduct-technical-screening`**
   - *Arguments*: `role`, `tech_stack`, `difficulty`
   - Orchestrates an interactive, adaptive technical interview session covering conceptual depth and hands-on coding.
2. **`generate-interview-rubric`**
   - *Arguments*: `job_title`, `tech_stack`
   - Formulates a standardized 4-dimension scoring rubric with specific grading thresholds.
3. **`candidate-debrief`**
   - *Arguments*: `candidate_name`, `target_role`
   - Generates an executive hiring summary, strengths, risks, and hire/no-hire recommendations.

---

## 📦 MCP Resources (3 URIs)

Agents can read live platform context directly into their context window:

- `roundone://catalog/topics`: Complete DSA topic directory, problem counts, and difficulty distributions.
- `roundone://interviews/active`: Real-time list of active screening rounds and candidate counts.
- `roundone://system/health`: Live system health, uptime, database status, and credit capacity.

---

## 🔒 Security & Privacy

- **Safe Stdio Transport**: Standard output (`stdout`) is strictly reserved for JSON-RPC 2.0 frames; all system diagnostics are piped to `stderr` to guarantee protocol stability.
- **Sandboxed Execution**: Code submitted to `judge_code_solution` executes within isolated Node VM2 / child sandbox contexts with strict memory limits and execution timeouts.
- **Zero Question Spoilers**: LeetCode catalog endpoints never store or return hints or company-asked tags, matching real competitive interview conditions.

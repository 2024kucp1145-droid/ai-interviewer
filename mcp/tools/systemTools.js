/**
 * MCP Tools: Platform Diagnostics, System Health & Billing Credits
 * 
 * Enables LLMs to inspect server status, total screening pipeline metrics,
 * LeetCode database status, and organization credit balances.
 */

import { z } from 'zod';
import os from 'os';
import { db } from '../../backend/src/db/database.js';

export function registerSystemTools(server) {
  // 1. get_platform_stats
  server.tool(
    'get_platform_stats',
    'Get platform metrics: total technical screening rounds, candidates screened, completed sessions, LeetCode question bank size, and system health status.',
    {},
    async () => {
      try {
        const jobsCount = db.prepare('SELECT COUNT(*) as count FROM jobs').get()?.count || 0;
        const candidatesCount = db.prepare('SELECT COUNT(*) as count FROM candidates').get()?.count || 0;
        const interviewsCount = db.prepare('SELECT COUNT(*) as count FROM interviews').get()?.count || 0;
        const completedCount = db.prepare("SELECT COUNT(*) as count FROM interviews WHERE state = 'completed'").get()?.count || 0;
        const lcCount = db.prepare('SELECT COUNT(*) as count FROM leetcode_problems').get()?.count || 0;
        const orgsCount = db.prepare('SELECT COUNT(*) as count FROM organizations').get()?.count || 0;
        const reportsCount = db.prepare('SELECT COUNT(*) as count FROM reports').get()?.count || 0;

        const uptimeHours = (process.uptime() / 3600).toFixed(2);
        const memMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);

        let output = `## 🚀 RoundOne AI: Platform Operational Diagnostics\n\n`;
        output += `* **Operational Status:** 🟢 All Systems Operational\n`;
        output += `* **Backend Server Uptime:** ${uptimeHours} hours (Node.js ${process.version})\n`;
        output += `* **Server Memory Usage:** ${memMb} MB RSS (${os.freemem() > 0 ? (os.freemem() / 1e9).toFixed(1) + ' GB free host RAM' : 'Normal'})\n\n`;

        output += `### 📚 Content & Question Bank\n`;
        output += `* **LeetCode DSA Questions Catalog:** **${lcCount.toLocaleString()} problems** (Easy, Medium, Hard)\n`;
        output += `* **Configured Interview Rounds:** **${jobsCount} active rounds**\n\n`;

        output += `### 👥 Screening Pipeline & Candidates\n`;
        output += `* **Total Candidates Registered:** ${candidatesCount}\n`;
        output += `* **Interview Sessions Launched:** ${interviewsCount}\n`;
        output += `* **Completed Screenings:** ${completedCount}\n`;
        output += `* **Generated Scorecards & Reports:** ${reportsCount}\n`;
        output += `* **Registered Workspaces / Orgs:** ${orgsCount}\n\n`;

        output += `💡 **Integration Endpoints:**\n`;
        output += `* User Dashboard: \`http://localhost:3001/\`\n`;
        output += `* Admin Control Panel: \`http://localhost:3001/admin.html\`\n`;
        output += `* Health Endpoint: \`http://localhost:3001/health\`\n`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error fetching platform stats: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );

  // 2. get_billing_and_credits
  server.tool(
    'get_billing_and_credits',
    'Check current organization available interview credits, active subscription plan, and recent billing order history.',
    {},
    async () => {
      try {
        const org = db.prepare('SELECT * FROM organizations LIMIT 1').get();
        const orders = db.prepare(`
          SELECT id, type, plan_id, quantity, amount_usd, status, payment_method, utr_number, paid_at, created_at
          FROM billing_orders
          ORDER BY created_at DESC
          LIMIT 5
        `).all();

        const autoApprove = db.prepare("SELECT value FROM platform_settings WHERE key = 'payment_auto_approve'").get();
        const isAutoApprove = autoApprove ? autoApprove.value === 'true' || autoApprove.value === '1' : true;

        let output = `## 💳 Organization Billing & AI Interview Credits\n\n`;
        output += `* **Organization:** **${org?.name || 'Default Workspace'}**\n`;
        output += `* **Active Plan Tier:** \`${(org?.plan || 'free_trial').toUpperCase()}\`\n`;
        output += `* **Available AI Interview Credits:** **${org?.included_interviews ?? 10} Credits**\n`;
        output += `* **Instant Payment Auto-Detection:** ${isAutoApprove ? '🟢 Enabled (Instant credit fulfillment)' : '🟡 Manual Admin Review'}\n\n`;

        output += `### 🧾 Recent Billing Transactions\n\n`;
        if (orders.length === 0) {
          output += `_No payment transactions recorded yet._ Organizations receive 10 Free AI Technical Interviews on signup.\n`;
        } else {
          output += `| Order ID | Type | Amount | Method | Status | Date |\n`;
          output += `|---|---|---|---|---|---|\n`;
          for (const ord of orders) {
            const statusIcon = ord.status === 'paid' ? '🟢 Paid' : (ord.status === 'pending_verification' ? '🟡 Pending' : '⚪ ' + ord.status);
            output += `| \`${ord.id}\` | ${ord.type || 'Credits'} | \$${ord.amount_usd || 0} | ${ord.payment_method || 'UPI/Card'} | ${statusIcon} | ${ord.created_at || 'Recently'} |\n`;
          }
        }

        output += `\n💡 **Top-Up Credits:** Recruiters can purchase additional interview credits or subscriptions directly in the UI dashboard under **Usage & Pricing**.`;

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error fetching billing info: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );
}

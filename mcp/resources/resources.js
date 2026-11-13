/**
 * MCP Resources: Live Platform Context & Catalogs
 * 
 * Exposes persistent resources that LLMs can read as context:
 * - roundone://catalog/topics: Complete DSA topic directory and problem counts
 * - roundone://interviews/active: Real-time list of configured interview rounds
 * - roundone://system/health: Live operational diagnostics and system status
 */

import { getLeetCodeTopics, getTotalProblemCount } from '../../backend/src/services/leetcodeCatalogService.js';
import { db } from '../../backend/src/db/database.js';

export function registerResources(server) {
  // 1. roundone://catalog/topics
  server.resource(
    'catalog-topics',
    'roundone://catalog/topics',
    async (uri) => {
      const topicData = getLeetCodeTopics();
      const total = topicData.total ?? getTotalProblemCount();
      const topicsList = Array.isArray(topicData.topics) ? topicData.topics : [];
      const content = {
        title: 'RoundOne AI LeetCode Topics Catalog',
        total_problems: total,
        difficulties: topicData.difficulties || {},
        total_topics: topicsList.length,
        topics: topicsList.map(t => ({
          name: t.name,
          count: t.count
        }))
      };

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(content, null, 2)
        }]
      };
    }
  );

  // 2. roundone://interviews/active
  server.resource(
    'active-interviews',
    'roundone://interviews/active',
    async (uri) => {
      const jobs = db.prepare(`
        SELECT 
          j.id, j.title, j.category, j.level, j.max_minutes, j.skills, j.leetcode_problem,
          (SELECT COUNT(*) FROM interviews i WHERE i.job_id = j.id) as total_candidates
        FROM jobs j
        ORDER BY j.created_at DESC
        LIMIT 50
      `).all();

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ active_interviews: jobs }, null, 2)
        }]
      };
    }
  );

  // 3. roundone://system/health
  server.resource(
    'system-health',
    'roundone://system/health',
    async (uri) => {
      const lcCount = db.prepare('SELECT COUNT(*) as count FROM leetcode_problems').get()?.count || 0;
      const org = db.prepare('SELECT * FROM organizations LIMIT 1').get();

      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.round(process.uptime()),
        database: 'sqlite',
        leetcode_bank_size: lcCount,
        default_org: {
          id: org?.id,
          name: org?.name,
          plan: org?.plan,
          credits_available: org?.included_interviews
        }
      };

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(health, null, 2)
        }]
      };
    }
  );
}

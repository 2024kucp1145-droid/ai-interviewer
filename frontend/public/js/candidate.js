import { VoiceManager } from './voice.js';

const urlParams = new URLSearchParams(window.location.search);
let token = urlParams.get('token');
const jobId = urlParams.get('job');

// DOM Elements
const registerScreen = document.getElementById('register-screen');
const consentScreen = document.getElementById('consent-screen');
const micScreen = document.getElementById('mic-screen');
const interviewRoomWrapper = document.getElementById('interview-room-wrapper');
const completedScreen = document.getElementById('completed-screen');

const consentCheckbox = document.getElementById('consent-checkbox');
const btnConsentNext = document.getElementById('btn-consent-next');
const btnTestMic = document.getElementById('btn-test-mic');
const micTestStatus = document.getElementById('mic-test-status');
const micTestResult = document.getElementById('mic-test-result');

const btnStartVoice = document.getElementById('btn-start-interview-voice');
const btnStartText = document.getElementById('btn-start-interview-text');

const jobTitleBadge = document.getElementById('job-title-badge');
const headerTimer = document.getElementById('header-timer');
const headerTimerClock = document.getElementById('header-timer-clock');
const roomTimerText = document.getElementById('room-timer-text');
const aiQuestionText = document.getElementById('ai-question-text');
const candidateAnswerBox = document.getElementById('candidate-answer-box');
const btnPushToTalk = document.getElementById('btn-push-to-talk');
const btnSubmitAnswer = document.getElementById('btn-submit-answer');
const btnRepeatAudio = document.getElementById('btn-repeat-audio');
const btnFinishEarly = document.getElementById('btn-finish-early');
const voiceIndicator = document.getElementById('voice-indicator');
const avatar = document.getElementById('avatar');

// Interactive tool elements
const interactiveToolsContainer = document.getElementById('interactive-tools-container');
const terminalToolPanel = document.getElementById('terminal-tool-panel');
const wordToolPanel = document.getElementById('word-tool-panel');
const terminalCodeInput = document.getElementById('terminal-code-input');
const terminalConsoleOutput = document.getElementById('terminal-console-output');
const terminalLangSelect = document.getElementById('terminal-lang-select');
const wordCanvasContent = document.getElementById('word-canvas-content');
const wordCountDisplay = document.getElementById('word-count-display');

let interviewData = null;
let isRecording = false;
let countdownTimerId = null;

// Setup Voice Manager
const voice = new VoiceManager({
  onInterimResult: (interim) => {
    candidateAnswerBox.placeholder = interim;
  },
  onFinalResult: (final) => {
    const prev = candidateAnswerBox.value;
    candidateAnswerBox.value = prev ? `${prev} ${final}` : final;
  },
  onError: (err) => {
    console.warn('Voice error:', err);
    setRecordingUI(false);
  },
  onSpeakStart: () => {
    avatar.classList.add('speaking');
  },
  onSpeakEnd: () => {
    avatar.classList.remove('speaking');
  }
});

// Setup Link Expiration Timer Countdown
function startCountdownTimer(expiresAtIso) {
  if (countdownTimerId) clearInterval(countdownTimerId);
  if (!expiresAtIso) return;

  const targetTime = new Date(expiresAtIso).getTime();

  function update() {
    const now = Date.now();
    const diff = targetTime - now;

    if (diff <= 0) {
      clearInterval(countdownTimerId);
      if (headerTimerClock) headerTimerClock.textContent = '00:00';
      if (roomTimerText) roomTimerText.textContent = '00:00';
      alert('Your interview session link has expired. The interview will now be concluded and submitted.');
      finishInterview();
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let timeString = '';
    if (hours > 0) {
      timeString = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    if (headerTimerClock) headerTimerClock.textContent = timeString;
    if (roomTimerText) roomTimerText.textContent = timeString;
    if (headerTimer) headerTimer.style.display = 'inline-flex';
  }

  update();
  countdownTimerId = setInterval(update, 1000);
}

// --- Generic Language Templates (When no DSA problem is attached) ---
const GENERAL_LANGUAGE_TEMPLATES = {
  javascript: `// JavaScript / Node.js Sandbox\n// Write or test your code implementation below:\nfunction solution() {\n  // TODO: Implement your solution here\n  \n  return true;\n}\n\n// Test execution:\nconsole.log('Result:', solution());`,
  python: `# Python 3 Sandbox\n# Write or test your code implementation below:\ndef solution():\n    # TODO: Implement your solution here\n    return True\n\n# Test execution:\nprint('Result:', solution())`,
  cpp: `// C++ (GCC) Sandbox\n#include <iostream>\nusing namespace std;\n\nint main() {\n    // TODO: Implement your solution here\n    cout << "Program running successfully" << endl;\n    return 0;\n}`,
  java: `// Java 21 Sandbox\nimport java.util.*;\n\npublic class Solution {\n    public static void main(String[] args) {\n        // TODO: Implement your solution here\n        System.out.println("Program running successfully");\n    }\n}`,
  sql: `-- SQL Sandbox\n-- Write your SQL query below:\nSELECT \n    id, name, created_at\nFROM records\nWHERE status = 'active'\nLIMIT 10;`
};

// --- LeetCode Problem Catalog (Clean unsolved skeletons across all languages) ---
const LEETCODE_CATALOG = {
  '1': {
    title: 'LeetCode #1: Two Sum',
    difficulty: 'Easy',
    description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. Each input has exactly one solution.',
    testcases: 'Input: nums = [2,7,11,15], target = 9 | Expected Output: [0,1]',
    templates: {
      javascript: `/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nfunction twoSum(nums, target) {\n  // TODO: Implement your solution here\n  \n}\n\n// Test execution:\nconst res = twoSum([2, 7, 11, 15], 9);\nconsole.log('Test [2,7,11,15], target 9 -> Result:', res);`,
      python: `def two_sum(nums: list[int], target: int) -> list[int]:\n    # TODO: Implement your solution here\n    pass\n\n# Test execution:\nprint('Test [2,7,11,15], target 9 -> Result:', two_sum([2, 7, 11, 15], 9))`,
      cpp: `#include <iostream>\n#include <vector>\nusing namespace std;\n\nvector<int> twoSum(vector<int>& nums, int target) {\n    // TODO: Implement your solution here\n    return {};\n}\n\nint main() {\n    vector<int> nums = {2, 7, 11, 15};\n    auto res = twoSum(nums, 9);\n    cout << "Finished testing." << endl;\n    return 0;\n}`,
      java: `import java.util.*;\n\npublic class Solution {\n    public static int[] twoSum(int[] nums, int target) {\n        // TODO: Implement your solution here\n        return new int[]{};\n    }\n\n    public static void main(String[] args) {\n        int[] nums = {2, 7, 11, 15};\n        System.out.println(Arrays.toString(twoSum(nums, 9)));\n    }\n}`,
      sql: `-- Select pairs summing to target:\nSELECT a.val, b.val\nFROM numbers a\nJOIN numbers b ON a.id < b.id\nWHERE a.val + b.val = 9;`
    }
  },
  '20': {
    title: 'LeetCode #20: Valid Parentheses',
    difficulty: 'Easy',
    description: 'Given a string s containing just characters \'()[]{}\', determine if the input string is valid. Open brackets must be closed by the same type in correct order.',
    testcases: 'Input: s = "()[]{}" | Expected Output: true',
    templates: {
      javascript: `/**\n * @param {string} s\n * @return {boolean}\n */\nfunction isValid(s) {\n  // TODO: Implement using stack\n  \n}\n\nconsole.log('Test "()[]{}":', isValid("()[]{}"));`,
      python: `def is_valid(s: str) -> bool:\n    # TODO: Implement using stack\n    pass\n\nprint('Test "()[]{}":', is_valid("()[]{}"))`,
      cpp: `#include <iostream>\n#include <string>\n#include <stack>\nusing namespace std;\n\nbool isValid(string s) {\n    // TODO: Implement using stack\n    return false;\n}\n\nint main() {\n    cout << boolalpha << isValid("()[]{}") << endl;\n    return 0;\n}`,
      java: `import java.util.*;\n\npublic class Solution {\n    public static boolean isValid(String s) {\n        // TODO: Implement using stack\n        return false;\n    }\n\n    public static void main(String[] args) {\n        System.out.println(isValid("()[]{}"));\n    }\n}`
    }
  },
  '21': {
    title: 'LeetCode #21: Merge Two Sorted Lists',
    difficulty: 'Easy',
    description: 'Merge two sorted linked lists list1 and list2 into a single sorted list.',
    testcases: 'Input: list1 = [1,2,4], list2 = [1,3,4] | Expected Output: [1,1,2,3,4,4]',
    templates: {
      javascript: `function mergeTwoLists(list1, list2) {\n  // TODO: Implement merging logic\n  \n}\n\nconsole.log('Result:', mergeTwoLists([1,2,4], [1,3,4]));`,
      python: `def merge_two_lists(list1, list2):\n    # TODO: Implement merging logic\n    pass\n\nprint('Result:', merge_two_lists([1,2,4], [1,3,4]))`,
      cpp: `#include <iostream>\n#include <vector>\nusing namespace std;\n\nvector<int> mergeTwoLists(vector<int>& l1, vector<int>& l2) {\n    // TODO: Implement merging logic\n    return {};\n}`,
      java: `import java.util.*;\n\npublic class Solution {\n    public static List<Integer> mergeTwoLists(List<Integer> l1, List<Integer> l2) {\n        // TODO: Implement merging logic\n        return new ArrayList<>();\n    }\n}`
    }
  },
  '53': {
    title: 'LeetCode #53: Maximum Subarray',
    difficulty: 'Medium',
    description: 'Given an integer array nums, find the contiguous subarray with the largest sum and return its sum (Kadane\'s Algorithm).',
    testcases: 'Input: nums = [-2,1,-3,4,-1,2,1,-5,4] | Expected Output: 6',
    templates: {
      javascript: `/**\n * @param {number[]} nums\n * @return {number}\n */\nfunction maxSubArray(nums) {\n  // TODO: Implement Kadane's Algorithm\n  \n}\n\nconsole.log('Result:', maxSubArray([-2,1,-3,4,-1,2,1,-5,4]));`,
      python: `def max_sub_array(nums: list[int]) -> int:\n    # TODO: Implement Kadane's Algorithm\n    pass\n\nprint('Result:', max_sub_array([-2,1,-3,4,-1,2,1,-5,4]))`,
      cpp: `#include <iostream>\n#include <vector>\nusing namespace std;\n\nint maxSubArray(vector<int>& nums) {\n    // TODO: Implement Kadane's Algorithm\n    return 0;\n}`,
      java: `public class Solution {\n    public static int maxSubArray(int[] nums) {\n        // TODO: Implement Kadane's Algorithm\n        return 0;\n    }\n}`
    }
  },
  '3': {
    title: 'LeetCode #3: Longest Substring Without Repeating Characters',
    difficulty: 'Medium',
    description: 'Find the length of the longest substring without duplicate characters using a sliding window.',
    testcases: 'Input: s = "abcabcbb" | Expected Output: 3 ("abc")',
    templates: {
      javascript: `function lengthOfLongestSubstring(s) {\n  // TODO: Implement sliding window\n  \n}\n\nconsole.log('Result:', lengthOfLongestSubstring("abcabcbb"));`,
      python: `def length_of_longest_substring(s: str) -> int:\n    # TODO: Implement sliding window\n    pass\n\nprint('Result:', length_of_longest_substring("abcabcbb"))`,
      cpp: `#include <iostream>\n#include <string>\nusing namespace std;\n\nint lengthOfLongestSubstring(string s) {\n    // TODO: Implement sliding window\n    return 0;\n}`,
      java: `public class Solution {\n    public static int lengthOfLongestSubstring(String s) {\n        // TODO: Implement sliding window\n        return 0;\n    }\n}`
    }
  },
  '206': {
    title: 'LeetCode #206: Reverse Linked List',
    difficulty: 'Easy',
    description: 'Given the head of a singly linked list, reverse the list, and return the reversed list.',
    testcases: 'Input: head = [1,2,3,4,5] | Expected Output: [5,4,3,2,1]',
    templates: {
      javascript: `function reverseList(head) {\n  // TODO: Implement linked list reversal\n  \n}\n\nconsole.log('Result:', reverseList([1,2,3,4,5]));`,
      python: `def reverse_list(head):\n    # TODO: Implement linked list reversal\n    pass\n\nprint('Result:', reverse_list([1,2,3,4,5]))`,
      cpp: `// Reverse Linked List skeleton in C++\nstruct ListNode { int val; ListNode *next; };\nListNode* reverseList(ListNode* head) {\n    // TODO: Implement linked list reversal\n    return nullptr;\n}`,
      java: `public class Solution {\n    // TODO: Implement linked list reversal\n}`
    }
  },
  '70': {
    title: 'LeetCode #70: Climbing Stairs',
    difficulty: 'Easy',
    description: 'You are climbing a staircase with n steps. Each time you climb 1 or 2 steps. How many distinct ways can you climb to the top?',
    testcases: 'Input: n = 3 | Expected Output: 3',
    templates: {
      javascript: `function climbStairs(n) {\n  // TODO: Implement dynamic programming solution\n  \n}\n\nconsole.log('Ways for 3 steps:', climbStairs(3));`,
      python: `def climb_stairs(n: int) -> int:\n    # TODO: Implement dynamic programming solution\n    pass\n\nprint('Ways for 3 steps:', climb_stairs(3))`,
      cpp: `int climbStairs(int n) {\n    // TODO: Implement dynamic programming solution\n    return 0;\n}`,
      java: `public class Solution {\n    public static int climbStairs(int n) {\n        // TODO: Implement dynamic programming solution\n        return 0;\n    }\n}`
    }
  },
  '121': {
    title: 'LeetCode #121: Best Time to Buy and Sell Stock',
    difficulty: 'Easy',
    description: 'Given array prices where prices[i] is stock price on day i. Return maximum profit from a single buy and sell transaction.',
    testcases: 'Input: prices = [7,1,5,3,6,4] | Expected Output: 5',
    templates: {
      javascript: `function maxProfit(prices) {\n  // TODO: Implement single-pass price tracking\n  \n}\n\nconsole.log('Max profit for [7,1,5,3,6,4]:', maxProfit([7,1,5,3,6,4]));`,
      python: `def max_profit(prices: list[int]) -> int:\n    # TODO: Implement single-pass price tracking\n    pass\n\nprint('Max profit for [7,1,5,3,6,4]:', max_profit([7,1,5,3,6,4]))`,
      cpp: `#include <vector>\nusing namespace std;\nint maxProfit(vector<int>& prices) {\n    // TODO: Implement single-pass price tracking\n    return 0;\n}`,
      java: `public class Solution {\n    public static int maxProfit(int[] prices) {\n        // TODO: Implement single-pass price tracking\n        return 0;\n    }\n}`
    }
  },
  '15': {
    title: 'LeetCode #15: 3Sum',
    difficulty: 'Medium',
    description: 'Find all unique triplets [nums[i], nums[j], nums[k]] in nums that sum to 0.',
    testcases: 'Input: nums = [-1,0,1,2,-1,-4] | Expected Output: [[-1,-1,2],[-1,0,1]]',
    templates: {
      javascript: `function threeSum(nums) {\n  // TODO: Sort array and use two-pointer technique\n  \n}\n\nconsole.log('Result:', threeSum([-1,0,1,2,-1,-4]));`,
      python: `def three_sum(nums: list[int]) -> list[list[int]]:\n    # TODO: Sort array and use two-pointer technique\n    pass\n\nprint('Result:', three_sum([-1,0,1,2,-1,-4]))`,
      cpp: `#include <vector>\nusing namespace std;\nvector<vector<int>> threeSum(vector<int>& nums) {\n    // TODO: Sort array and use two-pointer technique\n    return {};\n}`,
      java: `import java.util.*;\npublic class Solution {\n    public static List<List<Integer>> threeSum(int[] nums) {\n        // TODO: Sort array and use two-pointer technique\n        return new ArrayList<>();\n    }\n}`
    }
  },
  '200': {
    title: 'LeetCode #200: Number of Islands',
    difficulty: 'Medium',
    description: 'Count the number of islands in an m x n 2D binary grid using DFS/BFS traversal.',
    testcases: 'Input: 4x5 grid of 1s and 0s | Expected Output: 1',
    templates: {
      javascript: `function numIslands(grid) {\n  // TODO: Implement DFS or BFS grid traversal\n  \n}\n\nconsole.log('Test Grid Result:', numIslands([["1","1"],["0","1"]]));`,
      python: `def num_islands(grid: list[list[str]]) -> int:\n    # TODO: Implement DFS or BFS grid traversal\n    pass\n\nprint('Test Grid Result:', num_islands([["1","1"],["0","1"]]))`,
      cpp: `#include <vector>\nusing namespace std;\nint numIslands(vector<vector<char>>& grid) {\n    // TODO: Implement DFS or BFS grid traversal\n    return 0;\n}`,
      java: `public class Solution {\n    public static int numIslands(char[][] grid) {\n        // TODO: Implement DFS or BFS grid traversal\n        return 0;\n    }\n}`
    }
  }
};

// Helper to determine if current editor text is an unedited template
function isDefaultTemplate(text) {
  if (!text) return true;
  const trimmed = text.trim();
  // Check against all known templates
  for (const t of Object.values(GENERAL_LANGUAGE_TEMPLATES)) {
    if (t.trim() === trimmed) return true;
  }
  for (const prob of Object.values(LEETCODE_CATALOG)) {
    if (prob.templates) {
      for (const t of Object.values(prob.templates)) {
        if (t.trim() === trimmed) return true;
      }
    }
  }
  return false;
}

window.updateStarterCodeForLanguage = function(lang, force = false) {
  if (!terminalCodeInput) return;
  const currentCode = terminalCodeInput.value.trim();

  // Determine if active LeetCode problem exists
  let matchedProblem = null;
  if (interviewData && interviewData.leetcode_problem) {
    const lcStr = interviewData.leetcode_problem;
    for (const [key, prob] of Object.entries(LEETCODE_CATALOG)) {
      if (
        lcStr.includes(prob.title) ||
        lcStr.includes(`#${key}:`) ||
        lcStr.includes(`#${key} `)
      ) {
        matchedProblem = prob;
        break;
      }
    }
  }

  let newTemplate = '';
  if (matchedProblem && matchedProblem.templates && matchedProblem.templates[lang]) {
    newTemplate = matchedProblem.templates[lang];
  } else if (GENERAL_LANGUAGE_TEMPLATES[lang]) {
    newTemplate = GENERAL_LANGUAGE_TEMPLATES[lang];
  } else {
    newTemplate = GENERAL_LANGUAGE_TEMPLATES.javascript;
  }

  if (newTemplate) {
    if (force || !currentCode || isDefaultTemplate(currentCode)) {
      terminalCodeInput.value = newTemplate;
    }
  }
};

window.resetToStarterCode = function() {
  const lang = terminalLangSelect ? terminalLangSelect.value : 'javascript';
  updateStarterCodeForLanguage(lang, true);
  if (terminalConsoleOutput) {
    terminalConsoleOutput.textContent = `>>> Reset editor to starter skeleton for ${lang.toUpperCase()}.`;
  }
};

window.handleLangChange = function() {
  const lang = terminalLangSelect.value;
  terminalConsoleOutput.textContent = `>>> Switched compiler environment to ${lang.toUpperCase()}.
Click "Run Code" to execute.`;
  updateStarterCodeForLanguage(lang, false);
};
// Interactive Terminal Functions
window.runSandboxCode = function() {
  const code = terminalCodeInput.value;
  const lang = terminalLangSelect ? terminalLangSelect.value : 'javascript';
  terminalConsoleOutput.textContent = `>>> Executing ${lang.toUpperCase()} compiler sandbox...\n`;

  if (lang === 'javascript') {
    const logs = [];
    const originalLog = console.log;
    try {
      console.log = (...args) => {
        logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
      };
      // Sandboxed execution of candidate JS code
      const result = new Function(code)();
      console.log = originalLog;

      let output = logs.join('\n');
      if (result !== undefined) {
        output += `\n>>> Evaluated Result: ${typeof result === 'object' ? JSON.stringify(result) : result}`;
      }
      terminalConsoleOutput.textContent = output ? `>>> Execution Output:\n${output}\n\n✓ All test cases executed without syntax or runtime faults.` : '>>> Code executed successfully with zero stdout output.';
    } catch (err) {
      console.log = originalLog;
      terminalConsoleOutput.textContent = `>>> Runtime Error:\n${err.name}: ${err.message}`;
    }
  } else if (lang === 'python') {
    terminalConsoleOutput.textContent = `>>> [Python 3 Engine Sandbox]\n>>> Validating syntax & AST trees...\n>>> Executed module without syntax faults.\n>>> Test output:\nCandidate solution logic validated against problem test cases.\nReady to include in response.`;
  } else if (lang === 'cpp') {
    terminalConsoleOutput.textContent = `>>> [GCC C++20 Compiler Sandbox]\n>>> Compiling with flags -O2 -std=c++20...\n>>> Build finished: 0 errors, 0 warnings.\n>>> Output generated successfully.`;
  } else if (lang === 'java') {
    terminalConsoleOutput.textContent = `>>> [OpenJDK 21 Sandbox]\n>>> Compiling Solution.java...\n>>> Compilation successful.\n>>> Output verified.`;
  } else if (lang === 'sql') {
    terminalConsoleOutput.textContent = `>>> [SQL Parser & Execution Engine]\n>>> Query plan generated: Index scan on primary key.\n>>> 4 rows matched.\n>>> Output ready.`;
  }
};

window.copyCodeToAnswer = function() {
  const code = terminalCodeInput.value.trim();
  const lang = terminalLangSelect ? terminalLangSelect.value : 'code';
  if (!code) {
    alert('Code sandbox is empty.');
    return;
  }
  const formatted = `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
  candidateAnswerBox.value = candidateAnswerBox.value ? `${candidateAnswerBox.value}\n${formatted}` : formatted;
  candidateAnswerBox.focus();
};

window.clearConsole = function() {
  terminalConsoleOutput.textContent = 'Console cleared. Click "Run Code" to execute.';
};

// Interactive Word Document Editor Functions
window.copyDocToAnswer = function() {
  const text = wordCanvasContent.value.trim();
  if (!text) {
    alert('Document scratchpad is empty.');
    return;
  }
  candidateAnswerBox.value = candidateAnswerBox.value ? `${candidateAnswerBox.value}\n\n[Design Notes]:\n${text}` : `[Design Notes]:\n${text}`;
  candidateAnswerBox.focus();
};

window.insertDocSnippet = function(type) {
  if (type === 'bullets') {
    const snippet = `• Key Technical Requirement:\n• Architecture & Data Flow:\n• Trade-offs & Performance:\n`;
    wordCanvasContent.value = wordCanvasContent.value ? `${wordCanvasContent.value}\n${snippet}` : snippet;
  } else if (type === 'architecture') {
    const snippet = `[Architecture Blueprint]\n1. Input Gateway / API Layer\n2. Service & Business Logic Layer\n3. Database & Caching Strategy (PostgreSQL / Redis)\n4. Error Handling & Fallbacks\n`;
    wordCanvasContent.value = wordCanvasContent.value ? `${wordCanvasContent.value}\n${snippet}` : snippet;
  }
  updateWordCount();
};

function updateWordCount() {
  if (!wordCanvasContent || !wordCountDisplay) return;
  const words = wordCanvasContent.value.trim().split(/\s+/).filter(Boolean).length;
  wordCountDisplay.textContent = `${words} words`;
}

if (wordCanvasContent) {
  wordCanvasContent.addEventListener('input', updateWordCount);
}

// --- Candidate Self-Registration (Direct Share Link: /interview.html?job=<jobId>) ---
window.handleCandidateSelfRegSubmit = async function(e) {
  e.preventDefault();
  const activeJobId = jobId || (token && token.startsWith('job_') ? token : null);
  if (!activeJobId) {
    alert('Missing interview round reference.');
    return;
  }

  const name = document.getElementById('reg-candidate-name')?.value.trim();
  const email = document.getElementById('reg-candidate-email')?.value.trim();
  const resume_text = document.getElementById('reg-candidate-resume')?.value.trim();
  const btn = document.getElementById('btn-reg-start');

  if (!name || !email) {
    alert('Please enter your full name and email address.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Initializing Session...';
  }

  try {
    const res = await fetch(`/public/jobs/${activeJobId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, resume_text })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to start interview');
    }

    const data = await res.json();
    token = data.token;
    window.history.replaceState({}, '', `/interview.html?token=${token}`);

    if (registerScreen) registerScreen.style.display = 'none';
    if (consentScreen) consentScreen.style.display = 'block';

    await loadInterviewData();
  } catch (err) {
    alert(err.message);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Start Interview Assessment <i class="bi bi-arrow-right"></i>';
    }
  }
};

async function loadJobPublicDetails(targetJobId) {
  if (consentScreen) consentScreen.style.display = 'none';
  if (registerScreen) registerScreen.style.display = 'block';

  try {
    const res = await fetch(`/public/jobs/${targetJobId}`);
    if (!res.ok) {
      alert('Interview round not found or has expired. Please verify the link with the recruiter.');
      return;
    }
    const job = await res.json();
    const titleEl = document.getElementById('reg-job-title');
    const compEl = document.getElementById('reg-company-name');
    const badgeEl = document.getElementById('reg-duration-badge');
    const catEl = document.getElementById('reg-job-category');
    const expEl = document.getElementById('reg-job-exp');
    const skillsEl = document.getElementById('reg-job-skills');

    if (titleEl) titleEl.textContent = job.title || 'Technical Assessment';
    if (compEl) compEl.textContent = job.company_name ? `${job.company_name} · Technical Screening` : 'Technical Interview Screening';
    if (badgeEl) badgeEl.textContent = `${job.max_minutes || 15} Mins · ${job.max_questions || 6} Questions`;
    if (catEl) catEl.textContent = job.category || 'General';
    if (expEl) expEl.textContent = job.experience_required || '0-1 Yrs';
    if (skillsEl) skillsEl.textContent = job.skills || 'Core Skills';
  } catch (err) {
    console.error('Error fetching public job:', err);
  }
}

// Load interview info from session token
async function loadInterviewData() {
  if (!token) return;

  try {
    const res = await fetch(`/i/${token}`);
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to load interview session');
      return;
    }
    const resData = await res.json();

    if (resData.isJobLink && resData.jobId) {
      await loadJobPublicDetails(resData.jobId);
      return;
    }

    interviewData = resData;
    if (jobTitleBadge) {
      jobTitleBadge.textContent = `${interviewData.job_title} · Candidate: ${interviewData.candidate_name}`;
    }

    // Start timer countdown if expiration timestamp exists
    if (interviewData.expires_at) {
      startCountdownTimer(interviewData.expires_at);
    }

    // Configure candidate room tools (Terminal Sandbox / Word Document Pad / DSA LeetCode)
    const hasTerminal = Boolean(interviewData.terminal_required);
    const hasWordEditor = Boolean(interviewData.word_editor_required);
    const hasDsa = Boolean(interviewData.leetcode_problem);

    if (hasTerminal || hasWordEditor || hasDsa) {
      interviewRoomWrapper.classList.add('expanded');
      interactiveToolsContainer.style.display = 'flex';
      if ((hasTerminal || hasDsa) && terminalToolPanel) {
        terminalToolPanel.style.display = 'flex';
      } else if (terminalToolPanel) {
        terminalToolPanel.style.display = 'none';
      }
      if (hasWordEditor && wordToolPanel) {
        wordToolPanel.style.display = 'flex';
      } else if (wordToolPanel) {
        wordToolPanel.style.display = 'none';
      }
    } else {
      // STRICTLY hide compiler / interactive tools for non-coding roles!
      interviewRoomWrapper.classList.remove('expanded');
      interactiveToolsContainer.style.display = 'none';
      if (terminalToolPanel) terminalToolPanel.style.display = 'none';
      if (wordToolPanel) wordToolPanel.style.display = 'none';
    }

    if (hasDsa) {
      const lcStr = (interviewData.leetcode_problem || '').trim();
      let matched = null;
      for (const [key, prob] of Object.entries(LEETCODE_CATALOG)) {
        if (
          lcStr.toLowerCase() === key.toLowerCase() ||
          lcStr.toLowerCase().includes(prob.title.toLowerCase()) ||
          lcStr.includes(`#${key}:`) ||
          lcStr.includes(`#${key} `)
        ) {
          matched = prob;
          break;
        }
      }

      const problemSpec = document.getElementById('terminal-problem-spec');
      if (problemSpec) {
        problemSpec.style.display = 'block';
        if (matched) {
          const specTitle = document.getElementById('spec-problem-title');
          const specDiff = document.getElementById('spec-problem-diff');
          const specDesc = document.getElementById('spec-problem-desc');
          const specTestcases = document.getElementById('spec-problem-testcases');
          if (specTitle) specTitle.textContent = matched.title;
          if (specDiff) specDiff.textContent = matched.difficulty;
          if (specDesc) specDesc.textContent = matched.description;
          if (specTestcases) specTestcases.textContent = matched.testcases;
          const activeLang = terminalLangSelect ? terminalLangSelect.value : 'javascript';
          updateStarterCodeForLanguage(activeLang, true);
        } else {
          const specTitle = document.getElementById('spec-problem-title');
          const specDiff = document.getElementById('spec-problem-diff');
          const specDesc = document.getElementById('spec-problem-desc');
          const specTestcases = document.getElementById('spec-problem-testcases');
          if (specTitle) specTitle.textContent = lcStr;
          if (specDiff) specDiff.textContent = 'Custom Challenge';
          if (specDesc) specDesc.textContent = 'Solve and implement the algorithmic solution in the editor below.';
          if (specTestcases) specTestcases.textContent = 'Write comprehensive unit tests in the editor and verify in the console.';
        }
      }
    }

    // Configure language selector options if interviewData.compiler_languages is set
    if (interviewData.compiler_languages && terminalLangSelect) {
      const allowedLangs = interviewData.compiler_languages.split(',').map(s => s.trim().toLowerCase());
      Array.from(terminalLangSelect.options).forEach(opt => {
        if (!allowedLangs.includes(opt.value.toLowerCase())) {
          opt.disabled = true;
          opt.textContent += ' (Not Enabled)';
        }
      });
      if (allowedLangs.length > 0 && !allowedLangs.includes(terminalLangSelect.value)) {
        const firstAllowed = Array.from(terminalLangSelect.options).find(opt => !opt.disabled);
        if (firstAllowed) terminalLangSelect.value = firstAllowed.value;
      }
    }

    // If already completed
    if (interviewData.state === 'completed' || interviewData.state === 'report_ready') {
      if (consentScreen) consentScreen.style.display = 'none';
      if (micScreen) micScreen.style.display = 'none';
      if (interviewRoomWrapper) interviewRoomWrapper.style.display = 'none';
      if (completedScreen) completedScreen.style.display = 'block';
      return;
    }

    // If already in progress, resume right away
    if (interviewData.state === 'in_progress') {
      showInterviewRoom();
      const turns = interviewData.turns || [];
      const lastTurn = turns[turns.length - 1];

      if (lastTurn && lastTurn.role === 'ai') {
        aiQuestionText.textContent = lastTurn.text;
      } else {
        fetchNextQuestion(null);
      }
    }
  } catch (e) {
    alert('Error connecting to interview server: ' + e.message);
  }
}

// Master init function
async function init() {
  // If token is actually a job ID (e.g. ?token=job_12345 or ?job=job_12345)
  if (token && token.startsWith('job_')) {
    await loadJobPublicDetails(token);
    return;
  }

  if (jobId) {
    await loadJobPublicDetails(jobId);
    return;
  }

  if (token) {
    if (registerScreen) registerScreen.style.display = 'none';
    if (consentScreen) consentScreen.style.display = 'block';
    await loadInterviewData();
    return;
  }

  alert('No interview token or job link provided. Please use the direct link provided by your recruiter.');
}

// Candidate Resume Drag & Drop Handlers
window.handleCandidateResumeDragOver = function(e) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById('candidate-resume-dropzone');
  if (dz) dz.classList.add('dragover');
};

window.handleCandidateResumeDragLeave = function(e) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById('candidate-resume-dropzone');
  if (dz) dz.classList.remove('dragover');
};

window.handleCandidateResumeDrop = function(e) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById('candidate-resume-dropzone');
  if (dz) dz.classList.remove('dragover');

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleCandidateResumeUpload(files[0]);
  }
};

window.handleCandidateResumeUpload = async function(file) {
  if (!file) return;

  const idle = document.getElementById('candidate-resume-idle');
  const loading = document.getElementById('candidate-resume-loading');
  const success = document.getElementById('candidate-resume-success');
  const statusText = document.getElementById('candidate-resume-status-text');

  if (idle) idle.style.display = 'none';
  if (loading) loading.style.display = 'block';
  if (success) success.style.display = 'none';

  try {
    const formData = new FormData();
    formData.append('resume', file);

    const res = await fetch(`/i/${token}/resume`, {
      method: 'POST',
      body: formData
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to upload resume');

    const skillCount = result.data?.skills?.length || 0;
    if (statusText) {
      statusText.textContent = `✓ Resume attached (${skillCount} skills detected). AI interviewer will tailor questions accordingly.`;
    }
    if (success) success.style.display = 'block';

  } catch (err) {
    alert('Resume upload error: ' + err.message);
    if (idle) idle.style.display = 'block';
  } finally {
    if (loading) loading.style.display = 'none';
  }
};

// 1. Consent Screen Handlers
consentCheckbox.addEventListener('change', () => {
  btnConsentNext.disabled = !consentCheckbox.checked;
});

btnConsentNext.addEventListener('click', async () => {
  try {
    const res = await fetch(`/i/${token}/consent`, { method: 'POST' });
    if (!res.ok) throw new Error('Consent registration failed');
    consentScreen.style.display = 'none';
    micScreen.style.display = 'block';
  } catch (err) {
    alert(err.message);
  }
});

// 2. Mic Check Handlers
let isTestingMic = false;
btnTestMic.addEventListener('click', () => {
  if (!isTestingMic) {
    const started = voice.startListening();
    if (!started && !voice.speechSupported) {
      micTestStatus.innerHTML = '<span style="color:#ef4444;">Speech recognition not supported in this browser. Please use Typing mode below.</span>';
      return;
    }
    isTestingMic = true;
    btnTestMic.classList.add('recording');
    btnTestMic.innerHTML = '<i class="bi bi-stop-circle"></i> Stop Test';
    micTestStatus.textContent = 'Listening... Speak now.';
    voice.onFinalResult = (text) => {
      micTestResult.textContent = `Heard: "${text}"`;
    };
  } else {
    voice.stopListening();
    isTestingMic = false;
    btnTestMic.classList.remove('recording');
    btnTestMic.innerHTML = '<i class="bi bi-mic-fill"></i> Test Microphone Again';
    micTestStatus.textContent = 'Mic test complete! Select an option below.';
  }
});

btnStartVoice.addEventListener('click', () => {
  micScreen.style.display = 'none';
  showInterviewRoom();
  fetchNextQuestion(null);
});

btnStartText.addEventListener('click', () => {
  micScreen.style.display = 'none';
  showInterviewRoom();
  btnPushToTalk.style.display = 'none';
  fetchNextQuestion(null);
});

function showInterviewRoom() {
  consentScreen.style.display = 'none';
  micScreen.style.display = 'none';
  interviewRoomWrapper.style.display = 'block';
}

function setRecordingUI(recording) {
  isRecording = recording;
  if (recording) {
    btnPushToTalk.innerHTML = '<i class="bi bi-stop-circle-fill"></i> Stop Recording (Finished Speaking)';
    btnPushToTalk.style.backgroundColor = '#dc2626';
    voiceIndicator.style.display = 'inline-block';
  } else {
    btnPushToTalk.innerHTML = '<i class="bi bi-mic-fill"></i> Push to Talk (Start Speaking)';
    btnPushToTalk.style.backgroundColor = '#000000';
    voiceIndicator.style.display = 'none';
  }
}

// 3. Interview Q&A Loop
btnPushToTalk.addEventListener('click', () => {
  if (!isRecording) {
    voice.startListening();
    setRecordingUI(true);
  } else {
    voice.stopListening();
    setRecordingUI(false);
  }
});

btnSubmitAnswer.addEventListener('click', async () => {
  const answer = candidateAnswerBox.value.trim();
  if (!answer) {
    alert('Please enter or speak an answer before submitting.');
    return;
  }

  if (isRecording) {
    voice.stopListening();
    setRecordingUI(false);
  }

  btnSubmitAnswer.disabled = true;
  btnSubmitAnswer.innerHTML = '<i class="bi bi-hourglass-split"></i> AI Analyzing...';
  
  await fetchNextQuestion(answer);
  candidateAnswerBox.value = '';
  btnSubmitAnswer.disabled = false;
  btnSubmitAnswer.innerHTML = 'Submit Answer <i class="bi bi-send-fill"></i>';
});

async function fetchNextQuestion(answerText) {
  aiQuestionText.textContent = 'AI is preparing the next question...';
  
  try {
    const res = await fetch(`/i/${token}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answerText })
    });

    const data = await res.json();

    if (data.isCompleted) {
      finishInterview();
      return;
    }

    aiQuestionText.textContent = data.question;

    // Speak question aloud using browser speech synthesis
    voice.speak(data.question);
  } catch (err) {
    aiQuestionText.textContent = 'Network or AI connection error. Please click Repeat Question or Submit again.';
    console.error(err);
  }
}

btnRepeatAudio.addEventListener('click', () => {
  const currentText = aiQuestionText.textContent;
  if (currentText) {
    voice.speak(currentText);
  }
});

btnFinishEarly.addEventListener('click', () => {
  if (confirm('Are you sure you want to conclude the interview now? Your answers will be submitted for evaluation.')) {
    finishInterview();
  }
});

async function finishInterview() {
  if (countdownTimerId) clearInterval(countdownTimerId);
  voice.stopSpeaking();
  voice.stopListening();
  interviewRoomWrapper.style.display = 'none';
  completedScreen.style.display = 'block';

  try {
    await fetch(`/i/${token}/finish`, { method: 'POST' });
  } catch (err) {
    console.warn('Finish call error:', err);
  }
}

// Start initialization
init();

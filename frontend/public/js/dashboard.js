// Recruiter Dashboard & Multi-Step Customer Onboarding Logic

let authToken = localStorage.getItem('ai_interviewer_token') || null;
let currentUser = null;
let currentOrg = null;
let activeJobId = null;
let currentReportCandidateId = null;
let authMode = 'signup'; // 'signup' or 'login'

// DOM references
const jobsListEl = document.getElementById('jobs-list');
const inviteJobSelect = document.getElementById('invite-job-id');
const interviewsTableBody = document.getElementById('interviews-table-body');
const userDisplayEl = document.getElementById('user-display');
const authModal = document.getElementById('auth-modal');

async function apiRequest(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(endpoint, { ...options, headers });
  if (res.status === 401) {
    authToken = null;
    localStorage.removeItem('ai_interviewer_token');
    updateUserBadge();
    openAuthModal();
    throw new Error('Session expired. Please sign in.');
  }
  return res;
}

// User state check
async function checkAuthSession() {
  if (!authToken) {
    updateUserBadge();
    openAuthModal();
    return false;
  }

  try {
    const res = await fetch('/auth/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      currentOrg = data.org;

      // Check if user is verified
      if (!currentUser.is_verified) {
        openAuthModal();
        goToStep(2);
        document.getElementById('demo-verification-hint').textContent = `Demo Verification Code: ${currentUser.verification_code || '123456'}`;
        return false;
      }

      // Check if company information is set
      if (!currentOrg.website && !currentOrg.industry) {
        openAuthModal();
        goToStep(3);
        return false;
      }

      updateUserBadge();
      loadJobs();
      return true;
    } else {
      authToken = null;
      localStorage.removeItem('ai_interviewer_token');
      updateUserBadge();
      openAuthModal();
      return false;
    }
  } catch (e) {
    console.error('Session check error:', e);
    openAuthModal();
    return false;
  }
}

function updateUserBadge() {
  if (currentUser && currentOrg) {
    userDisplayEl.textContent = `${currentUser.full_name || currentUser.email} · ${currentOrg.name}`;
    document.getElementById('btn-auth-switch').innerHTML = `<i class="bi bi-box-arrow-right"></i> Sign Out`;
  } else {
    userDisplayEl.textContent = `Not Signed In`;
    document.getElementById('btn-auth-switch').innerHTML = `<i class="bi bi-box-arrow-in-right"></i> Sign In / Register`;
  }
}

// Modal open & close
window.openAuthModal = function() {
  authModal.style.display = 'flex';
  if (!authToken) {
    goToStep(1);
  }
};

window.closeAuthModal = function() {
  if (!authToken) {
    alert('Please sign in or create an account to access the hiring platform.');
    return;
  }
  authModal.style.display = 'none';
};

// Wizard Steps
function goToStep(stepNum) {
  document.getElementById('auth-step-1').style.display = stepNum === 1 ? 'block' : 'none';
  document.getElementById('auth-step-2').style.display = stepNum === 2 ? 'block' : 'none';
  document.getElementById('auth-step-3').style.display = stepNum === 3 ? 'block' : 'none';

  const t1 = document.getElementById('step-tab-1');
  const t2 = document.getElementById('step-tab-2');
  const t3 = document.getElementById('step-tab-3');

  t1.className = 'wizard-step-item' + (stepNum === 1 ? ' active' : (stepNum > 1 ? ' completed' : ''));
  t2.className = 'wizard-step-item' + (stepNum === 2 ? ' active' : (stepNum > 2 ? ' completed' : ''));
  t3.className = 'wizard-step-item' + (stepNum === 3 ? ' active' : '');
}

// Toggle sign up vs login
window.toggleAuthMode = function(mode) {
  authMode = mode;
  const suBtn = document.getElementById('btn-toggle-signup');
  const liBtn = document.getElementById('btn-toggle-login');
  const suForm = document.getElementById('form-signup');
  const liForm = document.getElementById('form-login');

  if (mode === 'signup') {
    suBtn.className = 'btn btn-sm';
    liBtn.className = 'btn btn-outline btn-sm';
    suForm.style.display = 'block';
    liForm.style.display = 'none';
    document.getElementById('auth-modal-title').textContent = 'Employer Registration';
    document.getElementById('wizard-steps-indicator').style.display = 'flex';
  } else {
    suBtn.className = 'btn btn-outline btn-sm';
    liBtn.className = 'btn btn-sm';
    suForm.style.display = 'none';
    liForm.style.display = 'block';
    document.getElementById('auth-modal-title').textContent = 'Employer Sign In';
    document.getElementById('wizard-steps-indicator').style.display = 'none';
  }
};

// Handle Sign In / Out button click in navbar
document.getElementById('btn-auth-switch').addEventListener('click', () => {
  if (authToken) {
    if (confirm('Do you want to sign out of your recruiter account?')) {
      authToken = null;
      currentUser = null;
      currentOrg = null;
      localStorage.removeItem('ai_interviewer_token');
      updateUserBadge();
      openAuthModal();
      goToStep(1);
      toggleAuthMode('login');
    }
  } else {
    openAuthModal();
  }
});

// Step 1: Form Sign Up
document.getElementById('form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fullName = document.getElementById('su-name').value.trim();
  const jobTitle = document.getElementById('su-title').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const phone = document.getElementById('su-phone').value.trim();
  const password = document.getElementById('su-password').value;

  try {
    const res = await fetch('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, jobTitle, email, phone, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to register account');

    authToken = data.token;
    localStorage.setItem('ai_interviewer_token', authToken);
    currentUser = data.user;
    currentOrg = data.org;

    document.getElementById('demo-verification-hint').textContent = `Demo Verification Code: ${data.verificationCode || '123456'}`;
    goToStep(2);
  } catch (err) {
    alert(err.message);
  }
});

// Step 1: Form Login
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invalid credentials');

    authToken = data.token;
    localStorage.setItem('ai_interviewer_token', authToken);
    currentUser = data.user;
    currentOrg = data.org;

    if (!currentUser.is_verified) {
      document.getElementById('wizard-steps-indicator').style.display = 'flex';
      goToStep(2);
      return;
    }

    authModal.style.display = 'none';
    updateUserBadge();
    loadJobs();
  } catch (err) {
    alert(err.message);
  }
});

// Step 2: Form Verify Code
document.getElementById('form-verify').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('verify-code').value.trim();

  try {
    const res = await apiRequest('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invalid code');

    currentUser.is_verified = 1;
    goToStep(3);
  } catch (err) {
    alert(err.message);
  }
});

window.resendVerificationCode = function() {
  alert('Verification code resent! (For instant demo testing, you can also use master code: 123456)');
};

// Step 3: Form Company Profile
document.getElementById('form-company').addEventListener('submit', async (e) => {
  e.preventDefault();
  const companyName = document.getElementById('co-name').value.trim();
  const website = document.getElementById('co-website').value.trim();
  const industry = document.getElementById('co-industry').value;
  const companySize = document.getElementById('co-size').value;
  const country = document.getElementById('co-country').value;

  try {
    const res = await apiRequest('/auth/company-profile', {
      method: 'POST',
      body: JSON.stringify({ companyName, website, industry, companySize, country })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save company profile');

    currentOrg = data.org;
    authModal.style.display = 'none';
    updateUserBadge();
    loadJobs();
    alert('Onboarding complete! You can now start posting roles and screening candidates based on required skills.');
  } catch (err) {
    alert(err.message);
  }
});

// --- Tab Switching ---
window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

  const tab = document.getElementById(`tab-${tabName}`);
  if (tab) tab.style.display = 'block';

  const buttons = document.querySelectorAll('.nav-btn');
  if (tabName === 'jobs') buttons[0]?.classList.add('active');
  if (tabName === 'candidates') buttons[1]?.classList.add('active');
  if (tabName === 'keys') buttons[2]?.classList.add('active');
  if (tabName === 'metrics') buttons[3]?.classList.add('active');
  if (tabName === 'leadmagnet') buttons[4]?.classList.add('active');

  if (tabName === 'jobs') loadJobs();
  if (tabName === 'candidates') { loadJobs(); loadInterviews(); }
  if (tabName === 'keys') loadKeyStatus();
  if (tabName === 'metrics') loadMetrics();
};

// --- LeetCode Problem Catalog ---
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

// --- Role Presets ---
const ROLE_PRESETS = {
  backend_python: {
    title: 'Junior Python / Backend Engineer',
    skills: 'Python, SQL, REST APIs, Git',
    jd: 'Looking for a backend engineer proficient in Python, SQL databases, API integration, and Git. Candidates will be assessed on foundational problem-solving, clean code execution, and database queries.'
  },
  frontend_react: {
    title: 'Frontend Developer (React / TypeScript)',
    skills: 'React, TypeScript, JavaScript, HTML/CSS, REST APIs, Git',
    jd: 'Seeking a frontend software engineer to build responsive user interfaces using React and TypeScript. Must understand component state management, asynchronous API data fetching, and web performance optimization.'
  },
  fullstack_node: {
    title: 'Full-Stack Developer (Node.js / React)',
    skills: 'JavaScript, Node.js, React, SQL, REST APIs, Git, Docker',
    jd: 'Looking for a full-stack engineer who can develop Node.js backend services and React frontend clients. Focus on end-to-end data flow, database schemas, authentication, and clean modular code.'
  },
  data_sql: {
    title: 'Data Engineer / SQL Developer',
    skills: 'SQL, Python, PostgreSQL, Data Structures, Git',
    jd: 'Seeking a developer focused on SQL databases, schema normalization, query optimization, indexing strategies, and automated data pipelines.'
  },
  devops: {
    title: 'DevOps & Cloud Engineer',
    skills: 'Docker, Kubernetes, AWS, Linux / Bash, Git, CI/CD',
    jd: 'Responsible for containerized application deployments, infrastructure automation, Docker builds, and cloud service integration.'
  },
  mobile: {
    title: 'Mobile App Developer (React Native / Flutter)',
    skills: 'Mobile Development, JavaScript, React Native, REST APIs, Git',
    jd: 'Looking for a mobile developer to build cross-platform applications. Knowledge of mobile UI patterns, asynchronous data syncing, and native device APIs.'
  }
};

// =====================================================================
// ROLE CATEGORIES — Full 11-category taxonomy
// =====================================================================
const ROLE_CATEGORIES = [
  {
    category: 'Software & Tech',
    roles: [
      'Frontend Developer (React / Angular / Vue)',
      'Backend Developer (Node.js / Java / Python / Go)',
      'Full Stack Developer',
      'Mobile App Developer (Android / iOS / Flutter / React Native)',
      'DevOps Engineer',
      'Cloud Engineer (AWS / Azure / GCP)',
      'Site Reliability Engineer (SRE)',
      'QA / Manual Testing',
      'Automation Testing (Selenium / Cypress)',
      'Embedded Systems Engineer',
      'Game Developer (Unity / Unreal)',
      'Blockchain / Web3 Developer',
      'Database Administrator (DBA)',
      'System Administrator',
      'Software Architect',
      'Engineering Manager / Tech Lead',
      'Competitive Programming / DSA Round',
      'System Design Round'
    ]
  },
  {
    category: 'Data, AI & Analytics',
    roles: [
      'Data Analyst',
      'Data Scientist',
      'Data Engineer',
      'Machine Learning Engineer',
      'AI / Prompt Engineer',
      'NLP Engineer',
      'Computer Vision Engineer',
      'Business Intelligence (Power BI / Tableau)',
      'MIS / Excel Analyst',
      'Research Scientist'
    ]
  },
  {
    category: 'Security & Networking',
    roles: [
      'Cybersecurity Analyst',
      'Ethical Hacker / Penetration Tester',
      'SOC Analyst',
      'Network Engineer',
      'IT Support / Helpdesk'
    ]
  },
  {
    category: 'Design & Creative',
    roles: [
      'UI/UX Designer',
      'Graphic Designer',
      'Motion Graphics / Animator',
      'Video Editor',
      '3D Artist / Modeler',
      'Game Designer',
      'Photographer / Videographer',
      'Product Designer',
      'Interior Designer',
      'Fashion Designer'
    ]
  },
  {
    category: 'Marketing & Content',
    roles: [
      'SEO Specialist',
      'Content Writer',
      'Copywriter',
      'Technical Writer',
      'Creative / Script Writer',
      'Social Media Manager',
      'Digital Marketing Executive',
      'Performance Marketing (Google Ads / Meta Ads)',
      'Email Marketing',
      'Influencer Marketing',
      'Brand Manager',
      'Public Relations (PR)',
      'Content Strategist',
      'Community Manager',
      'Affiliate Marketing'
    ]
  },
  {
    category: 'Sales & Business',
    roles: [
      'Sales Executive',
      'Business Development Executive (BDE)',
      'Inside Sales / Telecaller',
      'Account Manager',
      'Customer Success Manager',
      'Customer Support (Voice / Chat)',
      'Pre-Sales Consultant',
      'Retail / Store Manager',
      'Real Estate Agent',
      'Insurance Advisor'
    ]
  },
  {
    category: 'HR & Management',
    roles: [
      'HR Executive / Generalist',
      'Talent Acquisition / Recruiter',
      'HR Business Partner',
      'Payroll & Compensation',
      'Learning & Development (L&D)',
      'Project Manager',
      'Product Manager',
      'Program Manager',
      'Scrum Master / Agile Coach',
      'Business Analyst',
      'Operations Manager',
      'Management Trainee / MBA Fresher'
    ]
  },
  {
    category: 'Finance & Legal',
    roles: [
      'Accountant',
      'Chartered Accountant (CA) / Audit',
      'Financial Analyst',
      'Investment Banking',
      'Tax Consultant',
      'Banking (PO / Clerk)',
      'Legal Associate',
      'Compliance Officer',
      'Company Secretary'
    ]
  },
  {
    category: 'Operations & Core Engineering',
    roles: [
      'Supply Chain / Logistics',
      'Procurement / Purchase',
      'Mechanical Engineer',
      'Civil Engineer',
      'Electrical Engineer',
      'Electronics Engineer',
      'Chemical Engineer',
      'Manufacturing / Production',
      'Quality Control (QC)'
    ]
  },
  {
    category: 'Education, Healthcare & Others',
    roles: [
      'Teacher / Tutor (School Subjects)',
      'Ed-Tech Counselor',
      'Academic Counselor (Study Abroad / MBBS)',
      'Nurse / Healthcare Staff',
      'Pharmacist',
      'Medical Representative',
      'Hospital Administration',
      'Hospitality / Hotel Management',
      'Airline / Cabin Crew',
      'Government Exam Interviews (UPSC / SSC / State PSC)'
    ]
  },
  {
    category: 'Non-job Interviews',
    roles: [
      'College Admission Interview',
      'Study Abroad / Visa Interview',
      'MBA / Masters Interview',
      'Scholarship Interview',
      'Startup Founder / Investor Pitch Practice',
      'Freelancer Client Interview',
      'English Communication / HR Round Practice',
      'Internship Interview'
    ]
  }
];

// Render role category list based on filter
function filterRolesByCategory() {
  const categoryFilter = (document.getElementById('role-category-select')?.value || '').toLowerCase();
  const searchFilter = (document.getElementById('role-search-input')?.value || '').toLowerCase().trim();
  const container = document.getElementById('role-category-list');
  if (!container) return;

  let html = '';
  let totalMatches = 0;

  for (const group of ROLE_CATEGORIES) {
    if (categoryFilter && group.category.toLowerCase() !== categoryFilter) continue;
    const matchedRoles = group.roles.filter(r =>
      !searchFilter || r.toLowerCase().includes(searchFilter)
    );
    if (!matchedRoles.length) continue;
    totalMatches += matchedRoles.length;
    html += `<div class="role-category-group">`;
    html += `<div class="role-category-header">${group.category}</div>`;
    matchedRoles.forEach(role => {
      const currentTitle = document.getElementById('wiz-job-title')?.value || '';
      const isActive = currentTitle === role ? ' active' : '';
      html += `<span class="role-item${isActive}" onclick="selectRoleFromCategory('${role.replace(/'/g, "\\'")}')">${role}</span>`;
    });
    html += `</div>`;
  }

  if (!totalMatches) {
    html = `<div style="font-size:0.78rem; color:var(--text-muted); padding:0.5rem;">No matching roles found. Type the role title manually below.</div>`;
  }

  container.innerHTML = html;
}

window.filterRolesByCategory = filterRolesByCategory;

// Intelligent defaults for roles across all 11 categories
const CATEGORY_ROLE_DEFAULTS = {
  // Software & Tech
  'Frontend Developer (React / Angular / Vue)': {
    skills: 'React, TypeScript, JavaScript, CSS3, HTML5, REST APIs, Git',
    jd: 'Seeking a frontend developer proficient in modern JavaScript/TypeScript and frameworks (React, Angular, or Vue). Focus on responsive UI design, component state management, web performance, and API integration.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'javascript'
  },
  'Backend Developer (Node.js / Java / Python / Go)': {
    skills: 'Node.js, Python, Java, SQL, REST APIs, Docker, Git',
    jd: 'Looking for a backend software engineer to design and maintain scalable server-side APIs, database schemas, authentication systems, and microservices.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'javascript,python,sql'
  },
  'Full Stack Developer': {
    skills: 'JavaScript, TypeScript, React, Node.js, SQL, REST APIs, Git, Docker',
    jd: 'Looking for a full-stack engineer who can develop backend services and modern frontend applications. Focus on end-to-end data flow, database schemas, and clean modular code.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'javascript,python,sql'
  },
  'Mobile App Developer (Android / iOS / Flutter / React Native)': {
    skills: 'Flutter, React Native, Kotlin, Swift, REST APIs, Mobile UI, Git',
    jd: 'Seeking a mobile app developer to build high-performance mobile applications across Android and iOS. Focus on responsive UX, state management, offline sync, and native device integrations.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'javascript'
  },
  'DevOps Engineer': {
    skills: 'Docker, Kubernetes, AWS, CI/CD, Terraform, Linux, Git, Bash',
    jd: 'Responsible for infrastructure automation, CI/CD pipelines, container orchestration, monitoring, and cloud resource management.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'python'
  },
  'Cloud Engineer (AWS / Azure / GCP)': {
    skills: 'AWS, Azure, Cloud Architecture, Terraform, Docker, Networking, Security',
    jd: 'Design and deploy scalable, fault-tolerant cloud solutions. Manage identity access, networking VPCs, cost optimization, and automated cloud infrastructure.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'python,sql'
  },
  'Site Reliability Engineer (SRE)': {
    skills: 'Linux, Distributed Systems, Prometheus, Kubernetes, Python, Incident Management',
    jd: 'Maintain uptime, reliability, and observability of production services. Focus on SLIs/SLOs, latency optimization, and automated incident recovery.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'python'
  },
  'QA / Manual Testing': {
    skills: 'Manual Testing, Test Scenarios, Bug Lifecycle, JIRA, Regression Testing, API Testing',
    jd: 'Perform comprehensive manual testing, exploratory testing, boundary value analysis, and detailed test case documentation across web and mobile platforms.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Automation Testing (Selenium / Cypress)': {
    skills: 'Selenium, Cypress, JavaScript, Python, Test Automation, CI/CD, Postman',
    jd: 'Develop automated test suites, end-to-end testing scripts, API test automation, and integrate test suites into continuous integration pipelines.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'javascript,python'
  },
  'Competitive Programming / DSA Round': {
    skills: 'Data Structures, Algorithms, Dynamic Programming, Graphs, Trees, Big-O Complexity',
    jd: 'Rigorous algorithmic evaluation focusing on data structures, time and space complexity analysis, edge case handling, and optimal code execution.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'javascript,python,cpp,java',
    dsa: true
  },
  'System Design Round': {
    skills: 'High-Level Design, Distributed Systems, Microservices, Caching, Load Balancing, SQL/NoSQL',
    jd: 'Technical architecture round evaluating scalability, data partitioning, trade-offs between consistency and availability (CAP theorem), and API specifications.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },

  // Data, AI & Analytics
  'Data Analyst': {
    skills: 'SQL, Excel, Power BI, Tableau, Python, Data Cleaning, Metrics & KPIs',
    jd: 'Analyze business datasets to identify trends, create actionable executive dashboards, optimize reporting pipelines, and communicate data-driven insights.',
    tools: { terminal: 1, word: 1, resume: 1 },
    langs: 'sql,python'
  },
  'Data Scientist': {
    skills: 'Python, Machine Learning, Statistics, Pandas, Scikit-Learn, SQL, Data Modeling',
    jd: 'Develop predictive models, conduct statistical hypothesis testing, extract insights from structured and unstructured data, and deploy ML models into production.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'python,sql'
  },
  'Data Engineer': {
    skills: 'SQL, Python, Spark, ETL Pipelines, PostgreSQL, Data Warehousing, Airflow',
    jd: 'Design and build resilient data pipelines, manage data lakes and warehouses, optimize complex SQL queries, and ensure data governance and hygiene.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'sql,python'
  },
  'Machine Learning Engineer': {
    skills: 'Python, PyTorch, TensorFlow, MLOps, Docker, Algorithms, Model Deployment',
    jd: 'Train, evaluate, and deploy production-grade machine learning models. Optimize inference latency, monitor model drift, and scale pipeline pipelines.',
    tools: { terminal: 1, word: 0, resume: 1 },
    langs: 'python'
  },
  'AI / Prompt Engineer': {
    skills: 'LLMs, Prompt Engineering, LangChain, Python, RAG Architectures, OpenAI / Claude APIs',
    jd: 'Design and optimize prompts, evaluate LLM outputs, implement retrieval-augmented generation (RAG) pipelines, and integrate generative AI agents into business workflows.',
    tools: { terminal: 1, word: 1, resume: 1 },
    langs: 'python,javascript'
  },

  // Security & Networking
  'Cybersecurity Analyst': {
    skills: 'Network Security, Threat Intelligence, SIEM, Incident Response, Firewall, Vulnerability Assessment',
    jd: 'Monitor security operations, investigate incidents, analyze vulnerability logs, and ensure adherence to cybersecurity frameworks and organizational compliance.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Ethical Hacker / Penetration Tester': {
    skills: 'Penetration Testing, Kali Linux, OWASP Top 10, Burp Suite, Network Vulnerability, Exploit Analysis',
    jd: 'Perform authorized penetration testing against web applications, network infrastructure, and APIs. Identify vulnerabilities and provide remediation strategies.',
    tools: { terminal: 1, word: 1, resume: 1 },
    langs: 'python'
  },

  // Design & Creative
  'UI/UX Designer': {
    skills: 'Figma, User Research, Wireframing, Prototyping, Design Systems, Usability Testing',
    jd: 'Create intuitive, user-centered digital experiences. Conduct user interviews, build wireframes and interactive prototypes, and collaborate closely with developers.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Graphic Designer': {
    skills: 'Adobe Photoshop, Illustrator, Visual Identity, Typography, Branding, Layout Design',
    jd: 'Produce creative visual assets for digital marketing, social media, branding collateral, and corporate presentations.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },

  // Marketing & Content
  'SEO Specialist': {
    skills: 'Technical SEO, Keyword Research, Google Search Console, Google Analytics, Link Building',
    jd: 'Drive organic search traffic through technical site audits, keyword optimization, content gap analysis, and search engine ranking strategies.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Content Writer': {
    skills: 'Copywriting, SEO Writing, Editorial Strategy, Storytelling, Proofreading, Brand Voice',
    jd: 'Write engaging, high-conversion articles, case studies, blog posts, and website copy that aligns with brand narrative and audience intent.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Performance Marketing (Google Ads / Meta Ads)': {
    skills: 'Google Ads, Meta Ads, ROAS Optimization, Conversion Tracking, A/B Testing, Campaign Budgeting',
    jd: 'Plan, execute, and optimize paid acquisition campaigns across search and social channels. Maximize ROAS and improve cost-per-acquisition metrics.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },

  // Sales & Business
  'Business Development Executive (BDE)': {
    skills: 'B2B Sales, Lead Prospecting, Cold Outreach, Product Pitching, Negotiation, CRM Management',
    jd: 'Identify target accounts, initiate outreach to key decision-makers, deliver compelling sales demonstrations, and close commercial partnerships.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Customer Success Manager': {
    skills: 'Client Retention, Customer Onboarding, Product Adoption, Health Scoring, Upselling',
    jd: 'Ensure customer satisfaction, facilitate smooth product onboarding, drive platform adoption, and reduce churn through proactive relationship management.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },

  // HR & Management
  'HR Executive / Generalist': {
    skills: 'Employee Relations, HR Operations, Onboarding, Labor Compliance, Performance Management',
    jd: 'Manage core human resource activities including onboarding, employee engagement, HR compliance policies, grievance resolution, and performance tracking.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Talent Acquisition / Recruiter': {
    skills: 'Technical Sourcing, Candidate Screening, Boolean Search, ATS Systems, Interview Coordination',
    jd: 'Source, screen, and interview candidates for specialized positions. Build talent pipelines and manage end-to-end recruitment lifecycle.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Product Manager': {
    skills: 'Product Roadmapping, User Stories, PRD Documentation, Feature Prioritization, Agile Methodologies',
    jd: 'Define product vision and roadmap, write comprehensive PRDs, prioritize feature backlogs, and collaborate with engineering and design to deliver high-impact products.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Project Manager': {
    skills: 'Agile/Scrum, JIRA, Sprint Planning, Scope Management, Risk Mitigation, Stakeholder Communication',
    jd: 'Lead project execution, track milestones and budgets, coordinate cross-functional teams, and ensure on-time, high-quality deliverables.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },

  // Finance & Legal
  'Financial Analyst': {
    skills: 'Financial Modeling, DCF Valuation, Excel, Financial Statements, Forecasting, Variance Analysis',
    jd: 'Perform detailed financial analysis, construct forecasting models, analyze historical data, and prepare investment memoranda for executive leadership.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Accountant': {
    skills: 'General Ledger, Financial Accounting, Balance Sheet, Tax Filing, Bank Reconciliation, Auditing',
    jd: 'Maintain financial records, prepare monthly reconciliations, manage accounts payable/receivable, and ensure compliance with accounting standards.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },

  // Operations & Core Engineering
  'Mechanical Engineer': {
    skills: 'AutoCAD, SolidWorks, Thermodynamics, Manufacturing Processes, GD&T, Finite Element Analysis',
    jd: 'Design and analyze mechanical systems, generate production drawings, conduct stress analysis, and coordinate with fabrication and manufacturing teams.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Electrical Engineer': {
    skills: 'Circuit Design, PCB Layout, Power Systems, MATLAB, Microcontrollers, Electrical Safety',
    jd: 'Develop electrical circuits, design PCBs, verify schematics, and ensure product compliance with international electrical safety standards.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },

  // Education, Healthcare & Others
  'Teacher / Tutor (School Subjects)': {
    skills: 'Subject Matter Expertise, Pedagogy, Lesson Planning, Student Engagement, Assessment Design',
    jd: 'Deliver curriculum instruction, design engaging lesson plans, evaluate student comprehension, and provide constructive academic feedback.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },

  // Non-job Interviews
  'College Admission Interview': {
    skills: 'Academic Background, Problem-Solving, Extracurricular Leadership, Personal Values, Career Aspirations',
    jd: 'Screen prospective candidates for academic passion, resilience, leadership potential, and cultural fit within the institution.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'Startup Founder / Investor Pitch Practice': {
    skills: 'Pitch Presentation, Market Sizing (TAM/SAM), Unit Economics, Go-to-Market Strategy, Founder Conviction',
    jd: 'Rigorous pitch simulation testing business model viability, competitive moat, financial projections, and founder vision under investor questioning.',
    tools: { terminal: 0, word: 1, resume: 1 }
  },
  'English Communication / HR Round Practice': {
    skills: 'Professional Articulation, Behavioral STAR Method, Spoken English Fluency, Confidence, Active Listening',
    jd: 'Behavioral and conversational round evaluating communication clarity, professional demeanor, and structured responses to situational HR scenarios.',
    tools: { terminal: 0, word: 1, resume: 1 }
  }
};

// Called when a role pill is clicked in the browser
window.selectRoleFromCategory = function(roleTitle) {
  const titleInput = document.getElementById('wiz-job-title');
  if (titleInput) {
    titleInput.value = roleTitle;
    titleInput.focus();
  }

  // Find category for this role
  let foundCategory = null;
  for (const group of ROLE_CATEGORIES) {
    if (group.roles.includes(roleTitle)) {
      foundCategory = group.category;
      break;
    }
  }

  const catSelect = document.getElementById('role-category-select');
  if (catSelect && foundCategory) {
    catSelect.value = foundCategory;
  }

  filterRolesByCategory();

  // Apply intelligent role defaults if present
  const conf = CATEGORY_ROLE_DEFAULTS[roleTitle];
  if (conf) {
    if (conf.skills) {
      document.getElementById('wiz-job-skills').value = conf.skills;
      const lowerSkills = conf.skills.toLowerCase();
      document.querySelectorAll('#skills-chip-cloud .chip-tag').forEach(tag => {
        tag.classList.toggle('selected', lowerSkills.includes(tag.textContent.trim().toLowerCase()));
      });
    }
    if (conf.jd) {
      document.getElementById('wiz-job-jd').value = conf.jd;
    }
    if (conf.tools) {
      document.getElementById('wiz-tool-terminal').checked = Boolean(conf.tools.terminal);
      document.getElementById('wiz-tool-word').checked = Boolean(conf.tools.word);
      document.getElementById('wiz-tool-resume').checked = Boolean(conf.tools.resume);
      toggleCompilerOptions();
    }
    if (conf.langs) {
      const allowed = conf.langs.split(',').map(s => s.trim().toLowerCase());
      document.querySelectorAll('.compiler-lang-check').forEach(cb => {
        cb.checked = allowed.includes(cb.value.toLowerCase());
      });
    }
    if (conf.dsa) {
      document.getElementById('wiz-dsa-toggle').checked = true;
      toggleDsaSection();
      updateLeetCodePreview();
    }
  } else {
    const isTech = foundCategory === 'Software & Tech' || foundCategory === 'Data, AI & Analytics';
    document.getElementById('wiz-tool-terminal').checked = isTech;
    document.getElementById('wiz-tool-word').checked = !isTech;
    toggleCompilerOptions();
  }
};

// --- Multi-Step Interview Wizard Controller ---
let wizardCurrentStep = 1;
let editingJobId = null;

window.startInterviewCreationWizard = function() {
  editingJobId = null;
  document.getElementById('form-job-wizard')?.reset();

  const modeBadge = document.getElementById('wizard-mode-badge');
  if (modeBadge) modeBadge.style.display = 'none';
  const submitText = document.getElementById('btn-wizard-submit-text');
  if (submitText) submitText.textContent = 'Create Interview & Publish Round';

  selectPurpose('job');
  selectExperience('0-1 Yrs');
  selectQuestionMode('ai_adaptive');
  document.querySelectorAll('#qualifications-chip-cloud .chip-tag').forEach(t => t.classList.remove('selected'));
  document.querySelectorAll('#skills-chip-cloud .chip-tag').forEach(t => t.classList.remove('selected'));

  const catSelect = document.getElementById('role-category-select');
  if (catSelect) catSelect.value = '';
  const searchInput = document.getElementById('role-search-input');
  if (searchInput) searchInput.value = '';
  filterRolesByCategory();

  document.getElementById('view-interview-dashboard').style.display = 'none';
  document.getElementById('view-interview-wizard').style.display = 'block';
  const maxQEl = document.getElementById('wiz-max-questions'); if (maxQEl) maxQEl.value = '6';
  goToWizardStep(1);
  updateLeetCodePreview();
};

window.cancelInterviewCreationWizard = function() {
  editingJobId = null;
  document.getElementById('view-interview-wizard').style.display = 'none';
  document.getElementById('view-interview-dashboard').style.display = 'block';
};

window.editInterview = async function(jobId) {
  try {
    const res = await apiRequest(`/jobs/${jobId}`);
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to load interview details');
      return;
    }
    const job = await res.json();
    editingJobId = jobId;

    // 1. Purpose
    selectPurpose(job.purpose || 'job');

    // 2. Qualifications & Experience
    const customQual = document.getElementById('wiz-qualifications-custom');
    if (customQual) customQual.value = job.qualifications || '';
    const quals = (job.qualifications || '').toLowerCase();
    document.querySelectorAll('#qualifications-chip-cloud .chip-tag').forEach(tag => {
      const txt = tag.textContent.trim().toLowerCase();
      tag.classList.toggle('selected', quals.includes(txt));
    });
    selectExperience(job.experience_required || '0-1 Yrs');

    // 3. Title, Skills & JD
    document.getElementById('wiz-job-title').value = job.title || '';
    document.getElementById('wiz-job-skills').value = job.skills || '';
    document.getElementById('wiz-job-jd').value = job.jd_text || '';
    const catSelect = document.getElementById('role-category-select');
    if (catSelect) catSelect.value = job.category || '';
    filterRolesByCategory();

    const skillsList = (job.skills || '').toLowerCase();
    document.querySelectorAll('#skills-chip-cloud .chip-tag').forEach(tag => {
      const txt = tag.textContent.trim().toLowerCase();
      tag.classList.toggle('selected', skillsList.includes(txt));
    });

    // 4. Assessment Rules
    const rulesStr = job.assessment_rules || '';
    document.getElementById('rule-camera').checked = rulesStr.includes('Camera');
    document.getElementById('rule-focus').checked = rulesStr.includes('Focus');
    document.getElementById('rule-objective').checked = rulesStr.includes('Objective');
    document.getElementById('rule-privacy').checked = rulesStr.includes('DPDP');
    document.getElementById('rule-code-exec').checked = rulesStr.includes('Code');

    const standardKeys = ['Camera', 'Focus', 'Objective', 'DPDP', 'Code'];
    const customLines = rulesStr.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed && !standardKeys.some(k => trimmed.includes(k));
    });
    document.getElementById('wiz-custom-rules').value = customLines.join('\n');

    // 5. Tools & Compilers
    document.getElementById('wiz-tool-terminal').checked = Boolean(job.terminal_required);
    document.getElementById('wiz-tool-word').checked = Boolean(job.word_editor_required);
    document.getElementById('wiz-tool-resume').checked = Boolean(job.resume_required);
    toggleCompilerOptions();

    if (job.compiler_languages) {
      const allowed = job.compiler_languages.split(',').map(s => s.trim().toLowerCase());
      document.querySelectorAll('.compiler-lang-check').forEach(cb => {
        cb.checked = allowed.includes(cb.value.toLowerCase());
      });
    }

    // 6. Questions & DSA
    selectQuestionMode(job.question_mode || 'ai_adaptive');
    document.getElementById('wiz-custom-questions-text').value = job.custom_questions || '';

    if (job.leetcode_problem) {
      document.getElementById('wiz-dsa-toggle').checked = true;
      let matchedKey = null;
      for (const [key, prob] of Object.entries(LEETCODE_CATALOG)) {
        if (job.leetcode_problem.includes(prob.title) || job.leetcode_problem.includes(`#${key}:`) || job.leetcode_problem.includes(`#${key} `)) {
          matchedKey = key;
          break;
        }
      }
      const lcSelect = document.getElementById('wiz-leetcode-select');
      if (matchedKey && lcSelect) {
        lcSelect.value = matchedKey;
      } else if (lcSelect) {
        lcSelect.value = 'custom';
        const customInput = document.getElementById('wiz-custom-leetcode-input');
        if (customInput) customInput.value = job.leetcode_problem;
      }
    } else {
      document.getElementById('wiz-dsa-toggle').checked = false;
    }
    toggleDsaSection();
    updateLeetCodePreview();

    // 7. Target Duration
    document.getElementById('wiz-target-duration').value = String(job.max_minutes || 15);
    const maxQEl = document.getElementById('wiz-max-questions');
    if (maxQEl) maxQEl.value = String(job.max_questions || 6);

    // Update UI for Edit Mode
    const modeBadge = document.getElementById('wizard-mode-badge');
    if (modeBadge) {
      modeBadge.style.display = 'inline-flex';
      modeBadge.innerHTML = `<i class="bi bi-pencil-square"></i> Editing: ${job.title}`;
    }
    const submitText = document.getElementById('btn-wizard-submit-text');
    if (submitText) submitText.textContent = 'Save Changes & Update Interview';

    document.getElementById('view-interview-dashboard').style.display = 'none';
    document.getElementById('view-interview-wizard').style.display = 'block';
    goToWizardStep(1);
  } catch (err) {
    alert('Error loading interview for editing: ' + err.message);
  }
};

window.deleteInterview = async function(jobId, encodedTitle) {
  const title = decodeURIComponent(encodedTitle || 'this interview');
  if (!confirm(`Are you sure you want to delete interview "${title}"?\n\nThis will remove the interview configuration along with all candidate sessions, transcripts, and reports.`)) {
    return;
  }

  try {
    const res = await apiRequest(`/jobs/${jobId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete interview');

    alert(data.message || `Interview "${title}" deleted.`);
    if (activeJobId === jobId) activeJobId = null;
    loadJobs();
    loadInterviews();
  } catch (err) {
    alert(err.message);
  }
};

window.goToWizardStep = function(stepNum) {
  wizardCurrentStep = stepNum;

  // Hide all step panels
  for (let i = 1; i <= 7; i++) {
    const el = document.getElementById(`wiz-step-${i}`);
    if (el) el.style.display = (i === stepNum) ? 'block' : 'none';
    const tabEl = document.getElementById(`wiz-tab-${i}`);
    if (tabEl) {
      tabEl.className = 'wizard-nav-step' + (i === stepNum ? ' active' : (i < stepNum ? ' done' : ''));
    }
  }

  const badgeEl = document.getElementById('wizard-step-title-badge');
  const stepTitles = [
    'Purpose', 'Qualifications & Experience', 'Job & Skills',
    'Assessment Rules', 'Tools & Compiler', 'Questions & DSA', 'Review & Launch'
  ];
  if (badgeEl) badgeEl.textContent = `Step ${stepNum} of 7: ${stepTitles[stepNum - 1]}`;

  if (stepNum === 3) {
    filterRolesByCategory();
  }
  if (stepNum === 7) {
    updateWizardSummaryReview();
    refreshQuestionsPreview();
  }

  window.scrollTo({ top: 120, behavior: 'smooth' });
};

// Step 1: Purpose Selection
window.selectPurpose = function(purposeKey) {
  document.getElementById('wiz-purpose-input').value = purposeKey;
  document.querySelectorAll('#wiz-step-1 .selection-card').forEach(c => c.classList.remove('selected'));
  const target = document.getElementById(`purpose-card-${purposeKey}`);
  if (target) target.classList.add('selected');
};

// Step 2: Qualifications & Experience
window.toggleQualTag = function(el) {
  el.classList.toggle('selected');
  const selectedTags = Array.from(document.querySelectorAll('#qualifications-chip-cloud .chip-tag.selected'))
    .map(t => t.textContent.trim());
  
  const customEl = document.getElementById('wiz-qualifications-custom');
  if (selectedTags.length > 0) {
    customEl.value = selectedTags.join(', ');
  }
};

window.selectExperience = function(expVal) {
  document.getElementById('wiz-experience-input').value = expVal;
  document.querySelectorAll('#wiz-step-2 .selection-card').forEach(c => c.classList.remove('selected'));
  const idMap = { '0-1 Yrs': 'exp-card-0-1', '1-3 Yrs': 'exp-card-1-3', '3-5 Yrs': 'exp-card-3-5', '5+ Yrs': 'exp-card-5-plus' };
  const target = document.getElementById(idMap[expVal]);
  if (target) target.classList.add('selected');
};

// Step 3: Presets & Skills Selection
window.applyRolePreset = function(presetKey) {
  const preset = ROLE_PRESETS[presetKey];
  if (!preset) return;

  document.getElementById('wiz-job-title').value = preset.title;
  document.getElementById('wiz-job-skills').value = preset.skills;
  document.getElementById('wiz-job-jd').value = preset.jd;

  // Highlight corresponding skill tags
  const skillArray = preset.skills.toLowerCase().split(',').map(s => s.trim());
  document.querySelectorAll('#skills-chip-cloud .chip-tag').forEach(tag => {
    const txt = tag.textContent.trim().toLowerCase();
    if (skillArray.includes(txt)) {
      tag.classList.add('selected');
    } else {
      tag.classList.remove('selected');
    }
  });
};

window.toggleSkillTag = function(el) {
  el.classList.toggle('selected');
  const selectedSkills = Array.from(document.querySelectorAll('#skills-chip-cloud .chip-tag.selected'))
    .map(t => t.textContent.trim());
  document.getElementById('wiz-job-skills').value = selectedSkills.join(', ');
};

window.filterSkillsCloud = function() {
  const query = (document.getElementById('skill-search-input')?.value || '').toLowerCase().trim();
  document.querySelectorAll('#skills-chip-cloud .chip-tag').forEach(tag => {
    const text = tag.textContent.toLowerCase();
    tag.style.display = (!query || text.includes(query)) ? 'inline-flex' : 'none';
  });
};

// Step 5: Compiler options toggle
window.toggleCompilerOptions = function() {
  const checked = document.getElementById('wiz-tool-terminal')?.checked;
  const box = document.getElementById('compiler-langs-box');
  if (box) box.style.display = checked ? 'block' : 'none';
};

// Step 6: Questions & DSA / LeetCode
window.selectQuestionMode = function(mode) {
  document.getElementById('wiz-question-mode-input').value = mode;
  document.getElementById('qmode-card-adaptive').classList.toggle('selected', mode === 'ai_adaptive');
  document.getElementById('qmode-card-custom').classList.toggle('selected', mode === 'custom_questions');
  document.getElementById('wiz-custom-q-box').style.display = (mode === 'custom_questions') ? 'block' : 'none';
};

window.toggleDsaSection = function() {
  const checked = document.getElementById('wiz-dsa-toggle')?.checked;
  const box = document.getElementById('wiz-dsa-picker-box');
  if (box) box.style.display = checked ? 'block' : 'none';
};

window.updateLeetCodePreview = function() {
  const select = document.getElementById('wiz-leetcode-select');
  const customBox = document.getElementById('wiz-custom-leetcode-input-box');
  if (!select) return;

  const val = select.value;
  if (val === 'custom') {
    if (customBox) customBox.style.display = 'block';
    const customVal = document.getElementById('wiz-custom-leetcode-input')?.value || 'Custom DSA Challenge';
    document.getElementById('lc-preview-title').textContent = customVal;
    document.getElementById('lc-preview-diff').textContent = 'Custom';
    document.getElementById('lc-preview-desc').textContent = 'Interviewer configured custom algorithmic challenge.';
    document.getElementById('lc-preview-testcases').textContent = 'Candidate will run custom test cases in compiler sandbox.';
    return;
  }

  if (customBox) customBox.style.display = 'none';
  const problem = LEETCODE_CATALOG[val] || LEETCODE_CATALOG['1'];
  document.getElementById('lc-preview-title').textContent = problem.title;
  document.getElementById('lc-preview-diff').textContent = problem.difficulty;
  document.getElementById('lc-preview-desc').innerHTML = problem.description;
  document.getElementById('lc-preview-testcases').textContent = problem.testcases;
};

window.updateCustomLeetCodeText = function() {
  const customVal = document.getElementById('wiz-custom-leetcode-input')?.value || 'Custom Challenge';
  document.getElementById('lc-preview-title').textContent = customVal;
};

// Step 7: Summary Review Update
function updateWizardSummaryReview() {
  const purposeMap = {
    job: 'Full-Time Job Hiring',
    internship: 'Internship Assessment',
    campus: 'Campus Placement Drive',
    freelance: 'Freelance / Contractor',
    trainee: 'Apprenticeship / Trainee',
    promotion: 'Internal Promotion'
  };

  const purpose = document.getElementById('wiz-purpose-input')?.value || 'job';
  const title = document.getElementById('wiz-job-title')?.value || 'Technical Role';
  const exp = document.getElementById('wiz-experience-input')?.value || '0-1 Yrs';
  const skills = document.getElementById('wiz-job-skills')?.value || 'Core Skills';

  const dsaActive = document.getElementById('wiz-dsa-toggle')?.checked;
  let dsaText = 'None attached';
  if (dsaActive) {
    const lcSelect = document.getElementById('wiz-leetcode-select')?.value;
    if (lcSelect === 'custom') {
      dsaText = document.getElementById('wiz-custom-leetcode-input')?.value || 'Custom Problem';
    } else {
      dsaText = LEETCODE_CATALOG[lcSelect]?.title || 'LeetCode Problem';
    }
  }

  const tools = [];
  if (document.getElementById('wiz-tool-terminal')?.checked) tools.push('Online Compiler & Sandbox');
  if (document.getElementById('wiz-tool-word')?.checked) tools.push('Word Pad Scratchpad');
  if (document.getElementById('wiz-tool-resume')?.checked) tools.push('Resume Fact-Checking');

  const category = document.getElementById('role-category-select')?.value || 'Software & Tech';
  const sumCat = document.getElementById('sum-category');
  if (sumCat) sumCat.textContent = category;

  document.getElementById('sum-purpose').textContent = purposeMap[purpose] || purpose;
  document.getElementById('sum-title').textContent = title;
  document.getElementById('sum-experience').textContent = exp;
  document.getElementById('sum-dsa').textContent = dsaText;
  document.getElementById('sum-skills').textContent = skills;
  document.getElementById('sum-tools').textContent = tools.join(' · ') || 'Standard Voice & Audio Screening';
}

// Wizard Final Form Submission
window.handleWizardFinalSubmit = async function(e) {
  e.preventDefault();

  const purpose = document.getElementById('wiz-purpose-input').value;
  const qualifications = document.getElementById('wiz-qualifications-custom').value.trim();
  const experience_required = document.getElementById('wiz-experience-input').value;
  const title = document.getElementById('wiz-job-title').value.trim();
  const skills = document.getElementById('wiz-job-skills').value.trim();
  const jd_text = document.getElementById('wiz-job-jd').value.trim();

  // Rules
  const rules = [];
  if (document.getElementById('rule-camera').checked) rules.push('Camera & Microphone Active');
  if (document.getElementById('rule-focus').checked) rules.push('Browser Focus & Anti-Tab Switch');
  if (document.getElementById('rule-objective').checked) rules.push('Objective Technical Scoring');
  if (document.getElementById('rule-privacy').checked) rules.push('DPDP Act 2023 Compliant Privacy');
  if (document.getElementById('rule-code-exec').checked) rules.push('Verified Code Execution');
  const customRules = document.getElementById('wiz-custom-rules').value.trim();
  if (customRules) rules.push(customRules);
  const assessment_rules = rules.join('\n');

  // Tools & Compiler
  const terminal_required = document.getElementById('wiz-tool-terminal').checked ? 1 : 0;
  const word_editor_required = document.getElementById('wiz-tool-word').checked ? 1 : 0;
  const resume_required = document.getElementById('wiz-tool-resume').checked ? 1 : 0;

  const compiler_langs = Array.from(document.querySelectorAll('.compiler-lang-check:checked'))
    .map(c => c.value).join(',');

  // Questions & DSA
  const question_mode = document.getElementById('wiz-question-mode-input').value;
  const custom_questions = document.getElementById('wiz-custom-questions-text')?.value.trim() || '';

  let leetcode_problem = '';
  if (document.getElementById('wiz-dsa-toggle').checked) {
    const lcVal = document.getElementById('wiz-leetcode-select').value;
    if (lcVal === 'custom') {
      leetcode_problem = document.getElementById('wiz-custom-leetcode-input')?.value.trim() || 'Custom LeetCode Challenge';
    } else {
      leetcode_problem = LEETCODE_CATALOG[lcVal]?.title || 'LeetCode #1: Two Sum';
    }
  }

  const max_minutes = parseInt(document.getElementById('wiz-target-duration').value, 10) || 15;
  const interview_type = terminal_required ? 'coding' : (word_editor_required ? 'written' : 'technical');
  const category = document.getElementById('role-category-select')?.value || 'Software & Tech';

  const endpoint = editingJobId ? `/jobs/${editingJobId}` : '/jobs';
  const method = editingJobId ? 'PUT' : 'POST';

  try {
    const max_questions = parseInt(document.getElementById('wiz-max-questions')?.value || '6', 10);
    const res = await apiRequest(endpoint, {
      method,
      body: JSON.stringify({
        title,
        jd_text,
        skills,
        qualifications,
        purpose,
        experience_required,
        assessment_rules,
        interview_type,
        question_mode,
        custom_questions,
        terminal_required,
        word_editor_required,
        resume_required,
        leetcode_problem,
        compiler_languages: compiler_langs || 'javascript,python,sql',
        level: 'junior',
        max_minutes,
        max_questions,
        category
      })
    });

    if (res.ok) {
      const respData = await res.json();
      const targetJobId = editingJobId || respData.id || (respData.job ? respData.job.id : null);
      cancelInterviewCreationWizard();
      await loadJobs();
      if (targetJobId) {
        openShareModalForJob(targetJobId, encodeURIComponent(title));
      } else {
        alert(editingJobId ? `Interview "${title}" updated successfully!` : `Interview "${title}" created successfully!`);
      }
    } else {
      const err = await res.json();
      alert(err.error || (editingJobId ? 'Failed to update interview' : 'Failed to create interview'));
    }
  } catch (err) {
    alert(err.message);
  }
};

// --- Jobs Management, Category Filtering & Active Dashboard List ---
let allLoadedJobs = [];

async function loadJobs() {
  if (!authToken) return;
  try {
    const res = await apiRequest('/jobs');
    const jobs = await res.json();
    allLoadedJobs = jobs || [];

    updateResponsesBadgeCount();
    filterDashboardJobs();

    if (inviteJobSelect) {
      inviteJobSelect.innerHTML = allLoadedJobs.map(j => `<option value="${j.id}" ${j.id === activeJobId ? 'selected' : ''}>${j.title}</option>`).join('');
      if (!activeJobId && allLoadedJobs.length > 0) {
        activeJobId = allLoadedJobs[0].id;
      }
    }
  } catch (err) {
    console.error('Load jobs error:', err);
  }
}

window.setCategoryFilter = function(cat) {
  const catFilter = document.getElementById('dashboard-category-filter');
  if (catFilter) catFilter.value = cat;
  filterDashboardJobs();
};

window.filterDashboardJobs = function() {
  const searchQ = (document.getElementById('dashboard-job-search')?.value || '').toLowerCase().trim();
  const categoryQ = document.getElementById('dashboard-category-filter')?.value || '';
  const sortQ = document.getElementById('dashboard-sort-filter')?.value || 'newest';

  let filtered = allLoadedJobs.slice();

  // Category filter
  if (categoryQ) {
    filtered = filtered.filter(j => (j.category || 'Software & Tech') === categoryQ);
  }

  // Search filter
  if (searchQ) {
    filtered = filtered.filter(j =>
      (j.title && j.title.toLowerCase().includes(searchQ)) ||
      (j.skills && j.skills.toLowerCase().includes(searchQ)) ||
      (j.category && j.category.toLowerCase().includes(searchQ)) ||
      (j.qualifications && j.qualifications.toLowerCase().includes(searchQ)) ||
      (j.jd_text && j.jd_text.toLowerCase().includes(searchQ))
    );
  }

  // Sort
  if (sortQ === 'newest') {
    filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  } else if (sortQ === 'oldest') {
    filtered.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  } else if (sortQ === 'title') {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (sortQ === 'duration') {
    filtered.sort((a, b) => (b.max_minutes || 0) - (a.max_minutes || 0));
  }

  renderDashboardJobsList(filtered);
};

function renderDashboardJobsList(jobs) {
  const countBadge = document.getElementById('active-jobs-count');
  if (countBadge) {
    if (jobs.length === allLoadedJobs.length) {
      countBadge.textContent = `${allLoadedJobs.length} Configured`;
    } else {
      countBadge.textContent = `${jobs.length} of ${allLoadedJobs.length} Configured`;
    }
  }

  if (!jobs || jobs.length === 0) {
    if (allLoadedJobs.length === 0) {
      jobsListEl.innerHTML = `
        <div style="text-align: center; padding: 3rem 1rem;">
          <i class="bi bi-folder-plus" style="font-size: 2.2rem; color: var(--text-muted); display: block; margin-bottom: 0.5rem;"></i>
          <h4 style="font-size: 0.95rem; font-weight: 700; color: #000;">No interviews created yet</h4>
          <p style="color: var(--text-muted); font-size: 0.775rem; max-width: 420px; margin: 0.25rem auto 1.25rem;">
            Click the "Create New Interview" button to start the guided setup with custom compilers, rules, and questions.
          </p>
          <button class="btn" onclick="startInterviewCreationWizard()"><i class="bi bi-plus-lg"></i> Create First Interview</button>
        </div>
      `;
    } else {
      jobsListEl.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem;">
          <i class="bi bi-search" style="font-size: 1.8rem; color: var(--text-muted); display: block; margin-bottom: 0.5rem;"></i>
          <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--text);">No interviews match your search or category filter</h4>
          <p style="color: var(--text-muted); font-size: 0.75rem; margin: 0.25rem auto 1rem;">
            Try clearing the search query or selecting "All Categories".
          </p>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('dashboard-job-search').value=''; document.getElementById('dashboard-category-filter').value=''; filterDashboardJobs();">
            Clear Filters
          </button>
        </div>
      `;
    }
    return;
  }

  jobsListEl.innerHTML = jobs.map(j => {
    const purposeBadge = j.purpose ? `<span class="badge badge-dark">${j.purpose.toUpperCase()}</span>` : '';
    const expBadge = j.experience_required ? `<span class="badge badge-outline">${j.experience_required}</span>` : '';
    const dsaBadge = j.leetcode_problem ? `<span class="badge badge-outline" style="border-color:#000; font-weight:700;"><i class="bi bi-code-slash"></i> ${j.leetcode_problem.split(':')[0]}</span>` : '';
    const categoryBadge = j.category ? `<span class="badge badge-outline" style="font-weight:600; cursor:pointer;" onclick="setCategoryFilter('${j.category}')" title="Click to filter by category"><i class="bi bi-tag"></i> ${j.category}</span>` : '';

    const tools = [];
    if (j.terminal_required) tools.push('<i class="bi bi-terminal"></i> Compiler');
    if (j.word_editor_required) tools.push('<i class="bi bi-file-earmark-word"></i> Word Pad');
    if (j.resume_required) tools.push('<i class="bi bi-file-earmark-person"></i> Resume');

    return `
      <div class="card" style="padding:1.15rem 1.25rem; margin-bottom:0.85rem; transition: border-color 0.15s ease;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <div style="display:flex; align-items:center; gap:0.4rem; margin-bottom:0.25rem; flex-wrap:wrap;">
              <strong style="color:var(--text); font-size:0.95rem;">${j.title}</strong>
              ${categoryBadge}
              ${purposeBadge}
              ${expBadge}
              ${dsaBadge}
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted);">
              Qualifications: <strong style="color:var(--text);">${j.qualifications || 'Standard Engineering / CS'}</strong>
            </div>
          </div>
          <div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
            <button class="btn btn-sm" onclick="openShareModalForJob('${j.id}', '${encodeURIComponent(j.title)}')" style="background: #000; color: #fff;" title="Get direct shareable link for candidates">
              <i class="bi bi-link-45deg"></i> Share Link
            </button>
            <button class="btn btn-outline btn-sm" onclick="previewJobQuestions('${j.id}', '${encodeURIComponent(j.title)}')" title="Preview questions AI will ask">
              <i class="bi bi-eye"></i> Questions
            </button>
            <button class="btn btn-outline btn-sm" onclick="editInterview('${j.id}')" title="Edit interview specifications and rules">
              <i class="bi bi-pencil-square"></i> Edit
            </button>
            <button class="btn btn-outline btn-sm btn-danger-outline" onclick="deleteInterview('${j.id}', '${encodeURIComponent(j.title)}')" title="Delete this interview round">
              <i class="bi bi-trash3"></i> Delete
            </button>
            <button class="btn btn-outline btn-sm" onclick="selectJobForCandidates('${j.id}')">
              Candidates <i class="bi bi-arrow-right"></i>
            </button>
          </div>
        </div>

        <div style="color:var(--text); font-size:0.775rem; margin:0.45rem 0 0.65rem 0;">
          Skills: <strong>${j.skills}</strong>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:0.5rem; font-size:0.7rem; color:var(--text-muted);">
          <div style="display:flex; gap:0.75rem; align-items:center;">
            <span><i class="bi bi-clock"></i> ${j.max_minutes} Mins</span>
            <span><i class="bi bi-question-circle"></i> ${j.max_questions || 6} Questions</span>
            <span><i class="bi bi-gear"></i> ${j.question_mode === 'custom_questions' ? 'Custom Questions' : 'Adaptive AI'}</span>
            <span>${tools.join(' · ')}</span>
          </div>
          <span>Created on ${new Date(j.created_at || Date.now()).toLocaleDateString()}</span>
        </div>
      </div>
    `;
  }).join('');
}

window.selectJobForCandidates = function(jobId) {
  activeJobId = jobId;
  switchTab('candidates');
  inviteJobSelect.value = jobId;
  loadInterviews();
};

// Quick Demo Job helper
window.quickCreateDemoJob = async function() {
  try {
    await apiRequest('/jobs', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Junior Python / Backend Engineer',
        jd_text: 'Seeking a junior software engineer proficient in Python, SQL databases, API integration, and Git. Candidates will be assessed on foundational problem-solving and clean code execution.',
        skills: 'Python, SQL, REST APIs, Git, Algorithms',
        qualifications: 'B.Tech / B.E in Computer Science, Information Technology, or practical equivalent experience',
        purpose: 'job',
        experience_required: '0-1 Yrs',
        assessment_rules: 'Camera & Microphone Active\nBrowser Focus Tracking\nVerified Code Execution',
        leetcode_problem: 'LeetCode #1: Two Sum',
        compiler_languages: 'javascript,python,sql',
        level: 'junior',
        max_minutes: 15,
        interview_type: 'coding',
        question_mode: 'ai_adaptive',
        terminal_required: 1,
        word_editor_required: 0,
        resume_required: 1
      })
    });
    loadJobs();
    alert('Sample Role created: Junior Python / Backend Engineer with LeetCode #1 Two Sum attached.');
  } catch (e) {
    console.error(e);
  }
};

// =====================================================================
// DRAG & DROP RESUME PARSER (PDF, DOCX, TXT)
// =====================================================================
window.handleResumeDragOver = function(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropzone = document.getElementById('resume-dropzone');
  if (dropzone) dropzone.classList.add('dragover');
};

window.handleResumeDragLeave = function(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropzone = document.getElementById('resume-dropzone');
  if (dropzone) dropzone.classList.remove('dragover');
};

window.handleResumeDrop = function(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropzone = document.getElementById('resume-dropzone');
  if (dropzone) dropzone.classList.remove('dragover');

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    parseResumeFile(files[0]);
  }
};

window.handleResumeFileSelect = function(files) {
  if (files && files.length > 0) {
    parseResumeFile(files[0]);
  }
};

async function parseResumeFile(file) {
  if (!file) return;

  const idleState = document.getElementById('dropzone-idle-state');
  const loadingState = document.getElementById('dropzone-loading-state');
  const parsedCard = document.getElementById('resume-parsed-card');

  if (idleState) idleState.style.display = 'none';
  if (loadingState) loadingState.style.display = 'block';

  try {
    const formData = new FormData();
    formData.append('resume', file);

    const res = await fetch('/api/resume/parse', {
      method: 'POST',
      body: formData
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to parse resume');

    const data = result.data;

    // 1. Autofill Candidate Name if extracted
    if (data.name) {
      const nameInput = document.getElementById('invite-name');
      if (nameInput) nameInput.value = data.name;
    }

    // 2. Autofill Candidate Email if extracted
    if (data.email) {
      const emailInput = document.getElementById('invite-email');
      if (emailInput) emailInput.value = data.email;
    }

    // 3. Autofill Resume Summary & Claims
    const resumeInput = document.getElementById('invite-resume');
    if (resumeInput) {
      resumeInput.value = data.summary || '';
    }

    // 4. Render Parsed Card Badges & Skills
    const nameBadge = document.getElementById('parsed-candidate-name-badge');
    if (nameBadge) nameBadge.textContent = data.name || file.name;

    const expBadge = document.getElementById('parsed-experience-badge');
    if (expBadge) expBadge.textContent = data.experienceYears ? `${data.experienceYears} Exp` : 'Experience Extracted';

    const countBadge = document.getElementById('parsed-skills-count-badge');
    if (countBadge) countBadge.textContent = `${data.skills?.length || 0} Skills Detected`;

    const skillsCloud = document.getElementById('parsed-skills-cloud');
    if (skillsCloud) {
      if (data.skills && data.skills.length > 0) {
        skillsCloud.innerHTML = data.skills.map(sk => `
          <span class="resume-skill-pill">
            <i class="bi bi-check2"></i> ${sk}
          </span>
        `).join('');
      } else {
        skillsCloud.innerHTML = `<span style="font-size:0.72rem; color:var(--text-muted);">No specific technical keywords matched from skills library.</span>`;
      }
    }

    if (parsedCard) parsedCard.style.display = 'block';

  } catch (err) {
    alert('Resume parsing error: ' + err.message);
  } finally {
    if (idleState) idleState.style.display = 'block';
    if (loadingState) loadingState.style.display = 'none';
    const fileInput = document.getElementById('resume-file-input');
    if (fileInput) fileInput.value = '';
  }
}

window.clearParsedResume = function() {
  const parsedCard = document.getElementById('resume-parsed-card');
  if (parsedCard) parsedCard.style.display = 'none';
  const nameInput = document.getElementById('invite-name');
  if (nameInput) nameInput.value = '';
  const emailInput = document.getElementById('invite-email');
  if (emailInput) emailInput.value = '';
  const resumeInput = document.getElementById('invite-resume');
  if (resumeInput) resumeInput.value = '';
};

// Form: Candidate Invite Link Generation with Timer
document.getElementById('form-invite').addEventListener('submit', async (e) => {
  e.preventDefault();
  const jobId = inviteJobSelect.value;
  const name = document.getElementById('invite-name').value.trim();
  const email = document.getElementById('invite-email').value.trim();
  const resume_text = document.getElementById('invite-resume').value.trim();
  const link_timer_minutes = parseInt(document.getElementById('invite-timer-minutes')?.value, 10) || 60;

  if (!jobId) {
    alert('Please select or create an interview role first.');
    return;
  }

  try {
    const res = await apiRequest(`/jobs/${jobId}/interviews`, {
      method: 'POST',
      body: JSON.stringify({ name, email, resume_text, link_timer_minutes })
    });
    if (res.ok) {
      const data = await res.json();
      const fullUrl = `${window.location.origin}${data.inviteUrl}`;
      document.getElementById('invite-generated-url').value = fullUrl;
      document.getElementById('invite-test-link').href = fullUrl;
      
      const timerLabel = document.getElementById('invite-timer-label');
      if (timerLabel) {
        const expTime = data.expiresAt ? new Date(data.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        timerLabel.innerHTML = `<i class="bi bi-clock-history"></i> Timed Interview Link (Valid for ${data.timerMinutes} mins${expTime ? ' · until ' + expTime : ''}):`;
      }

      document.getElementById('invite-result-box').style.display = 'block';
      loadInterviews();
      updateResponsesBadgeCount();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to generate link');
    }
  } catch (err) {
    alert(err.message);
  }
});

window.copyInviteUrl = function() {
  const urlEl = document.getElementById('invite-generated-url');
  urlEl.select();
  navigator.clipboard.writeText(urlEl.value);
  alert('Timed candidate interview link copied to clipboard!');
};

// --- Interviews & Evidence Reports Table ---
async function loadInterviews() {
  const jobId = inviteJobSelect.value || activeJobId;
  if (!jobId) return;

  try {
    const res = await apiRequest(`/jobs/${jobId}/interviews`);
    const list = await res.json();

    if (!list || list.length === 0) {
      interviewsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); font-size: 0.775rem;">No candidates invited yet for this role. Generate an interview link above.</td></tr>`;
      return;
    }

    interviewsTableBody.innerHTML = list.map(item => {
      let stateBadge = `<span class="badge">${item.state}</span>`;
      if (item.state === 'in_progress') stateBadge = `<span class="badge badge-dark"><i class="bi bi-mic"></i> In Progress</span>`;
      if (item.state === 'completed' || item.state === 'report_ready') stateBadge = `<span class="badge badge-dark"><i class="bi bi-check2"></i> Report Ready</span>`;
      if (item.state === 'disqualified') stateBadge = `<span class="badge" style="background:#dc2626; color:#fff;"><i class="bi bi-shield-x-fill"></i> Disqualified (Cheating)</span>`;

      return `
        <tr>
          <td>
            <strong style="color:#000;">${item.candidate_name}</strong><br>
            <span style="font-size:0.725rem; color:var(--text-muted);">${item.candidate_email}</span>
          </td>
          <td>Junior Developer</td>
          <td>${stateBadge}</td>
          <td><span class="badge badge-outline"><i class="bi bi-shield-check"></i> Consent Recorded</span></td>
          <td>
            ${item.report_id || item.state === 'completed' || item.state === 'report_ready' || item.state === 'disqualified'
              ? `<button class="btn btn-sm" onclick="openReportModal('${item.interview_id}')"><i class="bi bi-file-earmark-text"></i> View Report & AI Clarification</button>`
              : `<a href="/interview.html?token=${item.interview_id}" target="_blank" class="btn btn-outline btn-sm"><i class="bi bi-play"></i> Simulate Room</a>`
            }
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Load interviews error:', err);
  }
}

// --- Top Right Drawer: Candidate Responses, Scores & Clarifications ---
let allResponsesCache = [];

window.openResponsesDrawer = function() {
  document.getElementById('responses-drawer').style.display = 'flex';
  loadOrgResponses();
};

window.closeResponsesDrawer = function() {
  document.getElementById('responses-drawer').style.display = 'none';
};

window.closeResponsesDrawerOnBackdrop = function(e) {
  if (e.target.id === 'responses-drawer') {
    closeResponsesDrawer();
  }
};

async function updateResponsesBadgeCount() {
  try {
    const res = await apiRequest('/org/responses');
    if (res.ok) {
      const data = await res.json();
      const countBadge = document.getElementById('responses-count-badge');
      if (countBadge) {
        countBadge.textContent = data.length || 0;
      }
    }
  } catch (e) {}
}

window.loadOrgResponses = async function() {
  const listEl = document.getElementById('responses-drawer-list');
  const countBadge = document.getElementById('responses-count-badge');
  listEl.innerHTML = '<p style="color:var(--text-muted); font-size:0.775rem;"><i class="bi bi-hourglass-split"></i> Loading responses and AI scores...</p>';

  try {
    const res = await apiRequest('/org/responses');
    if (!res.ok) throw new Error('Failed to load candidate responses');
    const responses = await res.json();
    allResponsesCache = responses;
    if (countBadge) countBadge.textContent = responses.length;
    renderResponsesList(responses);
  } catch (err) {
    listEl.innerHTML = `<p style="color:#000; font-size:0.775rem;">Error: ${err.message}</p>`;
  }
};

window.filterResponsesList = function() {
  const query = (document.getElementById('responses-search')?.value || '').toLowerCase().trim();
  const verdictFilter = document.getElementById('responses-filter-verdict')?.value || 'all';

  const filtered = allResponsesCache.filter(item => {
    const matchQuery = !query || 
      (item.candidate_name && item.candidate_name.toLowerCase().includes(query)) ||
      (item.candidate_email && item.candidate_email.toLowerCase().includes(query)) ||
      (item.job_title && item.job_title.toLowerCase().includes(query));

    const report = item.report || {};
    const itemVerdict = report.candidate_verdict || (report.recommendation === 'advance' ? 'RECOMMENDED_HIRE' : 'POTENTIAL_HIRE');
    const matchVerdict = (verdictFilter === 'all') || (itemVerdict === verdictFilter);

    return matchQuery && matchVerdict;
  });

  renderResponsesList(filtered);
};

function renderResponsesList(list) {
  const listEl = document.getElementById('responses-drawer-list');
  if (!list || list.length === 0) {
    listEl.innerHTML = `<p style="color:var(--text-muted); font-size:0.775rem; text-align:center; padding:2.5rem 1rem;">No candidate responses found matching your filter criteria.</p>`;
    return;
  }

  listEl.innerHTML = list.map(item => {
    const report = item.report;
    const isCompleted = item.state === 'completed' || item.state === 'report_ready' || item.state === 'disqualified' || Boolean(report);

    let verdictBadge = `<span class="badge badge-outline">Session Created</span>`;
    let scoreDisplay = `<span style="font-size:0.75rem; color:var(--text-muted);">Score Pending</span>`;
    let clarificationText = `Interview link active (Expires in ${item.link_timer_minutes || 60}m). Candidate has not finished the screening evaluation yet.`;

    if (item.state === 'disqualified' || (report && (report.disqualified || report.candidate_verdict === 'DISQUALIFIED'))) {
      verdictBadge = `<span class="badge" style="background:#dc2626; color:#ffffff; font-weight:700;"><i class="bi bi-shield-x-fill"></i> DISQUALIFIED (CHEATING)</span>`;
      scoreDisplay = `<strong style="font-size:1.15rem; color:#dc2626;">0</strong><span style="font-size:0.7rem; color:#dc2626;"> / 100</span>`;
      clarificationText = `SECURITY TERMINATION: Candidate was disqualified by Vision AI Proctoring for cheating: ${item.disqualified_reason || report?.disqualified_reason || 'Anti-cheating policy violation'}.`;
    } else if (report) {
      const verdict = report.candidate_verdict || (report.recommendation === 'advance' ? 'RECOMMENDED_HIRE' : (report.recommendation === 'reject' ? 'NOT_RECOMMENDED' : 'POTENTIAL_HIRE'));
      const score = report.overall_score || (report.recommendation === 'advance' ? 84 : 68);

      if (verdict === 'RECOMMENDED_HIRE') {
        verdictBadge = `<span class="badge badge-dark"><i class="bi bi-check-circle-fill"></i> RECOMMENDED HIRE</span>`;
      } else if (verdict === 'POTENTIAL_HIRE') {
        verdictBadge = `<span class="badge badge-outline" style="border-color:#000; font-weight:700;"><i class="bi bi-question-circle"></i> POTENTIAL HIRE</span>`;
      } else {
        verdictBadge = `<span class="badge" style="background:#f4f4f5; color:#52525b;"><i class="bi bi-x-circle"></i> NOT RECOMMENDED</span>`;
      }

      scoreDisplay = `<strong style="font-size:1.15rem; color:#000;">${score}</strong><span style="font-size:0.7rem; color:var(--text-muted);"> / 100</span>`;
      clarificationText = report.hiring_clarification || report.overall_summary || 'Evaluation report ready.';
    }

    const typeBadge = item.interview_type ? `<span class="badge badge-outline" style="font-size:0.65rem;">${item.interview_type.toUpperCase()}</span>` : '';

    return `
      <div class="response-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
          <div>
            <strong style="font-size:0.875rem; color:#000;">${item.candidate_name}</strong>
            <div style="font-size:0.725rem; color:var(--text-muted); margin-top:0.1rem;">
              ${item.candidate_email} · ${item.job_title} ${typeBadge}
            </div>
          </div>
          <div style="text-align:right;">
            ${scoreDisplay}
            <div style="margin-top:0.25rem;">${verdictBadge}</div>
          </div>
        </div>

        <div class="clarification-box">
          <div style="font-size:0.6875rem; font-weight:700; text-transform:uppercase; color:#000; margin-bottom:0.15rem;">
            <i class="bi bi-cpu"></i> AI Hiring Clarification & Recommendation:
          </div>
          ${clarificationText}
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.75rem; border-top:1px solid var(--border); padding-top:0.6rem;">
          <span style="font-size:0.6875rem; color:var(--text-muted);">
            ${item.ended_at ? 'Completed on ' + new Date(item.ended_at).toLocaleDateString() : 'Awaiting completion'}
          </span>
          <div style="display:flex; gap:0.4rem;">
            ${isCompleted
              ? `<button class="btn btn-sm" onclick="openReportModal('${item.interview_id}')"><i class="bi bi-journal-text"></i> Full Conversation & Analysis</button>`
              : `<a href="/interview.html?token=${item.interview_id}" target="_blank" class="btn btn-outline btn-sm"><i class="bi bi-play"></i> Open Room</a>`
            }
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Evidence-Backed Report Modal with AI Hiring Clarification & Verdict
window.openReportModal = async function(interviewId) {
  const modal = document.getElementById('report-modal');
  const modalCandidate = document.getElementById('modal-report-candidate');
  const modalMeta = document.getElementById('modal-report-meta');
  const modalBody = document.getElementById('modal-report-body');

  modal.style.display = 'flex';
  modalBody.innerHTML = '<p style="color:var(--text-muted); font-size:0.775rem;">Loading report and validating quotes against transcript...</p>';

  try {
    const res = await apiRequest(`/interviews/${interviewId}/report`);
    const data = await res.json();

    const { interview, report, turns } = data;
    currentReportCandidateId = interview.candidate_id;
    modalCandidate.textContent = interview.candidate_name;
    modalMeta.textContent = `${interview.job_title} · Candidate: ${interview.candidate_email}`;

    if (!report) {
      modalBody.innerHTML = '<p style="color:#000; font-size:0.775rem;">Report is generating or session has not ended.</p>';
      return;
    }

    const verdict = report.candidate_verdict || (report.recommendation === 'advance' ? 'RECOMMENDED_HIRE' : 'POTENTIAL_HIRE');
    const score = report.overall_score || (report.recommendation === 'advance' ? 84 : 68);
    const clarification = report.hiring_clarification || report.overall_summary || 'Evaluation complete.';

    const skillsHtml = (report.skills || []).map(s => {
      const evidenceHtml = (s.evidence || []).map(e => `
        <div class="quote-box">
          <div style="font-size:0.7rem; font-weight:600; color:var(--text); margin-bottom:0.15rem;">
            Turn ${e.turn || '?'} ${e.verified_in_transcript ? '· Verified in Transcript' : '· Captured Response'}
          </div>
          "${e.quote}"
        </div>
      `).join('');

      const gapsHtml = (s.gaps || []).map(g => `<li style="font-size:0.75rem; color:var(--text-muted);">${g}</li>`).join('');

      return `
        <div class="card" style="padding:0.85rem 1rem; margin-bottom:0.75rem;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:0.825rem; color:var(--text);">${s.skill}</strong>
            <div>
              <span class="badge badge-dark">Score: ${s.score} / 5</span>
              <span class="badge badge-outline" style="margin-left:0.25rem;">Confidence: ${s.confidence}</span>
            </div>
          </div>
          <div style="margin-top:0.5rem;">
            <span style="font-size:0.7rem; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Direct Candidate Evidence:</span>
            ${evidenceHtml || '<div style="color:var(--text-muted); font-size:0.75rem;">No direct quote captured</div>'}
          </div>
          ${gapsHtml ? `
            <div style="margin-top:0.5rem;">
              <span style="font-size:0.7rem; text-transform:uppercase; color:var(--text); font-weight:700;">Identified Gaps:</span>
              <ul style="padding-left:1.25rem; margin-top:0.2rem;">${gapsHtml}</ul>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    const claimsHtml = (report.resume_claims || []).map(c => `
      <div style="display:flex; justify-content:space-between; padding:0.4rem 0; border-bottom:1px solid var(--border); font-size:0.75rem;">
        <span>${c.claim}</span>
        <span class="badge ${c.status === 'verified' ? 'badge-dark' : 'badge-outline'}">${c.status}</span>
      </div>
    `).join('');

    const turnsHtml = turns.map(t => `
      <div style="margin-bottom:0.5rem; font-size:0.775rem; padding:0.5rem; border-radius:4px; background:var(--surface-subtle); border:1px solid var(--border);">
        <strong style="color:var(--text);">[Turn ${t.idx}] ${t.role.toUpperCase()}:</strong>
        <p style="margin-top:0.15rem; line-height:1.4; color:var(--text);">${t.text}</p>
      </div>
    `).join('');

    modalBody.innerHTML = `
      <!-- Verdict & Overall Score Bar -->
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--surface-subtle); padding:1rem 1.25rem; border-radius:6px; margin-bottom:1rem; border:1px solid var(--border);">
        <div>
          <div style="font-size:0.7rem; text-transform:uppercase; color:var(--text-muted); font-weight:700;">AI Hiring Verdict</div>
          <div style="margin-top:0.25rem;">
            ${
              report.disqualified || verdict === 'DISQUALIFIED' || interview.state === 'disqualified'
                ? '<span class="badge" style="background:#dc2626; color:#fff; font-size:0.85rem; padding:0.4rem 0.85rem; font-weight:700;"><i class="bi bi-shield-x-fill"></i> DISQUALIFIED (CHEATING DETECTED)</span>'
                : (verdict === 'NOT_RECOMMENDED' || report.recommendation === 'reject'
                    ? '<span class="badge" style="background:#dc2626; color:#fff; font-size:0.85rem; padding:0.4rem 0.85rem; font-weight:700;"><i class="bi bi-x-circle-fill"></i> NOT RECOMMENDED (REJECT)</span>'
                    : (verdict === 'POTENTIAL_HIRE' || report.recommendation === 'maybe'
                        ? '<span class="badge" style="background:#d97706; color:#fff; font-size:0.85rem; padding:0.4rem 0.85rem; font-weight:700;"><i class="bi bi-question-circle-fill"></i> POTENTIAL HIRE (BORDERLINE)</span>'
                        : '<span class="badge badge-dark" style="font-size:0.85rem; padding:0.4rem 0.85rem; font-weight:700;"><i class="bi bi-check-circle-fill"></i> RECOMMENDED HIRE</span>'))
            }
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.7rem; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Overall Technical Score</div>
          <div style="font-size:1.45rem; font-weight:700; color:${report.disqualified || verdict === 'DISQUALIFIED' ? '#dc2626' : 'var(--text)'}; margin-top:0.1rem;">
            ${score} <span style="font-size:0.75rem; color:var(--text-muted); font-weight:400;">/ 100</span>
          </div>
        </div>
      </div>

      ${(report.disqualified || (report.proctor_violations && report.proctor_violations.length > 0) || interview.disqualified_reason) ? `
        <!-- Anti-Cheating & Proctoring Security Incident Box -->
        <div style="background: rgba(220, 38, 38, 0.08); border: 2px solid #dc2626; border-radius: 6px; padding: 1rem; margin-bottom: 1.25rem;">
          <strong style="color: #dc2626; font-size: 0.85rem; text-transform: uppercase; display: flex; align-items: center; gap: 0.4rem;">
            <i class="bi bi-shield-x-fill"></i> Vision AI Proctoring Security Breach:
          </strong>
          <p style="font-size: 0.8rem; color: #b91c1c; margin: 0.35rem 0 0.5rem 0; font-weight: 600;">
            Candidate was disqualified: ${interview.disqualified_reason || report.disqualified_reason || 'Cheating detected by AI Vision Proctor'}
          </p>
          <div style="font-family: monospace; font-size: 0.725rem; color: #991b1b; background: #fff; padding: 0.6rem 0.75rem; border-radius: 4px; border: 1px solid #fca5a5;">
            <strong style="color: #dc2626;">Recorded Security Violations (${(report.proctor_violations || []).length}):</strong>
            <ul style="margin: 0.35rem 0 0 1rem; padding: 0;">
              ${(report.proctor_violations || []).map(v => `<li>[${v.time || 'Logged'}] Warning ${v.warningNumber || '!'}: ${v.reason}</li>`).join('')}
            </ul>
          </div>
        </div>
      ` : ''}

      <!-- Hiring Clarification Box -->
      <div class="clarification-box" style="margin-bottom:1.25rem; padding:1rem; border-radius:6px; ${verdict === 'NOT_RECOMMENDED' || report.recommendation === 'reject' ? 'border-left: 4px solid #dc2626; background: rgba(220,38,38,0.04);' : ''}">
        <h4 style="font-size:0.75rem; text-transform:uppercase; color:var(--text); margin-bottom:0.35rem; font-weight:700; display:flex; align-items:center; gap:0.35rem;">
          <i class="bi bi-lightbulb-fill"></i> AI Clarification: Is this candidate good to hire?
        </h4>
        <p style="line-height:1.5; font-size:0.8125rem; color:var(--text); font-weight:500;">
          ${clarification}
        </p>
      </div>

      ${(report.red_flags && report.red_flags.length > 0) ? `
        <!-- Critical Red Flags Alert Box -->
        <div style="background: rgba(220, 38, 38, 0.08); border: 1px solid #dc2626; border-radius: 6px; padding: 0.85rem 1rem; margin-bottom: 1.25rem;">
          <strong style="color: #dc2626; font-size: 0.8rem; text-transform: uppercase; display: flex; align-items: center; gap: 0.4rem;">
            <i class="bi bi-exclamation-triangle-fill"></i> Critical Red Flags (${report.red_flags.length}):
          </strong>
          <ul style="padding-left: 1.25rem; margin-top: 0.4rem; margin-bottom: 0;">
            ${report.red_flags.map(rf => `<li style="font-size: 0.775rem; color: #dc2626; font-weight: 600; margin-bottom: 0.2rem;">${rf}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div style="margin-bottom:1rem;">
        <h4 style="font-size:0.75rem; text-transform:uppercase; color:var(--text-muted); margin-bottom:0.35rem; font-weight:700;">Executive Summary</h4>
        <p style="background:var(--surface-subtle); padding:0.75rem; border-radius:6px; line-height:1.5; border:1px solid var(--border); font-size:0.785rem; color:var(--text);">
          ${report.overall_summary}
        </p>
      </div>

      
      <!-- Question-by-Question Technical Correctness & Coverage Audit -->
      <div style="margin-bottom:1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h4 style="font-size:0.75rem; text-transform:uppercase; color:var(--text); font-weight:700; margin: 0; display:flex; align-items:center; gap:0.35rem;">
            <i class="bi bi-clipboard2-check-fill"></i> Question-by-Question Correctness &amp; Requirement Coverage
          </h4>
          <span class="badge badge-outline" style="font-size: 0.7rem;">${(report.question_evaluations || []).length} Questions Evaluated</span>
        </div>
        <p style="font-size: 0.725rem; color: var(--text-muted); margin-bottom: 0.75rem;">
          Every candidate answer is rigorously audited against expected technical key points to verify whether required concepts were genuinely covered.
        </p>

        <div style="display: flex; flex-direction: column; gap: 0.65rem;">
          ${(report.question_evaluations || []).map(q => {
            const isGood = q.correctness_level >= 3;
            const isPartial = q.correctness_level === 2;
            const isBad = q.correctness_level <= 1;

            const badgeBg = isGood ? '#16a34a' : (isPartial ? '#d97706' : '#dc2626');
            const covColor = isGood ? '#16a34a' : (isPartial ? '#d97706' : '#dc2626');

            return `
              <div class="card" style="padding: 0.85rem 1rem; margin-bottom: 0; border: 1px solid var(--border);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.35rem; flex-wrap: wrap; gap: 0.4rem;">
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span class="badge badge-dark" style="font-size: 0.68rem;">Q${q.question_turn} · ${q.skill}</span>
                    <span class="badge" style="background: ${badgeBg}; color: #fff; font-size: 0.68rem; font-weight: 700;">${q.correctness}</span>
                  </div>
                  <div style="font-size: 0.75rem; font-weight: 700; color: var(--text);">
                    Required Coverage: <span style="color: ${covColor};">${q.coverage_score}%</span>
                  </div>
                </div>

                <div style="font-size: 0.785rem; font-weight: 600; color: var(--text); margin: 0.35rem 0 0.45rem 0; line-height: 1.4;">
                  ${q.question}
                </div>

                <div style="background: var(--surface-subtle); border-left: 3px solid var(--border-dark); padding: 0.45rem 0.65rem; margin-bottom: 0.5rem; font-size: 0.75rem; color: var(--text); font-style: italic;">
                  <strong>Candidate's Actual Response:</strong> "${q.candidate_answer}"
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.725rem; margin-top: 0.4rem;">
                  <div style="background: rgba(22, 163, 74, 0.05); border: 1px solid #16a34a; border-radius: 4px; padding: 0.45rem 0.6rem;">
                    <strong style="color: #16a34a; display: block; margin-bottom: 0.25rem;"><i class="bi bi-check2-circle"></i> Covered Concepts (${q.covered_points.length}):</strong>
                    ${q.covered_points.map(p => `<div style="color: #15803d; margin-bottom: 0.15rem;">✔ ${p}</div>`).join('') || '<div style="color: var(--text-muted); font-style: italic;">None covered</div>'}
                  </div>

                  <div style="background: rgba(220, 38, 38, 0.05); border: 1px solid #dc2626; border-radius: 4px; padding: 0.45rem 0.6rem;">
                    <strong style="color: #dc2626; display: block; margin-bottom: 0.25rem;"><i class="bi bi-x-circle"></i> Missing Requirements (${q.missing_points.length}):</strong>
                    ${q.missing_points.map(p => `<div style="color: #b91c1c; margin-bottom: 0.15rem;">✖ ${p}</div>`).join('') || '<div style="color: #16a34a; font-weight: 600;">All key requirements covered!</div>'}
                  </div>
                </div>

                <div style="margin-top: 0.45rem; font-size: 0.725rem; color: var(--text-muted);">
                  <strong>Audit Notes:</strong> ${q.technical_notes}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div style="margin-bottom:1rem;">
        <h4 style="font-size:0.75rem; text-transform:uppercase; color:var(--text-muted); margin-bottom:0.5rem; font-weight:700;">Skill-by-Skill Verified Evidence</h4>
        ${skillsHtml}
      </div>

      <div style="margin-bottom:1rem;">
        <h4 style="font-size:0.75rem; text-transform:uppercase; color:var(--text-muted); margin-bottom:0.35rem; font-weight:700;">Resume Claim Verification</h4>
        <div style="background:#fff; border:1px solid var(--border); border-radius:6px; padding:0.5rem 0.75rem;">
          ${claimsHtml || '<span style="color:var(--text-muted); font-size:0.75rem;">No resume claims provided</span>'}
        </div>
      </div>

      <details style="margin-top:1rem; background:var(--surface-subtle); border:1px solid var(--border); border-radius:6px; padding:0.75rem;">
        <summary style="cursor:pointer; font-weight:600; color:#000; font-size:0.775rem;"><i class="bi bi-journal-text"></i> Full Turn-by-Turn Conversation (${turns.length} turns)</summary>
        <div style="margin-top:0.75rem; max-height:280px; overflow-y:auto;">
          ${turnsHtml}
        </div>
      </details>
    `;
  } catch (err) {
    modalBody.innerHTML = `<p style="color:#000; font-size:0.775rem;">Error loading report: ${err.message}</p>`;
  }
};

window.closeReportModal = function() {
  document.getElementById('report-modal').style.display = 'none';
};

// DPDP Right to Erasure
document.getElementById('btn-erase-candidate').addEventListener('click', async () => {
  if (!currentReportCandidateId) return;
  if (!confirm('DPDP Act: Permanently erase this candidate’s personal details? This action cannot be undone.')) {
    return;
  }

  try {
    const res = await apiRequest(`/candidates/${currentReportCandidateId}`, { method: 'DELETE' });
    if (res.ok) {
      alert('Candidate records permanently erased.');
      closeReportModal();
      loadInterviews();
    } else {
      alert('Failed to erase record');
    }
  } catch (err) {
    alert(err.message);
  }
});

// --- BYOK / Provider Key Vault ---
async function loadKeyStatus() {
  const statusEl = document.getElementById('key-current-status');
  try {
    const res = await apiRequest('/org/provider-key');
    const data = await res.json();
    if (data.configured) {
      statusEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <span class="badge badge-dark"><i class="bi bi-shield-check"></i> Key Configured & Active</span>
            <div style="font-family:monospace; margin-top:0.3rem; color:#000; font-weight:700; font-size:0.775rem;">Provider: ${data.provider.toUpperCase()} · ${data.masked}</div>
          </div>
          <span style="font-size:0.7rem; color:var(--text-muted);">AES-256-GCM Encrypted</span>
        </div>
      `;
    } else {
      statusEl.innerHTML = `
        <div style="color:var(--text-muted); font-size:0.775rem;">
          No custom key saved. ${data.defaultFallbackAvailable ? '<span style="color:#000; font-weight:600;">(Platform default test key active)</span>' : '<span>(Using local simulated engine)</span>'}
        </div>
      `;
    }
  } catch (err) {
    statusEl.innerHTML = `<span style="font-size:0.75rem; color:var(--text-muted);">Error loading key status</span>`;
  }
}

document.getElementById('form-key').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = document.getElementById('input-api-key').value;

  try {
    const res = await apiRequest('/org/provider-key', {
      method: 'POST',
      body: JSON.stringify({ provider: 'gemini', apiKey })
    });
    if (res.ok) {
      alert('Gemini API key validated and stored in encrypted vault.');
      document.getElementById('input-api-key').value = '';
      loadKeyStatus();
    } else {
      const err = await res.json();
      alert(`Validation failed: ${err.error}`);
    }
  } catch (err) {
    alert(err.message);
  }
});

window.deleteProviderKey = async function() {
  if (!confirm('Remove your stored provider API key?')) return;
  try {
    const res = await apiRequest('/org/provider-key', { method: 'DELETE' });
    if (res.ok) {
      alert('API key deleted safely.');
      loadKeyStatus();
    }
  } catch (e) {
    alert(e.message);
  }
};

// --- Metrics & Usage ---
async function loadMetrics() {
  try {
    const res = await apiRequest('/usage');
    const data = await res.json();
    const stats = data.stats || {};

    document.getElementById('metric-interviews').textContent = stats.total_interviews || data.completedInterviews || 0;
    document.getElementById('metric-in-tokens').textContent = (stats.total_input_tokens || 0).toLocaleString();
    document.getElementById('metric-out-tokens').textContent = (stats.total_output_tokens || 0).toLocaleString();
    document.getElementById('metric-cost').textContent = `₹${(stats.total_est_cost_inr || 0).toFixed(2)}`;
  } catch (err) {
    console.error('Metrics load error:', err);
  }
}

// --- CSV Export for Candidates ---
window.exportCandidatesCsv = function() {
  const jobId = inviteJobSelect.value || activeJobId;
  if (!jobId) {
    alert('Please select a job role first to export candidates.');
    return;
  }
  fetch(`/jobs/${jobId}/export.csv`, {
    headers: { Authorization: `Bearer ${authToken}` }
  })
  .then(res => {
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  })
  .then(blob => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `candidates_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  })
  .catch(err => alert('CSV Export Error: ' + err.message));
};

// --- VIP Pilot Waitlist Modal ---
window.openWaitlistModal = function() {
  document.getElementById('waitlist-modal').style.display = 'flex';
};

window.closeWaitlistModal = function() {
  document.getElementById('waitlist-modal').style.display = 'none';
};

document.getElementById('form-waitlist')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('wl-name').value;
  const company = document.getElementById('wl-company').value;
  const email = document.getElementById('wl-email').value;
  const phone = document.getElementById('wl-phone').value;
  const vacancies = document.getElementById('wl-vacancies').value;

  try {
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, company, email, phone, vacancies })
    });
    const data = await res.json();
    alert(data.message || 'VIP Pilot request received.');
    closeWaitlistModal();
    document.getElementById('form-waitlist').reset();
  } catch (err) {
    alert(err.message);
  }
});

// --- Free Question Generator (Lead Magnet) ---
document.getElementById('form-leadmagnet')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('lm-name').value;
  const email = document.getElementById('lm-email').value;
  const jd_text = document.getElementById('lm-jd').value;
  const resContainer = document.getElementById('lm-result-container');
  const questionsList = document.getElementById('lm-questions-list');

  resContainer.style.display = 'block';
  questionsList.innerHTML = '<p style="color:var(--text-muted); font-size:0.775rem;"><i class="bi bi-hourglass-split"></i> Formulating technical screening questions...</p>';

  try {
    const res = await fetch('/api/lead-magnet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, jd_text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate questions');

    questionsList.innerHTML = data.questions.map(q => `
      <div style="background:#fff; border:1px solid var(--border); border-radius:6px; padding:0.85rem 1rem; margin-bottom:0.75rem;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="color:#000; font-size:0.825rem;">Q${q.id}. ${q.skill} (${q.level})</strong>
        </div>
        <p style="font-size:0.8rem; margin:0.35rem 0 0.5rem; color:#18181b; font-weight:500;">
          "${q.question}"
        </p>
        <div style="background:var(--surface-subtle); border-left:2px solid #000; padding:0.5rem 0.75rem; border-radius:4px; font-size:0.75rem;">
          <div style="font-weight:700; margin-bottom:0.2rem; color:#000;">Scoring Rubric:</div>
          <div><strong>Score 1:</strong> ${q.rubric.score_1}</div>
          <div><strong>Score 3:</strong> ${q.rubric.score_3}</div>
          <div><strong>Score 5:</strong> ${q.rubric.score_5}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    questionsList.innerHTML = `<p style="color:#000; font-size:0.75rem;">${err.message}</p>`;
  }
});

// Initial boot
(async function() {
  await checkAuthSession();
})();


// --- Duration, Question Limits, Preview & Share Link Handlers ---
const DURATION_QUESTION_MAP = {
  3: 2,
  5: 3,
  10: 4,
  15: 6,
  20: 8,
  30: 10,
  45: 14,
  60: 18
};

window.handleWizardDurationChange = function() {
  const durVal = parseInt(document.getElementById('wiz-target-duration')?.value || '15', 10);
  const qInput = document.getElementById('wiz-max-questions');
  if (qInput) {
    const recommended = DURATION_QUESTION_MAP[durVal] || Math.max(2, Math.round(durVal / 3));
    qInput.value = recommended;
  }
  refreshQuestionsPreview();
};

window.handleWizardQuestionCountChange = function() {
  const qInput = document.getElementById('wiz-max-questions');
  if (qInput) {
    let val = parseInt(qInput.value, 10);
    if (isNaN(val) || val < 2) val = 2;
    if (val > 25) val = 25;
    qInput.value = val;
  }
  refreshQuestionsPreview();
};

window.refreshQuestionsPreview = async function() {
  const listEl = document.getElementById('sum-questions-preview-list');
  const countBadge = document.getElementById('sum-questions-count');
  if (!listEl) return;

  const role = document.getElementById('wiz-job-title')?.value || 'Software Engineer';
  const category = document.getElementById('role-category-select')?.value || 'Software & Tech';
  const skills = document.getElementById('wiz-job-skills')?.value || '';
  const maxQuestions = parseInt(document.getElementById('wiz-max-questions')?.value || '6', 10);
  const customQuestions = document.getElementById('wiz-custom-questions-text')?.value || '';

  let leetcode = '';
  if (document.getElementById('wiz-dsa-toggle')?.checked) {
    const lcSelect = document.getElementById('wiz-leetcode-select')?.value;
    if (lcSelect === 'custom') {
      leetcode = document.getElementById('wiz-custom-leetcode-input')?.value || 'Custom DSA Problem';
    } else if (typeof LEETCODE_CATALOG !== 'undefined' && LEETCODE_CATALOG[lcSelect]) {
      leetcode = LEETCODE_CATALOG[lcSelect].title;
    }
  }

  if (countBadge) {
    countBadge.textContent = `${maxQuestions} Target Questions`;
  }

  listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.75rem;"><div class="spinner-border spinner-border-sm" role="status" style="width:0.8rem;height:0.8rem;"></div> Generating company questions preview...</div>';

  try {
    const res = await apiRequest('/api/questions/preview', {
      method: 'POST',
      body: JSON.stringify({
        role,
        category,
        skills,
        leetcode,
        maxQuestions,
        customQuestions
      })
    });

    if (!res.ok) {
      listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.75rem;">Preview unavailable</div>';
      return;
    }

    const data = await res.json();
    const questions = data.questions || [];

    if (questions.length === 0) {
      listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.75rem;">No specific questions planned. Dynamic adaptive mode active.</div>';
      return;
    }

    listEl.innerHTML = questions.map((q, idx) => {
      const typeBadge = q.type === 'dsa' 
        ? '<span class="badge badge-dark" style="font-size:0.65rem;">DSA Problem</span>' 
        : (q.type === 'custom' 
            ? '<span class="badge badge-outline" style="font-size:0.65rem;">Custom Q</span>' 
            : `<span class="badge badge-outline" style="font-size:0.65rem;">${q.skill || 'Core'}</span>`);

      return `
        <div style="background: var(--surface-subtle); border: 1px solid var(--border); border-radius: 5px; padding: 0.5rem 0.65rem; font-size: 0.725rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem;">
            <strong style="color: var(--text);">Q${idx + 1}</strong>
            ${typeBadge}
          </div>
          <div style="color: var(--text); line-height: 1.4;">${q.question || q.text}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="color: var(--text-muted); font-size: 0.75rem;">Preview loaded with adaptive fallback.</div>`;
  }
};

window.openShareModalForJob = function(jobId, rawTitle) {
  const title = decodeURIComponent(rawTitle || 'Interview Round');
  const titleEl = document.getElementById('share-modal-job-title');
  const urlInput = document.getElementById('share-modal-url');
  const openLink = document.getElementById('btn-open-share-candidate');
  const modal = document.getElementById('modal-share-link');
  const toast = document.getElementById('share-copy-toast');

  if (toast) toast.style.display = 'none';
  if (titleEl) titleEl.textContent = title;

  const shareUrl = `${window.location.origin}/interview.html?job=${jobId}`;
  if (urlInput) urlInput.value = shareUrl;
  if (openLink) openLink.href = shareUrl;

  if (modal) modal.style.display = 'flex';
};

window.closeShareModal = function() {
  const modal = document.getElementById('modal-share-link');
  if (modal) modal.style.display = 'none';
};

window.copyShareModalUrl = async function() {
  const urlInput = document.getElementById('share-modal-url');
  const toast = document.getElementById('share-copy-toast');
  if (!urlInput) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(urlInput.value);
    } else {
      urlInput.select();
      document.execCommand('copy');
    }
    if (toast) {
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }
  } catch (err) {
    urlInput.select();
    document.execCommand('copy');
    if (toast) {
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }
  }
};

window.previewJobQuestions = async function(jobId, rawTitle) {
  const title = decodeURIComponent(rawTitle || 'Interview Round');
  const modal = document.getElementById('modal-questions-preview');
  const titleEl = document.getElementById('card-preview-job-title');
  const listEl = document.getElementById('card-preview-questions-list');

  if (titleEl) titleEl.textContent = title;
  if (modal) modal.style.display = 'flex';
  if (listEl) listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.775rem;"><div class="spinner-border spinner-border-sm" role="status" style="width:0.85rem;height:0.85rem;"></div> Loading planned questions...</div>';

  try {
    const jobRes = await apiRequest(`/public/jobs/${jobId}`);
    if (!jobRes.ok) throw new Error('Could not fetch interview round');
    const job = await jobRes.json();

    const qRes = await apiRequest('/api/questions/preview', {
      method: 'POST',
      body: JSON.stringify({
        role: job.title,
        category: job.category,
        skills: job.skills,
        leetcode: job.leetcode_problem,
        maxQuestions: job.max_questions || 6,
        customQuestions: job.custom_questions || ''
      })
    });

    if (!qRes.ok) throw new Error('Could not fetch question preview');
    const qData = await qRes.json();
    const questions = qData.questions || [];

    if (questions.length === 0) {
      listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.775rem;">No static questions. AI generates adaptive questions dynamically based on candidate responses.</div>';
      return;
    }

    listEl.innerHTML = questions.map((q, idx) => {
      const typeBadge = q.type === 'dsa' 
        ? '<span class="badge badge-dark" style="font-size:0.65rem;">Coding / DSA</span>' 
        : (q.type === 'custom' 
            ? '<span class="badge badge-outline" style="font-size:0.65rem;">Custom Q</span>' 
            : `<span class="badge badge-outline" style="font-size:0.65rem;">${q.skill || 'Core'}</span>`);

      return `
        <div style="background: var(--surface-subtle); border: 1px solid var(--border); border-radius: 6px; padding: 0.65rem 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
            <strong style="color: var(--text); font-size: 0.8rem;">Question ${idx + 1}</strong>
            ${typeBadge}
          </div>
          <div style="color: var(--text); font-size: 0.775rem; line-height: 1.45;">${q.question || q.text}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div style="color: #ef4444; font-size: 0.775rem;">Error loading questions: ${err.message}</div>`;
  }
};

window.closeQuestionsPreviewModal = function() {
  const modal = document.getElementById('modal-questions-preview');
  if (modal) modal.style.display = 'none';
};


// ═══════════════════════════════════════════════════════════════════════════
// BILLING & PRICING SECTION
// ═══════════════════════════════════════════════════════════════════════════

const DURATION_TIERS = [
  { minutes: 10, priceUsd: 1.00, label: '10 min' },
  { minutes: 20, priceUsd: 1.50, label: '20 min' },
  { minutes: 30, priceUsd: 2.00, label: '30 min' },
  { minutes: 40, priceUsd: 2.50, label: '40 min' },
  { minutes: 50, priceUsd: 3.00, label: '50 min' },
  { minutes: 60, priceUsd: 3.50, label: '60 min' },
];

const SUBSCRIPTION_PLANS = [
  { id: 'monthly_1', label: '1 Month',  months: 1,  priceUsd: 100, includedInterviews: 150,  popular: false, savingsLabel: null },
  { id: 'monthly_2', label: '2 Months', months: 2,  priceUsd: 160, includedInterviews: 280,  popular: false, savingsLabel: 'Save $40' },
  { id: 'quarterly', label: '3 Months', months: 3,  priceUsd: 220, includedInterviews: 420,  popular: false, savingsLabel: 'Save $80' },
  { id: 'biannual',  label: '6 Months', months: 6,  priceUsd: 450, includedInterviews: 900,  popular: true,  savingsLabel: 'Save $150' },
  { id: 'annual',    label: '1 Year',   months: 12, priceUsd: 800, includedInterviews: 1800, popular: false, savingsLabel: 'Save $400' },
];

let billingSelectedDuration = 10;
let billingCheckoutType = 'ppu';
let billingCheckoutPlan = null;

// ── Init billing UI when switching to metrics tab ─────────────────────────
function initBillingTab() {
  renderDurGrid();
  renderPriceTable();
  renderSubPlans();
  renderSubCompare();
  updatePPUQuote();
  loadBillingBalance();
}

// ── Duration selector ─────────────────────────────────────────────────────
function renderDurGrid() {
  const grid = document.getElementById('dur-grid');
  if (!grid) return;
  grid.innerHTML = DURATION_TIERS.map(t => `
    <button onclick="selectDuration(${t.minutes})" style="
      padding:0.55rem 0.35rem; border-radius:5px; border:1.5px solid ${t.minutes === billingSelectedDuration ? '#000' : 'var(--border)'};
      background:${t.minutes === billingSelectedDuration ? '#000' : 'var(--surface-subtle)'};
      color:${t.minutes === billingSelectedDuration ? '#fff' : 'var(--text)'};
      font-size:0.775rem; font-weight:${t.minutes === billingSelectedDuration ? '700' : '500'};
      cursor:pointer; text-align:center; transition:all .15s;">
      <div>${t.label}</div>
      <div style="font-size:0.7rem; opacity:0.75; margin-top:2px;">$${t.priceUsd.toFixed(2)}</div>
    </button>
  `).join('');
}

window.selectDuration = function(minutes) {
  billingSelectedDuration = minutes;
  renderDurGrid();
  renderPriceTable();
  updatePPUQuote();
};

// ── Pricing table ─────────────────────────────────────────────────────────
function renderPriceTable() {
  const tbody = document.getElementById('price-table-body');
  if (!tbody) return;
  tbody.innerHTML = DURATION_TIERS.map(t => {
    const isSelected = t.minutes === billingSelectedDuration;
    const hrRate = (t.priceUsd * (60 / t.minutes)).toFixed(2);
    return `<tr style="border-bottom:1px solid var(--border); ${isSelected ? 'background:var(--surface-subtle);' : ''}">
      <td style="padding:0.5rem;">
        ${t.label}
        ${isSelected ? '<span class="badge badge-dark" style="margin-left:0.35rem; font-size:0.65rem;">Selected</span>' : ''}
      </td>
      <td style="text-align:right; padding:0.5rem; font-weight:${isSelected ? '700' : '500'};">$${t.priceUsd.toFixed(2)}</td>
      <td style="text-align:right; padding:0.5rem; color:var(--text-muted);">$${hrRate}</td>
    </tr>`;
  }).join('');
}

// ── Quote calculator ──────────────────────────────────────────────────────
window.updatePPUQuote = function() {
  const qty = Math.max(1, parseInt(document.getElementById('ppu-qty')?.value) || 1);
  const tier = DURATION_TIERS.find(t => t.minutes === billingSelectedDuration);
  const freeInterviews = Math.floor(qty / 10);
  const billedFor = qty - freeInterviews;
  const totalUsd = (billedFor * tier.priceUsd).toFixed(2);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setStyle = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val; };

  setEl('q-price-per', `$${tier.priceUsd.toFixed(2)}`);
  setEl('q-qty-show', qty);
  setEl('q-billed', `${billedFor} interview${billedFor !== 1 ? 's' : ''}`);
  setEl('q-total', `$${totalUsd}`);

  const bulkNotice = document.getElementById('ppu-bulk-notice');
  const freeRow = document.getElementById('q-free-row');

  if (freeInterviews > 0) {
    if (bulkNotice) bulkNotice.style.display = 'block';
    document.getElementById('ppu-bulk-text').textContent =
      `You get ${freeInterviews} FREE interview${freeInterviews > 1 ? 's' : ''} with this order! 🎉`;
    if (freeRow) freeRow.style.display = 'flex';
    setEl('q-free-count', `+${freeInterviews}`);
  } else {
    if (bulkNotice) bulkNotice.style.display = 'none';
    if (freeRow) freeRow.style.display = 'none';
  }
};

// ── Subscription plans ────────────────────────────────────────────────────
function renderSubPlans() {
  const grid = document.getElementById('sub-plans-grid');
  if (!grid) return;
  grid.innerHTML = SUBSCRIPTION_PLANS.map(p => {
    const cpi = (p.priceUsd / p.includedInterviews).toFixed(2);
    return `
      <div onclick="selectSubPlan('${p.id}')" id="subcard-${p.id}" style="
        border:${p.popular ? '2px solid #000' : '1px solid var(--border)'};
        border-radius:8px; padding:1.1rem; background:var(--surface); cursor:pointer;
        transition:all .15s; position:relative; text-align:center;">
        ${p.popular ? '<span class="badge badge-dark" style="position:absolute;top:0.5rem;right:0.5rem;font-size:0.6rem;">Popular</span>' : ''}
        <div style="font-size:0.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); margin-bottom:0.5rem;">${p.label}</div>
        <div style="font-size:1.6rem; font-weight:800; letter-spacing:-0.03em; margin-bottom:0.2rem;">$${p.priceUsd}</div>
        <div style="font-size:0.85rem; font-weight:600; margin-bottom:0.15rem;">${p.includedInterviews.toLocaleString()} Interviews</div>
        <div style="font-size:0.72rem; color:var(--text-muted); margin-bottom:0.5rem;">~$${cpi}/interview</div>
        ${p.savingsLabel ? `<div style="font-size:0.72rem; color:#16a34a; font-weight:600; margin-bottom:0.5rem;">${p.savingsLabel}</div>` : '<div style="height:1rem;"></div>'}
        <button class="btn btn-sm btn-outline" style="width:100%; font-size:0.75rem;" onclick="event.stopPropagation(); selectSubPlan('${p.id}')">
          Get Started
        </button>
      </div>`;
  }).join('');
}

window.selectSubPlan = function(planId) {
  billingCheckoutPlan = SUBSCRIPTION_PLANS.find(p => p.id === planId);
  // Highlight selected
  SUBSCRIPTION_PLANS.forEach(p => {
    const card = document.getElementById(`subcard-${p.id}`);
    if (card) {
      card.style.border = p.id === planId ? '2px solid #000' : (p.popular ? '2px solid #000' : '1px solid var(--border))');
      card.style.background = p.id === planId ? 'var(--surface-subtle)' : 'var(--surface)';
    }
  });
  openBillingCheckout('sub');
};

// ── Compare table ─────────────────────────────────────────────────────────
function renderSubCompare() {
  const tbody = document.getElementById('sub-compare-body');
  if (!tbody) return;
  tbody.innerHTML = SUBSCRIPTION_PLANS.map(p => {
    const cpi = (p.priceUsd / p.includedInterviews).toFixed(3);
    const saved = p.months > 1 ? `$${(p.months * 100 - p.priceUsd)}` : '—';
    return `<tr style="border-bottom:1px solid var(--border); ${p.popular ? 'background:var(--surface-subtle);' : ''}">
      <td style="padding:0.5rem;">
        <strong>${p.label}</strong>
        ${p.popular ? '<span class="badge badge-dark" style="margin-left:0.35rem; font-size:0.65rem;">Popular</span>' : ''}
      </td>
      <td style="text-align:center; padding:0.5rem;">${p.months} month${p.months > 1 ? 's' : ''}</td>
      <td style="text-align:right; padding:0.5rem; font-weight:700;">$${p.priceUsd}</td>
      <td style="text-align:right; padding:0.5rem;">${p.includedInterviews.toLocaleString()}</td>
      <td style="text-align:right; padding:0.5rem; ${p.months === 12 ? 'color:#16a34a; font-weight:700;' : ''}">$${cpi}</td>
      <td style="text-align:right; padding:0.5rem; color:#16a34a; font-weight:600;">${saved !== '—' ? saved + ' saved' : '—'}</td>
    </tr>`;
  }).join('');
}

// ── Inner tab switcher ────────────────────────────────────────────────────
window.switchBillingTab = function(tab) {
  ['ppu', 'sub', 'history'].forEach(t => {
    const btn = document.getElementById(`btab-${t}`);
    const content = document.getElementById(`btab-content-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (content) content.style.display = t === tab ? 'block' : 'none';
  });
};

// ── Load balance from API ─────────────────────────────────────────────────
async function loadBillingBalance() {
  try {
    const res = await apiRequest('/billing/balance');
    if (!res.ok) return;
    const data = await res.json();
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('billing-credits-remaining', (data.creditsRemaining || 0).toLocaleString());
    setEl('billing-plan-name', data.plan ? data.plan.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Free Trial');
    setEl('billing-plan-label', data.subscriptionPlan ? `${data.subscriptionPlan.label} Subscription` : 'Pay-as-you-go');
    if (data.subscriptionExpiresAt) {
      const exp = new Date(data.subscriptionExpiresAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
      setEl('billing-expiry-label', `Expires ${exp}`);
    }
  } catch (e) { /* silently fail */ }
}

// ── Load order history ────────────────────────────────────────────────────
window.loadBillingHistory = async function() {
  const listEl = document.getElementById('billing-history-list');
  if (!listEl) return;
  try {
    const res = await apiRequest('/billing/history');
    if (!res.ok) { listEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:2rem 0;">Sign in to view history.</p>'; return; }
    const data = await res.json();
    if (!data.orders || data.orders.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:2rem 0;">No orders yet. Purchase interviews or a plan to get started.</p>';
      return;
    }
    listEl.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">
        <thead>
          <tr style="border-bottom:1px solid var(--border);">
            <th style="text-align:left; padding:0.5rem; color:var(--text-muted); font-size:0.72rem; text-transform:uppercase;">Order ID</th>
            <th style="text-align:left; padding:0.5rem; color:var(--text-muted); font-size:0.72rem; text-transform:uppercase;">Type</th>
            <th style="text-align:right; padding:0.5rem; color:var(--text-muted); font-size:0.72rem; text-transform:uppercase;">Amount</th>
            <th style="text-align:right; padding:0.5rem; color:var(--text-muted); font-size:0.72rem; text-transform:uppercase;">Status</th>
            <th style="text-align:right; padding:0.5rem; color:var(--text-muted); font-size:0.72rem; text-transform:uppercase;">Date</th>
          </tr>
        </thead>
        <tbody>
          ${data.orders.map(o => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:0.5rem; color:var(--text-muted); font-size:0.72rem;">${o.id.substring(0, 14)}…</td>
              <td style="padding:0.5rem;">${o.type === 'pay_per_use' ? `${o.quantity} interviews (${o.duration_minutes}min)` : (o.plan_id ? o.plan_id.replace(/_/g,' ') : 'Subscription')}</td>
              <td style="text-align:right; padding:0.5rem; font-weight:700;">$${parseFloat(o.amount_usd).toFixed(2)}</td>
              <td style="text-align:right; padding:0.5rem;">
                <span class="badge ${o.status === 'paid' ? 'badge-dark' : 'badge-outline'}" style="font-size:0.65rem;">${o.status}</span>
              </td>
              <td style="text-align:right; padding:0.5rem; color:var(--text-muted);">${new Date(o.created_at).toLocaleDateString('en-IN')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    listEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:1rem 0;">Could not load order history.</p>';
  }
};

// ── Checkout modal ────────────────────────────────────────────────────────
window.openBillingCheckout = function(type) {
  billingCheckoutType = type;
  const modal = document.getElementById('billing-checkout-modal');
  const summary = document.getElementById('checkout-summary');
  if (!modal || !summary) return;

  if (type === 'ppu') {
    const qty = Math.max(1, parseInt(document.getElementById('ppu-qty')?.value) || 1);
    const tier = DURATION_TIERS.find(t => t.minutes === billingSelectedDuration);
    const freeInterviews = Math.floor(qty / 10);
    const billedFor = qty - freeInterviews;
    const total = (billedFor * tier.priceUsd).toFixed(2);

    summary.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;"><span style="color:var(--text-muted);">Duration</span><span>${tier.label}</span></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;"><span style="color:var(--text-muted);">Quantity</span><span>${qty} interviews</span></div>
      ${freeInterviews > 0 ? `<div style="display:flex; justify-content:space-between; margin-bottom:0.4rem; color:#16a34a;"><span>Free Bonus 🎁</span><span>+${freeInterviews}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between; border-top:1px solid var(--border); padding-top:0.55rem; margin-top:0.55rem; font-weight:800; font-size:0.9rem;"><span>Total</span><span>$${total}</span></div>`;
  } else {
    if (!billingCheckoutPlan) { alert('Please select a plan first'); return; }
    const p = billingCheckoutPlan;
    const cpi = (p.priceUsd / p.includedInterviews).toFixed(2);
    summary.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;"><span style="color:var(--text-muted);">Plan</span><span>${p.label}</span></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;"><span style="color:var(--text-muted);">Interviews Included</span><span>${p.includedInterviews.toLocaleString()}</span></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;"><span style="color:var(--text-muted);">Per Interview</span><span>~$${cpi}</span></div>
      ${p.savingsLabel ? `<div style="display:flex; justify-content:space-between; margin-bottom:0.4rem; color:#16a34a;"><span>You Save</span><span>${p.savingsLabel}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between; border-top:1px solid var(--border); padding-top:0.55rem; margin-top:0.55rem; font-weight:800; font-size:0.9rem;"><span>Total</span><span>$${p.priceUsd}</span></div>`;
  }
  modal.style.display = 'flex';
};

window.closeBillingModal = function() {
  const modal = document.getElementById('billing-checkout-modal');
  if (modal) modal.style.display = 'none';
};

window.confirmBillingPayment = async function() {
  const btn = document.getElementById('pay-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Processing…'; }

  await new Promise(r => setTimeout(r, 1800));

  closeBillingModal();
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle"></i> Pay Now'; }

  const credits = billingCheckoutType === 'ppu'
    ? Math.max(1, parseInt(document.getElementById('ppu-qty')?.value) || 1)
    : (billingCheckoutPlan?.includedInterviews || 0);

  alert(`✅ Payment confirmed! ${credits} interview credits added.`);
  loadBillingBalance();
};

// Card input formatting
window.fmtCard = function(el) {
  let v = el.value.replace(/\D/g,'').substring(0,16);
  el.value = v.replace(/(.{4})/g,'$1 ').trim();
};
window.fmtExp = function(el) {
  let v = el.value.replace(/\D/g,'').substring(0,4);
  if (v.length >= 2) v = v.substring(0,2) + ' / ' + v.substring(2);
  el.value = v;
};

// ── Hook into existing switchTab function ─────────────────────────────────
const _origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
  if (_origSwitchTab) _origSwitchTab(tab);
  if (tab === 'metrics') {
    initBillingTab();
  }
};

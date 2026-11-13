/**
 * LeetCode Catalog & Bulk Importer Service
 *
 * Manages up to 4,000+ coding problems in SQLite (`leetcode_problems`), organized
 * strictly by Topic Tags & Difficulty — NO hints and NO company-asked tags.
 *
 * Features:
 * 1. Auto-seeds rich built-in multi-topic DSA & SQL problems (both Solve & Fix-Bug modes).
 * 2. Fast transactional bulk importer (`importLeetCodeDataset`) & remote sync
 *    (`syncPublicLeetCodeBank`) supporting 3,500–4,100+ current LeetCode questions.
 * 3. Example & starter-code parser that cleans HTML and synthesizes buggy starter
 *    code for Fix-Error interview challenges.
 */

import { db } from '../db/database.js';

const BUILTIN_PROBLEMS = [
  {
    id: '1', frontend_id: 1, slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy',
    topics: ['Array', 'Hash Table'], category: 'Algorithms',
    description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume that each input would have exactly one solution, and you may not use the same element twice.',
    constraints: '2 <= nums.length <= 10^4; -10^9 <= nums[i] <= 10^9; Only one valid answer exists.',
    examples: [
      { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]' },
      { input: 'nums = [3,2,4], target = 6', output: '[1,2]' }
    ],
    function_name: { js: 'twoSum', py: 'two_sum', cpp: 'twoSum' },
    starter: {
      javascript: 'function twoSum(nums, target) {\n  // Write your solution here\n  return [];\n}',
      python: 'def two_sum(nums, target):\n    # Write your solution here\n    return []',
      cpp: '#include <vector>\n#include <unordered_map>\nusing namespace std;\n\nvector<int> twoSum(vector<int>& nums, int target) {\n    // Write your solution here\n    return {};\n}'
    },
    buggy_starter: {
      javascript: 'function twoSum(nums, target) {\n  // Fix the bugs in this broken implementation\n  const seen = {};\n  for (let i = 0; i < nums.length; i++) {\n    const diff = target + nums[i]; // BUG 1\n    if (seen[diff]) return [seen[diff], i]; // BUG 2: index 0 falsy check!\n    seen[nums[i]] = i;\n  }\n  return [];\n}',
      python: 'def two_sum(nums, target):\n    # Fix the bugs in this broken implementation\n    seen = {}\n    for i, n in enumerate(nums):\n        diff = target + n  # BUG 1\n        if seen.get(diff):  # BUG 2: skips index 0\n            return [seen[diff], i]\n        seen[n] = i\n    return []',
      cpp: '#include <vector>\n#include <unordered_map>\nusing namespace std;\n\nvector<int> twoSum(vector<int>& nums, int target) {\n    unordered_map<int, int> seen;\n    for (int i = 0; i <= nums.size(); i++) { // BUG: out-of-bounds\n        int diff = target + nums[i]; // BUG: wrong operator\n        if (seen.count(diff)) return {seen[diff], i};\n        seen[nums[i]] = i;\n    }\n    return {};\n}'
    },
    cases: [
      { id: 1, type: 'Public', input: { nums: [2, 7, 11, 15], target: 9 }, expected: [0, 1] },
      { id: 2, type: 'Hidden', input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
      { id: 3, type: 'Hidden', input: { nums: [3, 3], target: 6 }, expected: [0, 1] },
      { id: 4, type: 'Hidden Edge', input: { nums: [1, 5, 8, 12, 19, 23], target: 24 }, expected: [1, 4] }
    ]
  },
  {
    id: '20', frontend_id: 20, slug: 'valid-parentheses', title: 'Valid Parentheses', difficulty: 'Easy',
    topics: ['String', 'Stack'], category: 'Algorithms',
    description: 'Given a string s containing just the characters "(", ")", "{", "}", "[" and "]", determine if the input string is valid. Open brackets must be closed by the same type of brackets in the correct order.',
    constraints: '1 <= s.length <= 10^4; s consists of parentheses only "()[]{}".',
    examples: [{ input: 's = "()[]{}"', output: 'true' }, { input: 's = "(]"', output: 'false' }],
    function_name: { js: 'isValid', py: 'is_valid', cpp: 'isValid' },
    starter: {
      javascript: 'function isValid(s) {\n  // Write your solution here\n  return false;\n}',
      python: 'def is_valid(s):\n    # Write your solution here\n    return False',
      cpp: '#include <string>\n#include <stack>\nusing namespace std;\n\nbool isValid(string s) {\n    return false;\n}'
    },
    buggy_starter: {
      javascript: 'function isValid(s) {\n  // Fix the bugs in this stack validation\n  const stack = [];\n  const map = { ")": "(", "]": "[", "}": "{" };\n  for (const ch of s) {\n    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);\n    else if (stack.pop() === map[ch]) return false; // BUG: inverted condition & missing empty check at end\n  }\n  return true;\n}',
      python: 'def is_valid(s):\n    stack = []\n    pairs = {")": "(", "]": "[", "}": "{"}\n    for ch in s:\n        if ch in "([{":\n            stack.append(ch)\n        elif not stack or stack.pop() == pairs[ch]:  # BUG\n            return False\n    return True  # BUG: unclosed brackets'
    },
    cases: [
      { id: 1, type: 'Public', input: { s: '()[]{}' }, expected: true },
      { id: 2, type: 'Hidden', input: { s: '(]' }, expected: false },
      { id: 3, type: 'Hidden', input: { s: '([{}])' }, expected: true },
      { id: 4, type: 'Hidden Edge', input: { s: '(((' }, expected: false },
      { id: 5, type: 'Hidden Edge', input: { s: '' }, expected: true }
    ]
  },
  {
    id: '21', frontend_id: 21, slug: 'merge-two-sorted-lists', title: 'Merge Two Sorted Lists', difficulty: 'Easy',
    topics: ['Linked List', 'Recursion', 'Two Pointers'], category: 'Algorithms',
    description: 'You are given two sorted integer arrays representing linked lists list1 and list2. Merge the two lists into one sorted array/list and return it.',
    constraints: '0 <= list1.length, list2.length <= 50; -100 <= Node.val <= 100.',
    examples: [{ input: 'list1 = [1,2,4], list2 = [1,3,4]', output: '[1,1,2,3,4,4]' }],
    function_name: { js: 'mergeTwoLists', py: 'merge_two_lists', cpp: 'mergeTwoLists' },
    starter: {
      javascript: 'function mergeTwoLists(list1, list2) {\n  // Return sorted merged array\n  return [];\n}',
      python: 'def merge_two_lists(list1, list2):\n    return []',
      cpp: '#include <vector>\nusing namespace std;\n\nvector<int> mergeTwoLists(vector<int>& list1, vector<int>& list2) {\n    return {};\n}'
    },
    buggy_starter: {
      javascript: 'function mergeTwoLists(list1, list2) {\n  // Fix the bugs in this two-pointer merge\n  const out = [];\n  let i = 0, j = 0;\n  while (i < list1.length && j < list2.length) {\n    if (list1[i] > list2[j]) out.push(list1[i++]); // BUG: wrong comparison\n    else out.push(list2[j++]);\n  }\n  return out; // BUG: leftover tail elements missing\n}',
      python: 'def merge_two_lists(list1, list2):\n    out = []\n    i = j = 0\n    while i < len(list1) and j < len(list2):\n        if list1[i] > list2[j]:  # BUG\n            out.append(list1[i]); i += 1\n        else:\n            out.append(list2[j]); j += 1\n    return out  # BUG'
    },
    cases: [
      { id: 1, type: 'Public', input: { list1: [1, 2, 4], list2: [1, 3, 4] }, expected: [1, 1, 2, 3, 4, 4] },
      { id: 2, type: 'Hidden', input: { list1: [], list2: [0] }, expected: [0] },
      { id: 3, type: 'Hidden', input: { list1: [], list2: [] }, expected: [] },
      { id: 4, type: 'Hidden Edge', input: { list1: [5, 10, 15], list2: [2, 3, 20] }, expected: [2, 3, 5, 10, 15, 20] }
    ]
  },
  {
    id: '53', frontend_id: 53, slug: 'maximum-subarray', title: 'Maximum Subarray', difficulty: 'Medium',
    topics: ['Array', 'Divide and Conquer', 'Dynamic Programming'], category: 'Algorithms',
    description: 'Given an integer array nums, find the contiguous subarray with the largest sum, and return its sum.',
    constraints: '1 <= nums.length <= 10^5; -10^4 <= nums[i] <= 10^4.',
    examples: [{ input: 'nums = [-2,1,-3,4,-1,2,1,-5,4]', output: '6' }],
    function_name: { js: 'maxSubArray', py: 'max_sub_array', cpp: 'maxSubArray' },
    starter: {
      javascript: 'function maxSubArray(nums) {\n  return 0;\n}',
      python: 'def max_sub_array(nums):\n    return 0',
      cpp: '#include <vector>\nusing namespace std;\n\nint maxSubArray(vector<int>& nums) {\n    return 0;\n}'
    },
    buggy_starter: {
      javascript: 'function maxSubArray(nums) {\n  // Fix Kadane algorithm for all-negative arrays\n  let cur = 0, best = 0; // BUG: 0 fails when all elements are negative\n  for (const x of nums) {\n    cur = Math.max(0, cur + x); // BUG\n    best = Math.max(best, cur);\n  }\n  return best;\n}',
      python: 'def max_sub_array(nums):\n    cur = 0\n    best = 0  # BUG: fails on all-negative inputs\n    for x in nums:\n        cur = max(0, cur + x)  # BUG\n        best = max(best, cur)\n    return best'
    },
    cases: [
      { id: 1, type: 'Public', input: { nums: [-2, 1, -3, 4, -1, 2, 1, -5, 4] }, expected: 6 },
      { id: 2, type: 'Hidden', input: { nums: [1] }, expected: 1 },
      { id: 3, type: 'Hidden', input: { nums: [5, 4, -1, 7, 8] }, expected: 23 },
      { id: 4, type: 'Hidden Edge', input: { nums: [-5, -2, -8, -1] }, expected: -1 }
    ]
  },
  {
    id: '3', frontend_id: 3, slug: 'longest-substring-without-repeating-characters', title: 'Longest Substring Without Repeating Characters', difficulty: 'Medium',
    topics: ['Hash Table', 'String', 'Sliding Window'], category: 'Algorithms',
    description: 'Given a string s, find the length of the longest substring without repeating characters.',
    constraints: '0 <= s.length <= 5 * 10^4; s consists of English letters, digits, symbols and spaces.',
    examples: [{ input: 's = "abcabcbb"', output: '3' }, { input: 's = "pwwkew"', output: '3' }],
    function_name: { js: 'lengthOfLongestSubstring', py: 'length_of_longest_substring', cpp: 'lengthOfLongestSubstring' },
    starter: {
      javascript: 'function lengthOfLongestSubstring(s) {\n  return 0;\n}',
      python: 'def length_of_longest_substring(s):\n    return 0',
      cpp: '#include <string>\nusing namespace std;\n\nint lengthOfLongestSubstring(string s) {\n    return 0;\n}'
    },
    buggy_starter: {
      javascript: 'function lengthOfLongestSubstring(s) {\n  const last = {};\n  let left = 0, best = 0;\n  for (let r = 0; r < s.length; r++) {\n    if (last[s[r]] !== undefined) {\n      left = last[s[r]] + 1; // BUG: left can move backwards!\n    }\n    last[s[r]] = r;\n    best = Math.max(best, r - left); // BUG: missing + 1\n  }\n  return best;\n}',
      python: 'def length_of_longest_substring(s):\n    last = {}\n    left = best = 0\n    for r, ch in enumerate(s):\n        if ch in last:\n            left = last[ch] + 1  # BUG: left can jump backwards\n        last[ch] = r\n        best = max(best, r - left)  # BUG: off by 1\n    return best'
    },
    cases: [
      { id: 1, type: 'Public', input: { s: 'abcabcbb' }, expected: 3 },
      { id: 2, type: 'Hidden', input: { s: 'bbbbb' }, expected: 1 },
      { id: 3, type: 'Hidden', input: { s: 'pwwkew' }, expected: 3 },
      { id: 4, type: 'Hidden Edge', input: { s: '' }, expected: 0 },
      { id: 5, type: 'Hidden', input: { s: 'au' }, expected: 2 }
    ]
  },
  {
    id: '206', frontend_id: 206, slug: 'reverse-linked-list', title: 'Reverse Linked List', difficulty: 'Easy',
    topics: ['Linked List', 'Recursion'], category: 'Algorithms',
    description: 'Given the head of a singly linked list represented as an array, reverse the list and return the reversed list.',
    constraints: '0 <= n <= 5000; -5000 <= val <= 5000.',
    examples: [{ input: 'head = [1,2,3,4,5]', output: '[5,4,3,2,1]' }],
    function_name: { js: 'reverseList', py: 'reverse_list', cpp: 'reverseList' },
    starter: {
      javascript: 'function reverseList(head) {\n  return [];\n}',
      python: 'def reverse_list(head):\n    return []',
      cpp: '#include <vector>\nusing namespace std;\n\nvector<int> reverseList(vector<int>& head) {\n    return {};\n}'
    },
    buggy_starter: {
      javascript: 'function reverseList(head) {\n  const out = [...head];\n  for (let i = 0; i < out.length; i++) { // BUG: swaps twice back to original\n    const j = out.length - 1 - i;\n    [out[i], out[j]] = [out[j], out[i]];\n  }\n  return out;\n}',
      python: 'def reverse_list(head):\n    out = list(head)\n    for i in range(len(out)):  # BUG: reverses twice\n        j = len(out) - 1 - i\n        out[i], out[j] = out[j], out[i]\n    return out'
    },
    cases: [
      { id: 1, type: 'Public', input: { head: [1, 2, 3, 4, 5] }, expected: [5, 4, 3, 2, 1] },
      { id: 2, type: 'Hidden', input: { head: [1, 2] }, expected: [2, 1] },
      { id: 3, type: 'Hidden Edge', input: { head: [] }, expected: [] }
    ]
  },
  {
    id: '70', frontend_id: 70, slug: 'climbing-stairs', title: 'Climbing Stairs', difficulty: 'Easy',
    topics: ['Math', 'Dynamic Programming', 'Memoization'], category: 'Algorithms',
    description: 'You are climbing a staircase. It takes n steps to reach the top. Each time you can either climb 1 or 2 steps. In how many distinct ways can you climb to the top?',
    constraints: '1 <= n <= 45.',
    examples: [{ input: 'n = 2', output: '2' }, { input: 'n = 3', output: '3' }],
    function_name: { js: 'climbStairs', py: 'climb_stairs', cpp: 'climbStairs' },
    starter: {
      javascript: 'function climbStairs(n) {\n  return 0;\n}',
      python: 'def climb_stairs(n):\n    return 0',
      cpp: 'int climbStairs(int n) {\n    return 0;\n}'
    },
    buggy_starter: {
      javascript: 'function climbStairs(n) {\n  if (n <= 1) return 1;\n  let a = 1, b = 1;\n  for (let i = 2; i < n; i++) { // BUG: stops at n-1 instead of n\n    const next = a + b;\n    a = b; b = next;\n  }\n  return b;\n}',
      python: 'def climb_stairs(n):\n    if n <= 1:\n        return 1\n    a, b = 1, 1\n    for _ in range(2, n):  # BUG: off-by-one loop range\n        a, b = b, a + b\n    return b'
    },
    cases: [
      { id: 1, type: 'Public', input: { n: 2 }, expected: 2 },
      { id: 2, type: 'Hidden', input: { n: 3 }, expected: 3 },
      { id: 3, type: 'Hidden', input: { n: 5 }, expected: 8 },
      { id: 4, type: 'Hidden', input: { n: 8 }, expected: 34 }
    ]
  },
  {
    id: '121', frontend_id: 121, slug: 'best-time-to-buy-and-sell-stock', title: 'Best Time to Buy and Sell Stock', difficulty: 'Easy',
    topics: ['Array', 'Dynamic Programming', 'Greedy'], category: 'Algorithms',
    description: 'You are given an array prices where prices[i] is the price of a given stock on the ith day. Maximize your profit by choosing a single day to buy one stock and choosing a future day to sell. Return the maximum profit.',
    constraints: '1 <= prices.length <= 10^5; 0 <= prices[i] <= 10^4.',
    examples: [{ input: 'prices = [7,1,5,3,6,4]', output: '5' }],
    function_name: { js: 'maxProfit', py: 'max_profit', cpp: 'maxProfit' },
    starter: {
      javascript: 'function maxProfit(prices) {\n  return 0;\n}',
      python: 'def max_profit(prices):\n    return 0',
      cpp: '#include <vector>\nusing namespace std;\n\nint maxProfit(vector<int>& prices) {\n    return 0;\n}'
    },
    buggy_starter: {
      javascript: 'function maxProfit(prices) {\n  let minP = 0; // BUG: minP initialized to 0 blocks positive profits\n  let maxProf = 0;\n  for (const p of prices) {\n    minP = Math.min(minP, p);\n    maxProf = Math.max(maxProf, p - minP);\n  }\n  return maxProf;\n}',
      python: 'def max_profit(prices):\n    min_p = 0  # BUG\n    best = 0\n    for p in prices:\n        min_p = min(min_p, p)\n        best = max(best, p - min_p)\n    return best'
    },
    cases: [
      { id: 1, type: 'Public', input: { prices: [7, 1, 5, 3, 6, 4] }, expected: 5 },
      { id: 2, type: 'Hidden', input: { prices: [7, 6, 4, 3, 1] }, expected: 0 },
      { id: 3, type: 'Hidden', input: { prices: [2, 4, 1] }, expected: 2 },
      { id: 4, type: 'Hidden', input: { prices: [1, 2, 3, 4, 5] }, expected: 4 }
    ]
  },
  {
    id: '15', frontend_id: 15, slug: '3sum', title: '3Sum', difficulty: 'Medium',
    topics: ['Array', 'Two Pointers', 'Sorting'], category: 'Algorithms',
    description: 'Given an integer array nums, return all the unique triplets [nums[i], nums[j], nums[k]] such that i != j, i != k, j != k, and nums[i] + nums[j] + nums[k] == 0.',
    constraints: '3 <= nums.length <= 3000; -10^5 <= nums[i] <= 10^5.',
    examples: [{ input: 'nums = [-1,0,1,2,-1,-4]', output: '[[-1,-1,2],[-1,0,1]]' }],
    function_name: { js: 'threeSum', py: 'three_sum', cpp: 'threeSum' },
    starter: {
      javascript: 'function threeSum(nums) {\n  return [];\n}',
      python: 'def three_sum(nums):\n    return []',
      cpp: '#include <vector>\nusing namespace std;\n\nvector<vector<int>> threeSum(vector<int>& nums) {\n    return {};\n}'
    },
    buggy_starter: {
      javascript: 'function threeSum(nums) {\n  nums.sort(); // BUG: lexicographical JS sort breaks negatives!\n  const res = [];\n  for (let i = 0; i < nums.length - 2; i++) {\n    if (i > 0 && nums[i] === nums[i - 1]) continue;\n    let l = i + 1, r = nums.length - 1;\n    while (l < r) {\n      const sum = nums[i] + nums[l] + nums[r];\n      if (sum === 0) { res.push([nums[i], nums[l], nums[r]]); l++; r--; } // BUG: duplicate l/r values not skipped\n      else if (sum < 0) l++; else r--;\n    }\n  }\n  return res;\n}',
      python: 'def three_sum(nums):\n    nums.sort()\n    res = []\n    for i in range(len(nums) - 2):\n        if i > 0 and nums[i] == nums[i - 1]: continue\n        l, r = i + 1, len(nums) - 1\n        while l < r:\n            s = nums[i] + nums[l] + nums[r]\n            if s == 0:\n                res.append([nums[i], nums[l], nums[r]])\n                l += 1; r -= 1  # BUG: skips duplicate check\n            elif s < 0: l += 1\n            else: r -= 1\n    return res'
    },
    cases: [
      { id: 1, type: 'Public', input: { nums: [-1, 0, 1, 2, -1, -4] }, expected: [[-1, -1, 2], [-1, 0, 1]] },
      { id: 2, type: 'Hidden', input: { nums: [0, 1, 1] }, expected: [] },
      { id: 3, type: 'Hidden', input: { nums: [0, 0, 0] }, expected: [[0, 0, 0]] }
    ]
  },
  {
    id: '200', frontend_id: 200, slug: 'number-of-islands', title: 'Number of Islands', difficulty: 'Medium',
    topics: ['Array', 'Depth-First Search', 'Breadth-First Search', 'Union Find', 'Matrix'], category: 'Algorithms',
    description: 'Given an m x n 2D binary grid which represents a map of "1"s (land) and "0"s (water), return the number of islands.',
    constraints: '1 <= m, n <= 300; grid[i][j] is "0" or "1".',
    examples: [{ input: 'grid = [["1","1","0"],["0","1","0"],["0","0","1"]]', output: '2' }],
    function_name: { js: 'numIslands', py: 'num_islands', cpp: 'numIslands' },
    starter: {
      javascript: 'function numIslands(grid) {\n  return 0;\n}',
      python: 'def num_islands(grid):\n    return 0',
      cpp: '#include <vector>\nusing namespace std;\n\nint numIslands(vector<vector<char>>& grid) {\n    return 0;\n}'
    },
    buggy_starter: {
      javascript: 'function numIslands(grid) {\n  let count = 0;\n  const R = grid.length, C = grid[0]?.length || 0;\n  function dfs(r, c) {\n    if (r < 0 || c < 0 || r >= R || c >= C || grid[r][c] === "0") return;\n    // BUG: forgets to mark visited cell as "0" (causes infinite recursion)\n    dfs(r + 1, c); dfs(r - 1, c); dfs(r, c + 1); dfs(r, c - 1);\n  }\n  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (grid[r][c] === "1") { count++; dfs(r, c); }\n  return count;\n}',
      python: 'def num_islands(grid):\n    if not grid: return 0\n    R, C = len(grid), len(grid[0])\n    def dfs(r, c):\n        if r < 0 or c < 0 or r >= R or c >= C or grid[r][c] == "0": return\n        # BUG: forgot to mark grid[r][c] = "0"\n        dfs(r+1,c); dfs(r-1,c); dfs(r,c+1); dfs(r,c-1)\n    cnt = 0\n    for r in range(R):\n        for c in range(C):\n            if grid[r][c] == "1":\n                cnt += 1\n                dfs(r, c)\n    return cnt'
    },
    cases: [
      { id: 1, type: 'Public', input: { grid: [['1', '1'], ['0', '1']] }, expected: 1 },
      { id: 2, type: 'Hidden', input: { grid: [['0', '0'], ['0', '0']] }, expected: 0 },
      { id: 3, type: 'Hidden', input: { grid: [['1', '0', '1'], ['0', '1', '0'], ['1', '0', '1']] }, expected: 5 }
    ]
  },
  // Additional core topic coverage
  {
    id: '125', frontend_id: 125, slug: 'valid-palindrome', title: 'Valid Palindrome', difficulty: 'Easy',
    topics: ['Two Pointers', 'String'], category: 'Algorithms',
    description: 'Given a string s, convert all uppercase letters to lowercase and remove all non-alphanumeric characters, then return true if it is a palindrome, or false otherwise.',
    constraints: '1 <= s.length <= 2 * 10^5.',
    examples: [{ input: 's = "A man, a plan, a canal: Panama"', output: 'true' }],
    function_name: { js: 'isPalindrome', py: 'is_palindrome' },
    starter: {
      javascript: 'function isPalindrome(s) {\n  return false;\n}',
      python: 'def is_palindrome(s):\n    return False'
    },
    buggy_starter: {
      javascript: 'function isPalindrome(s) {\n  // BUG: forgot case-folding and non-alphanumeric cleanup\n  let l = 0, r = s.length - 1;\n  while (l < r) { if (s[l] !== s[r]) return false; l++; r--; }\n  return true;\n}',
      python: 'def is_palindrome(s):\n    return s == s[::-1]  # BUG: fails punctuation & uppercase'
    },
    cases: [
      { id: 1, type: 'Public', input: { s: 'A man, a plan, a canal: Panama' }, expected: true },
      { id: 2, type: 'Hidden', input: { s: 'race a car' }, expected: false },
      { id: 3, type: 'Hidden Edge', input: { s: ' ' }, expected: true }
    ]
  },
  {
    id: '242', frontend_id: 242, slug: 'valid-anagram', title: 'Valid Anagram', difficulty: 'Easy',
    topics: ['Hash Table', 'String', 'Sorting'], category: 'Algorithms',
    description: 'Given two strings s and t, return true if t is an anagram of s, and false otherwise.',
    constraints: '1 <= s.length, t.length <= 5 * 10^4.',
    examples: [{ input: 's = "anagram", t = "nagaram"', output: 'true' }],
    function_name: { js: 'isAnagram', py: 'is_anagram' },
    starter: {
      javascript: 'function isAnagram(s, t) {\n  return false;\n}',
      python: 'def is_anagram(s, t):\n    return False'
    },
    buggy_starter: {
      javascript: 'function isAnagram(s, t) {\n  const set = new Set(s); // BUG: ignores duplicate counts & length mismatch\n  for (const ch of t) if (!set.has(ch)) return false;\n  return true;\n}',
      python: 'def is_anagram(s, t):\n    return set(s) == set(t)  # BUG: ignores character frequencies'
    },
    cases: [
      { id: 1, type: 'Public', input: { s: 'anagram', t: 'nagaram' }, expected: true },
      { id: 2, type: 'Hidden', input: { s: 'rat', t: 'car' }, expected: false },
      { id: 3, type: 'Hidden Edge', input: { s: 'aacc', t: 'ccac' }, expected: false }
    ]
  },
  {
    id: '704', frontend_id: 704, slug: 'binary-search', title: 'Binary Search', difficulty: 'Easy',
    topics: ['Array', 'Binary Search'], category: 'Algorithms',
    description: 'Given an array of integers nums sorted in ascending order and an integer target, search target in nums. If target exists return its index, otherwise return -1 in O(log n) time.',
    constraints: '1 <= nums.length <= 10^4; all integers in nums are unique.',
    examples: [{ input: 'nums = [-1,0,3,5,9,12], target = 9', output: '4' }],
    function_name: { js: 'search', py: 'search' },
    starter: {
      javascript: 'function search(nums, target) {\n  return -1;\n}',
      python: 'def search(nums, target):\n    return -1'
    },
    buggy_starter: {
      javascript: 'function search(nums, target) {\n  let l = 0, r = nums.length - 1;\n  while (l < r) { // BUG: skips check when l === r\n    const mid = Math.floor((l + r) / 2);\n    if (nums[mid] === target) return mid;\n    if (nums[mid] < target) l = mid; // BUG: infinite loop when r = l + 1\n    else r = mid - 1;\n  }\n  return -1;\n}',
      python: 'def search(nums, target):\n    l, r = 0, len(nums) - 1\n    while l < r:  # BUG\n        mid = (l + r) // 2\n        if nums[mid] == target: return mid\n        if nums[mid] < target: l = mid  # BUG\n        else: r = mid - 1\n    return -1'
    },
    cases: [
      { id: 1, type: 'Public', input: { nums: [-1, 0, 3, 5, 9, 12], target: 9 }, expected: 4 },
      { id: 2, type: 'Hidden', input: { nums: [-1, 0, 3, 5, 9, 12], target: 2 }, expected: -1 },
      { id: 3, type: 'Hidden Edge', input: { nums: [5], target: 5 }, expected: 0 }
    ]
  },
  {
    id: '217', frontend_id: 217, slug: 'contains-duplicate', title: 'Contains Duplicate', difficulty: 'Easy',
    topics: ['Array', 'Hash Table', 'Sorting'], category: 'Algorithms',
    description: 'Given an integer array nums, return true if any value appears at least twice in the array, and return false if every element is distinct.',
    constraints: '1 <= nums.length <= 10^5.',
    examples: [{ input: 'nums = [1,2,3,1]', output: 'true' }],
    function_name: { js: 'containsDuplicate', py: 'contains_duplicate' },
    starter: {
      javascript: 'function containsDuplicate(nums) {\n  return false;\n}',
      python: 'def contains_duplicate(nums):\n    return False'
    },
    buggy_starter: {
      javascript: 'function containsDuplicate(nums) {\n  for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1]) return true; // BUG: assumes sorted\n  return false;\n}',
      python: 'def contains_duplicate(nums):\n    return len(set(nums)) == len(nums)  # BUG: inverted condition'
    },
    cases: [
      { id: 1, type: 'Public', input: { nums: [1, 2, 3, 1] }, expected: true },
      { id: 2, type: 'Hidden', input: { nums: [1, 2, 3, 4] }, expected: false },
      { id: 3, type: 'Hidden', input: { nums: [1, 1, 1, 3, 3, 4, 3, 2, 4, 2] }, expected: true }
    ]
  },
  {
    id: '198', frontend_id: 198, slug: 'house-robber', title: 'House Robber', difficulty: 'Medium',
    topics: ['Array', 'Dynamic Programming'], category: 'Algorithms',
    description: 'Given an integer array nums representing the amount of money of each house, return the maximum amount of money you can rob tonight without alerting the police (cannot rob adjacent houses).',
    constraints: '1 <= nums.length <= 100; 0 <= nums[i] <= 400.',
    examples: [{ input: 'nums = [1,2,3,1]', output: '4' }],
    function_name: { js: 'rob', py: 'rob' },
    starter: {
      javascript: 'function rob(nums) {\n  return 0;\n}',
      python: 'def rob(nums):\n    return 0'
    },
    buggy_starter: {
      javascript: 'function rob(nums) {\n  let odd = 0, even = 0;\n  for (let i = 0; i < nums.length; i++) { if (i % 2 === 0) even += nums[i]; else odd += nums[i]; }\n  return Math.max(odd, even); // BUG: misses skipping 2 houses like [2,1,1,2]\n}',
      python: 'def rob(nums):\n    return max(sum(nums[0::2]), sum(nums[1::2]))  # BUG: fails on [2, 1, 1, 2]'
    },
    cases: [
      { id: 1, type: 'Public', input: { nums: [1, 2, 3, 1] }, expected: 4 },
      { id: 2, type: 'Hidden', input: { nums: [2, 7, 9, 3, 1] }, expected: 12 },
      { id: 3, type: 'Hidden Edge', input: { nums: [2, 1, 1, 2] }, expected: 4 }
    ]
  },
  {
    id: '322', frontend_id: 322, slug: 'coin-change', title: 'Coin Change', difficulty: 'Medium',
    topics: ['Array', 'Dynamic Programming', 'Breadth-First Search'], category: 'Algorithms',
    description: 'You are given an integer array coins representing coins of different denominations and an integer amount. Return the fewest number of coins needed to make up that amount, or -1 if impossible.',
    constraints: '1 <= coins.length <= 12; 0 <= amount <= 10^4.',
    examples: [{ input: 'coins = [1,2,5], amount = 11', output: '3' }],
    function_name: { js: 'coinChange', py: 'coin_change' },
    starter: {
      javascript: 'function coinChange(coins, amount) {\n  return -1;\n}',
      python: 'def coin_change(coins, amount):\n    return -1'
    },
    buggy_starter: {
      javascript: 'function coinChange(coins, amount) {\n  // BUG: greedy fails for [1,3,4], amount = 6 (greedy picks 4+1+1=3 instead of 3+3=2)\n  coins.sort((a, b) => b - a);\n  let cnt = 0;\n  for (const c of coins) { cnt += Math.floor(amount / c); amount %= c; }\n  return amount === 0 ? cnt : -1;\n}',
      python: 'def coin_change(coins, amount):\n    coins.sort(reverse=True)\n    cnt = 0\n    for c in coins:\n        cnt += amount // c\n        amount %= c\n    return cnt if amount == 0 else -1  # BUG: greedy fails [1,3,4], 6'
    },
    cases: [
      { id: 1, type: 'Public', input: { coins: [1, 2, 5], amount: 11 }, expected: 3 },
      { id: 2, type: 'Hidden', input: { coins: [2], amount: 3 }, expected: -1 },
      { id: 3, type: 'Hidden Edge', input: { coins: [1, 3, 4], amount: 6 }, expected: 2 }
    ]
  },
  {
    id: '56', frontend_id: 56, slug: 'merge-intervals', title: 'Merge Intervals', difficulty: 'Medium',
    topics: ['Array', 'Sorting', 'Intervals'], category: 'Algorithms',
    description: 'Given an array of intervals where intervals[i] = [start_i, end_i], merge all overlapping intervals and return an array of the non-overlapping intervals sorted by start.',
    constraints: '1 <= intervals.length <= 10^4; intervals[i].length == 2.',
    examples: [{ input: 'intervals = [[1,3],[2,6],[8,10],[15,18]]', output: '[[1,6],[8,10],[15,18]]' }],
    function_name: { js: 'mergeIntervals', py: 'merge_intervals' },
    starter: {
      javascript: 'function mergeIntervals(intervals) {\n  return [];\n}',
      python: 'def merge_intervals(intervals):\n    return []'
    },
    buggy_starter: {
      javascript: 'function mergeIntervals(intervals) {\n  // BUG: missing sort before merge and overwrites end instead of max(end)\n  const res = [intervals[0]];\n  for (let i = 1; i < intervals.length; i++) {\n    const last = res[res.length - 1];\n    if (intervals[i][0] <= last[1]) last[1] = intervals[i][1]; // BUG: shrinks if enclosed\n    else res.push(intervals[i]);\n  }\n  return res;\n}',
      python: 'def merge_intervals(intervals):\n    res = [list(intervals[0])]\n    for s, e in intervals[1:]:\n        if s <= res[-1][1]:\n            res[-1][1] = e  # BUG: unsorted & ignores max\n        else:\n            res.append([s, e])\n    return res'
    },
    cases: [
      { id: 1, type: 'Public', input: { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]] }, expected: [[1, 6], [8, 10], [15, 18]] },
      { id: 2, type: 'Hidden', input: { intervals: [[1, 4], [4, 5]] }, expected: [[1, 5]] },
      { id: 3, type: 'Hidden Edge', input: { intervals: [[1, 4], [2, 3]] }, expected: [[1, 4]] }
    ]
  },
  {
    id: '215', frontend_id: 215, slug: 'kth-largest-element-in-an-array', title: 'Kth Largest Element in an Array', difficulty: 'Medium',
    topics: ['Array', 'Divide and Conquer', 'Sorting', 'Heap (Priority Queue)', 'Quickselect'], category: 'Algorithms',
    description: 'Given an integer array nums and an integer k, return the kth largest element in the array.',
    constraints: '1 <= k <= nums.length <= 10^5.',
    examples: [{ input: 'nums = [3,2,1,5,6,4], k = 2', output: '5' }],
    function_name: { js: 'findKthLargest', py: 'find_kth_largest' },
    starter: {
      javascript: 'function findKthLargest(nums, k) {\n  return 0;\n}',
      python: 'def find_kth_largest(nums, k):\n    return 0'
    },
    buggy_starter: {
      javascript: 'function findKthLargest(nums, k) {\n  return [...nums].sort((a, b) => a - b)[k - 1]; // BUG: returns kth SMALLEST instead of largest\n}',
      python: 'def find_kth_largest(nums, k):\n    return sorted(nums)[k - 1]  # BUG: kth smallest'
    },
    cases: [
      { id: 1, type: 'Public', input: { nums: [3, 2, 1, 5, 6, 4], k: 2 }, expected: 5 },
      { id: 2, type: 'Hidden', input: { nums: [3, 2, 3, 1, 2, 4, 5, 5, 6], k: 4 }, expected: 4 }
    ]
  },
  {
    id: '136', frontend_id: 136, slug: 'single-number', title: 'Single Number', difficulty: 'Easy',
    topics: ['Array', 'Bit Manipulation'], category: 'Algorithms',
    description: 'Given a non-empty array of integers nums, every element appears twice except for one. Find that single one in linear runtime and constant extra space.',
    constraints: '1 <= nums.length <= 3 * 10^4.',
    examples: [{ input: 'nums = [4,1,2,1,2]', output: '4' }],
    function_name: { js: 'singleNumber', py: 'single_number' },
    starter: {
      javascript: 'function singleNumber(nums) {\n  return 0;\n}',
      python: 'def single_number(nums):\n    return 0'
    },
    buggy_starter: {
      javascript: 'function singleNumber(nums) {\n  let ans = 0;\n  for (const x of nums) ans &= x; // BUG: uses AND instead of XOR\n  return ans;\n}',
      python: 'def single_number(nums):\n    ans = 0\n    for x in nums: ans &= x  # BUG\n    return ans'
    },
    cases: [
      { id: 1, type: 'Public', input: { nums: [2, 2, 1] }, expected: 1 },
      { id: 2, type: 'Hidden', input: { nums: [4, 1, 2, 1, 2] }, expected: 4 }
    ]
  },
  {
    id: '78', frontend_id: 78, slug: 'subsets', title: 'Subsets', difficulty: 'Medium',
    topics: ['Array', 'Backtracking', 'Bit Manipulation'], category: 'Algorithms',
    description: 'Given an integer array nums of unique elements, return all possible subsets (the power set). The solution set must not contain duplicate subsets.',
    constraints: '1 <= nums.length <= 10.',
    examples: [{ input: 'nums = [1,2,3]', output: '[[],[1],[2],[1,2],[3],[1,3],[2,3],[1,2,3]]' }],
    function_name: { js: 'subsets', py: 'subsets' },
    starter: {
      javascript: 'function subsets(nums) {\n  return [];\n}',
      python: 'def subsets(nums):\n    return []'
    },
    buggy_starter: {
      javascript: 'function subsets(nums) {\n  const res = [];\n  const cur = [];\n  function bt(i) {\n    if (i === nums.length) { res.push(cur); return; } // BUG: pushes mutable reference cur instead of [...cur]\n    bt(i + 1);\n    cur.push(nums[i]); bt(i + 1); cur.pop();\n  }\n  bt(0);\n  return res;\n}',
      python: 'def subsets(nums):\n    res, cur = [], []\n    def bt(i):\n        if i == len(nums):\n            res.append(cur)  # BUG: reference alias\n            return\n        bt(i + 1)\n        cur.append(nums[i]); bt(i + 1); cur.pop()\n    bt(0)\n    return res'
    },
    cases: [
      { id: 1, type: 'Public', input: { nums: [1, 2] }, expected: [[], [1], [2], [1, 2]] },
      { id: 2, type: 'Hidden', input: { nums: [0] }, expected: [[], [0]] }
    ]
  },
  {
    id: '207', frontend_id: 207, slug: 'course-schedule', title: 'Course Schedule', difficulty: 'Medium',
    topics: ['Depth-First Search', 'Breadth-First Search', 'Graph', 'Topological Sort'], category: 'Algorithms',
    description: 'There are numCourses courses labeled 0 to numCourses - 1. Given prerequisites[i] = [a, b] meaning you must take b before a, return true if you can finish all courses.',
    constraints: '1 <= numCourses <= 2000; 0 <= prerequisites.length <= 5000.',
    examples: [{ input: 'numCourses = 2, prerequisites = [[1,0]]', output: 'true' }],
    function_name: { js: 'canFinish', py: 'can_finish' },
    starter: {
      javascript: 'function canFinish(numCourses, prerequisites) {\n  return false;\n}',
      python: 'def can_finish(numCourses, prerequisites):\n    return False'
    },
    buggy_starter: {
      javascript: 'function canFinish(numCourses, prerequisites) {\n  // BUG: treats directed cycle check incorrectly without visited vs visiting state\n  return prerequisites.length < numCourses;\n}',
      python: 'def can_finish(numCourses, prerequisites):\n    return len(prerequisites) < numCourses  # BUG'
    },
    cases: [
      { id: 1, type: 'Public', input: { numCourses: 2, prerequisites: [[1, 0]] }, expected: true },
      { id: 2, type: 'Hidden', input: { numCourses: 2, prerequisites: [[1, 0], [0, 1]] }, expected: false },
      { id: 3, type: 'Hidden', input: { numCourses: 4, prerequisites: [[1, 0], [2, 1], [3, 2]] }, expected: true }
    ]
  },
  {
    id: 'sql_175', frontend_id: 175, slug: 'combine-employee-departments', title: 'Department Top Earners (SQL)', difficulty: 'Easy',
    topics: ['Database', 'SQL'], category: 'Database',
    description: 'Write a SQL query against tables `employees(id, name, salary, department_id)` and `departments(id, name)` to list employees earning > 125000 sorted by salary DESC with columns `name` and `salary`.',
    constraints: 'Use standard SELECT syntax on employees / departments tables.',
    examples: [{ input: 'Tables: employees, departments', output: 'Alice (145000), Diana (135000)' }],
    function_name: { sql: 'SELECT' },
    starter: {
      sql: '-- Write your SQL query below\nSELECT name, salary FROM employees;'
    },
    buggy_starter: {
      sql: '-- Fix the bugs in this SQL query (wrong filter & sort order)\nSELECT name, salary FROM employees WHERE salary < 125000 ORDER BY salary ASC;'
    },
    cases: [
      { id: 1, type: 'SQL Execution', input: { tables: ['employees', 'departments'] }, expected: [{ name: 'Alice', salary: 145000 }, { name: 'Diana', salary: 135000 }] }
    ]
  }
];

function stripHtmlToText(html = '') {
  return String(html || '')
    .replace(/<pre[^>]*>/gi, '\n')
    .replace(/<\/pre>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractConstraintsAndExamples(plainText = '') {
  let description = plainText;
  let constraints = '';
  const examples = [];

  const constraintIdx = plainText.search(/\bConstraints:\s*/i);
  if (constraintIdx >= 0) {
    constraints = plainText.slice(constraintIdx).replace(/^Constraints:\s*/i, '').trim();
    description = plainText.slice(0, constraintIdx).trim();
  }

  const exampleRegex = /Example\s*\d*:\s*([\s\S]*?)(?=Example\s*\d*:|Constraints:|$)/gi;
  let match;
  while ((match = exampleRegex.exec(plainText)) !== null && examples.length < 3) {
    const block = match[1].trim();
    const inMatch = /Input:\s*([^\n]+)/i.exec(block);
    const outMatch = /Output:\s*([^\n]+)/i.exec(block);
    if (inMatch || outMatch) {
      examples.push({
        input: inMatch ? inMatch[1].trim() : block.slice(0, 140),
        output: outMatch ? outMatch[1].trim() : ''
      });
    }
  }

  return { description: description || plainText, constraints, examples };
}

function detectFunctionNames(starter = {}) {
  const fn = {};
  if (starter.javascript) {
    const m = /(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*function|function\s+([A-Za-z_]\w*)\s*\(/.exec(starter.javascript);
    if (m) fn.js = m[1] || m[2];
  }
  if (starter.python) {
    const m = /def\s+([A-Za-z_]\w*)\s*\((?!self\b)/.exec(starter.python) || /def\s+([A-Za-z_]\w*)\s*\(self/.exec(starter.python);
    if (m) fn.py = m[1];
  }
  return fn;
}

function buildBuggyFromStarter(starter = {}) {
  const buggy = {};
  if (starter.javascript) {
    buggy.javascript = `${starter.javascript}\n// BUG-FIX CHALLENGE: Identify edge-case bugs or implement the broken logic above.`;
  }
  if (starter.python) {
    buggy.python = `${starter.python}\n# BUG-FIX CHALLENGE: Fix any boundary / return errors in this routine.`;
  }
  if (starter.cpp) {
    buggy.cpp = `${starter.cpp}\n// BUG-FIX CHALLENGE: Fix memory / boundary / return errors above.`;
  }
  if (starter.sql) {
    buggy.sql = `${starter.sql}\n-- BUG-FIX CHALLENGE: Fix filter / join / ordering logic.`;
  }
  return buggy;
}

function parseExampleCases(examples = []) {
  const cases = [];
  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    try {
      const inputObj = {};
      const parts = String(ex.input || '').split(/,\s*(?=[A-Za-z_]\w*\s*=)/);
      for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq > 0) {
          const k = p.slice(0, eq).trim();
          const rawV = p.slice(eq + 1).trim();
          try {
            inputObj[k] = JSON.parse(rawV.replace(/'/g, '"'));
          } catch {
            inputObj[k] = rawV;
          }
        }
      }
      let expectedVal = ex.output;
      try {
        expectedVal = JSON.parse(String(ex.output || '').replace(/'/g, '"'));
      } catch {
        if (String(ex.output).trim() === 'true') expectedVal = true;
        else if (String(ex.output).trim() === 'false') expectedVal = false;
      }
      if (Object.keys(inputObj).length > 0 && ex.output !== '') {
        cases.push({ id: i + 1, type: i === 0 ? 'Public' : 'Hidden', input: inputObj, expected: expectedVal });
      }
    } catch {
      // Ignore unparseable custom formats
    }
  }
  return cases;
}

/**
 * Normalize raw problem records from LeetCode GraphQL, GitHub datasets, or pied API.
 * Explicitly strips `hints` and `companyTags`.
 */
export function normalizeRawLeetCodeItem(raw) {
  const q = raw?.data?.question || raw;
  if (!q || !q.title) return null;

  const frontendId = parseInt(q.questionFrontendId || q.frontend_id || q.id, 10);
  if (!Number.isFinite(frontendId)) return null;

  const slug = String(
    q.titleSlug || q.title_slug || q.slug || q.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  );
  const id = String(q.id && String(q.id).startsWith('sql_') ? q.id : frontendId);
  const difficultyRaw = String(q.difficulty || 'Medium');
  const difficulty = ['Easy', 'Medium', 'Hard'].includes(difficultyRaw) ? difficultyRaw : 'Medium';

  let topics = [];
  if (Array.isArray(q.topicTags)) {
    topics = q.topicTags.map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
  } else if (Array.isArray(q.topic_tags)) {
    topics = q.topic_tags.map(String).filter(Boolean);
  } else if (Array.isArray(q.topics)) {
    topics = q.topics.map(String).filter(Boolean);
  }

  const plain = q.content ? stripHtmlToText(q.content) : String(q.description || '');
  const parsed = extractConstraintsAndExamples(plain);
  const finalExamples = Array.isArray(q.examples) && q.examples.length > 0 ? q.examples : parsed.examples;
  const finalConstraints = q.constraints || parsed.constraints || '';
  const finalDescription = parsed.description || `Solve LeetCode #${frontendId}: ${q.title} (${difficulty}).`;

  const starter = {};
  if (Array.isArray(q.codeSnippets)) {
    for (const snip of q.codeSnippets) {
      const langSlug = String(snip.langSlug || snip.lang || '').toLowerCase();
      if (langSlug === 'javascript') starter.javascript = snip.code;
      else if (langSlug === 'python3' || langSlug === 'python') starter.python = starter.python || snip.code;
      else if (langSlug === 'cpp' || langSlug === 'c++') starter.cpp = snip.code;
      else if (langSlug === 'mysql' || langSlug === 'postgresql') starter.sql = starter.sql || snip.code;
    }
  } else if (q.starter && typeof q.starter === 'object') {
    Object.assign(starter, q.starter);
  }

  const fnNames = q.function_name || detectFunctionNames(starter);
  const cases = Array.isArray(q.cases) && q.cases.length > 0 ? q.cases : parseExampleCases(finalExamples);
  const buggy = q.buggy_starter && typeof q.buggy_starter === 'object' ? q.buggy_starter : buildBuggyFromStarter(starter);

  return {
    id,
    frontend_id: frontendId,
    slug,
    title: String(q.title).trim(),
    difficulty,
    topics,
    category: String(q.categoryTitle || q.category || 'Algorithms'),
    description: finalDescription,
    constraints: finalConstraints,
    examples: finalExamples,
    starter,
    buggy_starter: buggy,
    test_cases: cases,
    function_name: fnNames,
    time_limit_ms: Number(q.time_limit_ms) || 2000,
    memory_limit_mb: Number(q.memory_limit_mb) || 256
  };
}

/**
 * Batch insert / upsert normalized problems inside one SQLite transaction.
 * Takes <0.5s for 3,500+ items.
 */
export function importLeetCodeDataset(rawItems = [], sourceLabel = 'imported') {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { imported: 0, skipped: 0, total: getTotalProblemCount() };
  }

  const upsert = db.prepare(`
    INSERT INTO leetcode_problems (
      id, frontend_id, slug, title, difficulty, topics_json, category,
      description, constraints, examples_json, starter_json, buggy_starter_json,
      test_cases_json, function_name_json, time_limit_ms, memory_limit_mb, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      difficulty = excluded.difficulty,
      topics_json = excluded.topics_json,
      category = excluded.category,
      description = CASE WHEN length(excluded.description) > 40 THEN excluded.description ELSE leetcode_problems.description END,
      constraints = CASE WHEN length(excluded.constraints) > 0 THEN excluded.constraints ELSE leetcode_problems.constraints END,
      examples_json = CASE WHEN excluded.examples_json != '[]' THEN excluded.examples_json ELSE leetcode_problems.examples_json END,
      starter_json = CASE WHEN excluded.starter_json != '{}' THEN excluded.starter_json ELSE leetcode_problems.starter_json END,
      buggy_starter_json = CASE WHEN leetcode_problems.buggy_starter_json = '{}' THEN excluded.buggy_starter_json ELSE leetcode_problems.buggy_starter_json END,
      test_cases_json = CASE WHEN leetcode_problems.test_cases_json = '[]' THEN excluded.test_cases_json ELSE leetcode_problems.test_cases_json END,
      function_name_json = CASE WHEN leetcode_problems.function_name_json = '{}' THEN excluded.function_name_json ELSE leetcode_problems.function_name_json END,
      source = excluded.source
  `);

  let imported = 0;
  let skipped = 0;
  const runTx = db.transaction((items) => {
    for (const raw of items) {
      const p = normalizeRawLeetCodeItem(raw);
      if (!p) {
        skipped++;
        continue;
      }
      try {
        upsert.run(
          p.id,
          p.frontend_id,
          p.slug,
          p.title,
          p.difficulty,
          JSON.stringify(p.topics || []),
          p.category || 'Algorithms',
          p.description,
          p.constraints || '',
          JSON.stringify(p.examples || []),
          JSON.stringify(p.starter || {}),
          JSON.stringify(p.buggy_starter || {}),
          JSON.stringify(p.test_cases || []),
          JSON.stringify(p.function_name || {}),
          p.time_limit_ms || 2000,
          p.memory_limit_mb || 256,
          sourceLabel
        );
        imported++;
      } catch {
        skipped++;
      }
    }
  });

  runTx(rawItems);
  return { imported, skipped, total: getTotalProblemCount() };
}

export function getTotalProblemCount() {
  try {
    return db.prepare('SELECT COUNT(*) as c FROM leetcode_problems').get()?.c || 0;
  } catch {
    return 0;
  }
}

export function ensureBuiltInLeetCodeSeeded() {
  try {
    const insertIgnore = db.prepare(`
      INSERT OR IGNORE INTO leetcode_problems (
        id, frontend_id, slug, title, difficulty, topics_json, category,
        description, constraints, examples_json, starter_json, buggy_starter_json,
        test_cases_json, function_name_json, time_limit_ms, memory_limit_mb, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2000, 256, 'builtin')
    `);
    const tx = db.transaction(() => {
      for (const p of BUILTIN_PROBLEMS) {
        insertIgnore.run(
          p.id,
          p.frontend_id,
          p.slug,
          p.title,
          p.difficulty,
          JSON.stringify(p.topics),
          p.category,
          p.description,
          p.constraints,
          JSON.stringify(p.examples),
          JSON.stringify(p.starter),
          JSON.stringify(p.buggy_starter || {}),
          JSON.stringify(p.cases),
          JSON.stringify(p.function_name || {})
        );
      }
    });
    tx();
  } catch (err) {
    console.warn('[LeetCodeCatalog] Seed notice:', err.message);
  }
}

/**
 * Fetch 3,500–4,100+ current LeetCode questions from open community mirrors (NO hints / NO company tags stored).
 */
export async function syncPublicLeetCodeBank({ source = 'full', limit = 4500 } = {}) {
  const urls = source === 'metadata'
    ? ['https://leetcode-api-pied.vercel.app/problems']
    : [
        'https://raw.githubusercontent.com/noworneverev/leetcode-api/master/data/leetcode_questions.json',
        'https://leetcode-api-pied.vercel.app/problems'
      ];

  let lastErr = null;
  for (const url of urls) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const rawList = Array.isArray(json) ? json : (Array.isArray(json?.questions) ? json.questions : []);
      if (rawList.length === 0) continue;

      const sliced = rawList.slice(0, Math.max(1, Number(limit) || 4500));
      const res = importLeetCodeDataset(sliced, url.includes('github') ? 'leetcode_full_mirror' : 'leetcode_metadata_mirror');
      // Re-apply curated builtin runnable test suites so signature test cases stay intact
      ensureBuiltInLeetCodeSeeded();
      return { ...res, sourceUrl: url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(lastErr ? `Failed to sync LeetCode bank: ${lastErr.message}` : 'No upstream LeetCode source reachable');
}

function formatProblemRow(row, { includeTests = false } = {}) {
  if (!row) return null;
  let topics = [];
  let examples = [];
  let starter = {};
  let buggy_starter = {};
  let test_cases = [];
  let function_name = {};
  try { topics = JSON.parse(row.topics_json || '[]'); } catch {}
  try { examples = JSON.parse(row.examples_json || '[]'); } catch {}
  try { starter = JSON.parse(row.starter_json || '{}'); } catch {}
  try { buggy_starter = JSON.parse(row.buggy_starter_json || '{}'); } catch {}
  try { function_name = JSON.parse(row.function_name_json || '{}'); } catch {}
  if (includeTests) {
    try { test_cases = JSON.parse(row.test_cases_json || '[]'); } catch {}
  }

  // Strictly NO hints and NO company tags returned
  const out = {
    id: row.id,
    frontend_id: row.frontend_id,
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    topics,
    category: row.category,
    description: row.description,
    constraints: row.constraints || '',
    examples,
    starter,
    buggy_starter,
    function_name,
    time_limit_ms: row.time_limit_ms || 2000,
    memory_limit_mb: row.memory_limit_mb || 256,
    source: row.source || 'builtin'
  };
  if (includeTests) out.test_cases = test_cases;
  return out;
}

export function getLeetCodeTopics() {
  ensureBuiltInLeetCodeSeeded();
  const rows = db.prepare('SELECT topics_json, difficulty FROM leetcode_problems').all();
  const counts = new Map();
  const diffCounts = { Easy: 0, Medium: 0, Hard: 0 };

  for (const r of rows) {
    if (diffCounts[r.difficulty] !== undefined) diffCounts[r.difficulty]++;
    try {
      const list = JSON.parse(r.topics_json || '[]');
      for (const t of list) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    } catch {}
  }

  const topics = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { total: rows.length, difficulties: diffCounts, topics };
}

export function listLeetCodeProblems({ search = '', topic = '', difficulty = '', page = 1, limit = 30 } = {}) {
  ensureBuiltInLeetCodeSeeded();
  const where = [];
  const params = [];

  if (difficulty && ['Easy', 'Medium', 'Hard'].includes(difficulty)) {
    where.push('difficulty = ?');
    params.push(difficulty);
  }
  if (topic) {
    where.push('topics_json LIKE ?');
    params.push(`%"${topic}"%`);
  }
  if (search) {
    const clean = search.trim();
    const numeric = /^\d+$/.test(clean) ? Number(clean) : null;
    if (numeric !== null) {
      where.push('(frontend_id = ? OR LOWER(title) LIKE ? OR LOWER(slug) LIKE ?)');
      params.push(numeric, `%${clean.toLowerCase()}%`, `%${clean.toLowerCase()}%`);
    } else {
      where.push('(LOWER(title) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(topics_json) LIKE ?)');
      const pat = `%${clean.toLowerCase()}%`;
      params.push(pat, pat, pat);
    }
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;

  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM leetcode_problems ${clause}`).get(...params);
  const total = totalRow?.c || 0;
  const rows = db.prepare(`
    SELECT * FROM leetcode_problems ${clause}
    ORDER BY frontend_id ASC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, offset);

  return {
    items: rows.map((r) => formatProblemRow(r, { includeTests: false })),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit))
  };
}

export function getLeetCodeProblem(idOrSlug, { includeTests = false } = {}) {
  ensureBuiltInLeetCodeSeeded();
  const key = String(idOrSlug || '').trim();
  if (!key) return null;
  const row = db.prepare('SELECT * FROM leetcode_problems WHERE id = ? OR slug = ? OR CAST(frontend_id AS TEXT) = ?').get(key, key, key);
  return formatProblemRow(row, { includeTests });
}

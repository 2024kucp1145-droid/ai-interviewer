/**
 * Company-Wise Technical Question Bank Catalog
 * Curated real-world questions from top tech giants (Google, Microsoft, Amazon, Meta, Netflix, Apple, Uber, etc.)
 * Organized across core software engineering domains with 5 top companies × 3 top questions each.
 */

export const DOMAIN_FIELDS = [
  { id: 'all', label: 'All Domains' },
  { id: 'frontend', label: 'Frontend & Web (React, JS, CSS)' },
  { id: 'backend', label: 'Backend, APIs & Microservices' },
  { id: 'dsa', label: 'Data Structures & Algorithms' },
  { id: 'system_design', label: 'System Design & Architecture' },
  { id: 'python_ai', label: 'Python, Data Science & AI' },
  { id: 'devops', label: 'DevOps, Cloud & Kubernetes' },
  { id: 'java', label: 'Java & Spring Boot Enterprise' },
  { id: 'behavioral', label: 'Behavioral & Leadership Principles' },
];

export const TOP_COMPANIES = [
  { id: 'all', name: 'All Companies', color: '#6366f1' },
  { id: 'Google', name: 'Google', color: '#ea4335', icon: 'bi-google' },
  { id: 'Microsoft', name: 'Microsoft', color: '#00a4ef', icon: 'bi-microsoft' },
  { id: 'Amazon', name: 'Amazon', color: '#ff9900', icon: 'bi-cart-check' },
  { id: 'Meta', name: 'Meta', color: '#0668e1', icon: 'bi-meta' },
  { id: 'Netflix', name: 'Netflix', color: '#e50914', icon: 'bi-film' },
  { id: 'Apple', name: 'Apple', color: '#555555', icon: 'bi-apple' },
  { id: 'Uber', name: 'Uber', color: '#000000', icon: 'bi-car-front' },
];

export const COMPANY_QUESTION_CATALOG = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. FRONTEND & WEB DEVELOPMENT (React, JavaScript, Web Performance)
  // ═══════════════════════════════════════════════════════════════════════════
  // Google (3 Qs)
  {
    id: 'q_fe_goog_1',
    company: 'Google',
    field: 'frontend',
    topic: 'Virtual DOM & Fiber Reconciliation',
    difficulty: 'Medium',
    question: 'How does React Fiber reconciliation algorithm work under the hood, and how does it prioritize high-priority user interactions over background re-renders?',
    context: 'Asked in Google L4/L5 Frontend Engineer round for Chrome / Docs Web Apps.',
    expectedSignals: 'Fiber node linked list, render phase (interruptible) vs commit phase (synchronous), requestIdleCallback/MessageChannel, concurrency lanes.'
  },
  {
    id: 'q_fe_goog_2',
    company: 'Google',
    field: 'frontend',
    topic: 'JavaScript Event Loop & Microtasks',
    difficulty: 'Medium',
    question: 'Explain the exact execution order between Promise.then, setTimeout(..., 0), requestAnimationFrame, and process.nextTick / MutationObserver in modern browser engines.',
    context: 'Core JavaScript evaluation in Google Search Web UX rounds.',
    expectedSignals: 'Call stack, Task queue (macrotasks) vs Microtask queue draining, event loop tick boundaries, rendering frame budget (16.6ms).'
  },
  {
    id: 'q_fe_goog_3',
    company: 'Google',
    field: 'frontend',
    topic: 'Core Web Vitals & Real-World Performance',
    difficulty: 'Hard',
    question: 'If an e-commerce page experiences a poor Interaction to Next Paint (INP) of 450ms and high Cumulative Layout Shift (CLS), what step-by-step diagnostic strategy and code refactoring would you implement?',
    context: 'Google Web Performance & Shopping Engine technical screening.',
    expectedSignals: 'Long task decomposition, scheduler.yield(), offloading CPU heavy tasks to Web Workers, reserved aspect-ratio sizing for dynamic elements.'
  },

  // Meta (3 Qs)
  {
    id: 'q_fe_meta_1',
    company: 'Meta',
    field: 'frontend',
    topic: 'State Management & Immutability',
    difficulty: 'Medium',
    question: 'Why does React require state to be immutable? How do structural sharing and shallow comparisons impact memoization with useMemo, useCallback, and React.memo?',
    context: 'Frequently asked in Meta E4/E5 Frontend Product Engineer rounds (Facebook/Instagram Web).',
    expectedSignals: 'Object references in JS, side-effects prevention, referential equality checks, avoiding excessive memory clones via structural sharing.'
  },
  {
    id: 'q_fe_meta_2',
    company: 'Meta',
    field: 'frontend',
    topic: 'Infinite Scroll Virtualization',
    difficulty: 'Hard',
    question: 'Design an infinite scrolling feed component (like Facebook Feed) capable of rendering 100,000 items without DOM bloat or memory leaks. Explain windowing and scroll estimation.',
    context: 'Meta Newsfeed & Marketplace UI Architecture Technical Screen.',
    expectedSignals: 'Virtual windowing (react-window/react-virtualized), DOM element recycling, IntersectionObserver, dynamic row height measurement cache, image memory recycling.'
  },
  {
    id: 'q_fe_meta_3',
    company: 'Meta',
    field: 'frontend',
    topic: 'Custom React Hook & Race Conditions',
    difficulty: 'Medium',
    question: 'Write or describe a custom React hook `useFetchWithAbort` that properly cancels pending network requests via AbortController when dependencies change or the component unmounts.',
    context: 'Meta Messenger Web & Threads frontend interview.',
    expectedSignals: 'AbortController.abort() inside useEffect cleanup, handling AbortError gracefully, preventing state update warnings on unmounted components.'
  },

  // Amazon (3 Qs)
  {
    id: 'q_fe_amzn_1',
    company: 'Amazon',
    field: 'frontend',
    topic: 'Cross-Browser Security & XSS / CSRF',
    difficulty: 'Medium',
    question: 'How do you defend a high-traffic web application against Stored XSS, Reflected XSS, and CSRF attacks? Contrast HttpOnly SameSite cookies with JWT local storage storage.',
    context: 'Amazon Retail Checkout & AWS Console UI engineering bar raiser.',
    expectedSignals: 'Content Security Policy (CSP), HTML sanitization (DOMPurify), SameSite=Strict cookies vs Authorization Bearer header, X-XSS-Protection limitations.'
  },
  {
    id: 'q_fe_amzn_2',
    company: 'Amazon',
    field: 'frontend',
    topic: 'Client-Side Caching & Offline Capabilities',
    difficulty: 'Medium',
    question: 'How would you architect offline-first shopping cart persistence in the browser? Compare IndexedDB, LocalStorage, and Service Worker Cache API.',
    context: 'Amazon Pay & 1-Click Buy frontend technical interview.',
    expectedSignals: 'IndexedDB transaction guarantees, storage limits, Service Worker cache-first vs network-first strategy, sync events upon reconnect.'
  },
  {
    id: 'q_fe_amzn_3',
    company: 'Amazon',
    field: 'frontend',
    topic: 'Debounce vs Throttle Implementation',
    difficulty: 'Easy',
    question: 'Explain the fundamental difference between debouncing and throttling. Where would you apply each in an autocomplete search bar versus a real-time window resize listener?',
    context: 'Amazon Search bar UI evaluation round.',
    expectedSignals: 'Debounce delays execution until stillness (search input); throttle guarantees execution at periodic interval (scroll/resize). Bonus for leading/trailing flags.'
  },

  // Microsoft (3 Qs)
  {
    id: 'q_fe_msft_1',
    company: 'Microsoft',
    field: 'frontend',
    topic: 'TypeScript Advanced Generics & Utility Types',
    difficulty: 'Medium',
    question: 'Explain how TypeScript conditional types (`T extends U ? X : Y`) work. How would you construct a custom `DeepReadonly<T>` or `NonNullableProperties<T>` type utility?',
    context: 'Microsoft Teams & Office 365 Web TypeScript technical interview.',
    expectedSignals: 'Mapped types, recursive conditional evaluation, infer keyword, keyof indexing, type-narrowing safety in production enterprise codebases.'
  },
  {
    id: 'q_fe_msft_2',
    company: 'Microsoft',
    field: 'frontend',
    topic: 'Web Accessibility (a11y) & WCAG Compliance',
    difficulty: 'Easy',
    question: 'How do you ensure a complex interactive modal dialog is fully accessible via keyboard and screen readers according to WAI-ARIA standards?',
    context: 'Microsoft Fluent UI & Inclusive Engineering assessment.',
    expectedSignals: 'Focus trap (Tab / Shift+Tab cycling), restoring focus to trigger on close, aria-modal="true", role="dialog", Escape key listener, aria-labelledby.'
  },
  {
    id: 'q_fe_msft_3',
    company: 'Microsoft',
    field: 'frontend',
    topic: 'Micro-Frontends & Module Federation',
    difficulty: 'Hard',
    question: 'How does Webpack 5 Module Federation work for enterprise micro-frontends? How do you prevent CSS collision and reconcile conflicting shared React versions between host and remotes?',
    context: 'Microsoft Azure Portal / Power Platform web architecture round.',
    expectedSignals: 'Shared dependency singleton configuration, dynamic remotes loading at runtime, Shadow DOM or CSS Modules/BEM scoping, error boundaries for remote failures.'
  },

  // Netflix (3 Qs)
  {
    id: 'q_fe_nflx_1',
    company: 'Netflix',
    field: 'frontend',
    topic: 'Streaming UI & Client Memory Management',
    difficulty: 'Hard',
    question: 'How do you handle memory profiling and garbage collection in a TV / Low-power device web browser running continuous video and infinite horizontal carousels?',
    context: 'Netflix TV UI / Big Screen Web client engineering round.',
    expectedSignals: 'Chrome DevTools heap snapshots, detached DOM tree leaks, unbinding event listeners, canvas video rendering buffers, image memory reclamation.'
  },
  {
    id: 'q_fe_nflx_2',
    company: 'Netflix',
    field: 'frontend',
    topic: 'Reactive Programming with RxJS / Observables',
    difficulty: 'Medium',
    question: 'How does an Observable pattern compare to Promises? In a search-as-you-type input, how would you chain `debounceTime`, `distinctUntilChanged`, and `switchMap` to avoid stale race responses?',
    context: 'Netflix Player & Studio Web technical screen.',
    expectedSignals: 'Multiple emissions vs single resolution, cancellation of pending inner observables via switchMap, handling out-of-order responses.'
  },
  {
    id: 'q_fe_nflx_3',
    company: 'Netflix',
    field: 'frontend',
    topic: 'Server-Side Rendering (SSR) & Hydration Mismatch',
    difficulty: 'Medium',
    question: 'What causes a React hydration error in SSR frameworks like Next.js, and what are the latency tradeoffs between SSR, SSG, and Incremental Static Regeneration (ISR)?',
    context: 'Netflix Global Landing Pages & Sign-up Flow round.',
    expectedSignals: 'Browser vs server HTML mismatch (timestamps, window object checks, browser extensions), streaming SSR with suspense, CDN edge caching with stale-while-revalidate.'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. BACKEND & APIS & DISTRIBUTED SYSTEMS (Node.js, Express, Microservices)
  // ═══════════════════════════════════════════════════════════════════════════
  // Amazon (3 Qs)
  {
    id: 'q_be_amzn_1',
    company: 'Amazon',
    field: 'backend',
    topic: 'Idempotency in Distributed Payment / Order APIs',
    difficulty: 'Medium',
    question: 'How do you guarantee strict idempotency for financial transactions and checkout order creation when network retries or client timeouts occur?',
    context: 'Amazon Pay & Retail Order Processing Systems SDE-2 round.',
    expectedSignals: 'Unique Idempotency-Key in HTTP headers, atomic DB insert / Redis lock with TTL, storing request status and returning identical cached response upon duplicate key.'
  },
  {
    id: 'q_be_amzn_2',
    company: 'Amazon',
    field: 'backend',
    topic: 'Database Locking: Pessimistic vs Optimistic',
    difficulty: 'Medium',
    question: 'When multiple customers attempt to purchase the final item in warehouse inventory simultaneously, how do you prevent race conditions using optimistic vs pessimistic locking?',
    context: 'Amazon Inventory & Fulfillment Services technical interview.',
    expectedSignals: '`SELECT FOR UPDATE` (pessimistic) vs version column `UPDATE items SET stock = stock - 1, version = version + 1 WHERE id = ? AND version = ?` (optimistic), retry strategies, throughput impact.'
  },
  {
    id: 'q_be_amzn_3',
    company: 'Amazon',
    field: 'backend',
    topic: 'Asynchronous Event-Driven Messaging (SQS / Kafka)',
    difficulty: 'Hard',
    question: 'Explain at-least-once vs exactly-once delivery semantics in message queues. How do you design consumer worker services to safely tolerate duplicated messages and dead-letter queue (DLQ) retries?',
    context: 'Amazon AWS Core Distributed Services SDE-2 / SDE-3 round.',
    expectedSignals: 'Consumer idempotency via processed message dedup keys, poison pill handling, exponential backoff with jitter, DLQ alerting.'
  },

  // Google (3 Qs)
  {
    id: 'q_be_goog_1',
    company: 'Google',
    field: 'backend',
    topic: 'gRPC vs REST & Protocol Buffers Serialization',
    difficulty: 'Medium',
    question: 'Compare gRPC with HTTP/2 and Protobuf against traditional REST APIs with JSON. Why does Google prefer Protobuf for internal inter-service remote procedure calls?',
    context: 'Google Core Infrastructure & Cloud backend engineering round.',
    expectedSignals: 'Binary packing compactness, strongly typed schemas, multiplexing multiple streams on single TCP connection, bi-directional streaming, lower CPU parsing overhead.'
  },
  {
    id: 'q_be_goog_2',
    company: 'Google',
    field: 'backend',
    topic: 'Node.js Non-Blocking I/O & Thread Pool Starvation',
    difficulty: 'Medium',
    question: 'Node.js is single-threaded for JavaScript execution, but how does libuv handle file I/O, DNS lookup, and cryptographic computations? How can thread pool starvation occur?',
    context: 'Google Cloud Platform Serverless / Firebase Functions interview.',
    expectedSignals: 'libuv default UV_THREADPOOL_SIZE (4 threads), blocking synchronous calls (crypto.pbkdf2Sync / fs.readFileSync) stalling all async tasks, cluster module vs worker threads.'
  },
  {
    id: 'q_be_goog_3',
    company: 'Google',
    field: 'backend',
    topic: 'Distributed Tracing & Distributed Context Propagation',
    difficulty: 'Hard',
    question: 'How do you trace a single user request traversing 20 internal microservices using OpenTelemetry / W3C Trace Context headers (traceparent, tracestate)?',
    context: 'Google SRE & Observability Infrastructure evaluation.',
    expectedSignals: 'Span ID, Trace ID correlation across HTTP/gRPC boundaries, baggage propagation, tail-based vs head-based sampling to control storage overhead.'
  },

  // Microsoft (3 Qs)
  {
    id: 'q_be_msft_1',
    company: 'Microsoft',
    field: 'backend',
    topic: 'API Rate Limiting & Throttling Algorithms',
    difficulty: 'Medium',
    question: 'Explain Token Bucket, Leaky Bucket, and Sliding Window Log rate limiting algorithms. How would you implement distributed rate limiting across a cluster using Redis?',
    context: 'Microsoft Graph API & Azure API Management team interview.',
    expectedSignals: 'Sliding window counter using Redis sorted sets (ZREMRANGEBYSCORE + ZADD) or Lua scripts for atomic token consumption, handling burst capacity vs smooth throttling.'
  },
  {
    id: 'q_be_msft_2',
    company: 'Microsoft',
    field: 'backend',
    topic: 'SQL Query Optimization & B-Tree Index Mechanics',
    difficulty: 'Medium',
    question: 'Explain how B-Tree indexes function in PostgreSQL/MySQL. Why does `WHERE age = 30 AND status = "active"` benefit from a composite index `(status, age)`, and what is index selectivity?',
    context: 'Microsoft Azure SQL Database & Cosmos DB team round.',
    expectedSignals: 'Leftmost prefix rule, clustered vs non-clustered index, cardinality and selectivity, index-only scans (covering index), avoid indexing low cardinality columns like booleans alone.'
  },
  {
    id: 'q_be_msft_3',
    company: 'Microsoft',
    field: 'backend',
    topic: 'Zero-Downtime Database Schema Migrations',
    difficulty: 'Hard',
    question: 'How do you rename a column or add a non-nullable column with a default value to a 500-million-row production database table without taking downtime or holding exclusive table locks?',
    context: 'Microsoft Enterprise Cloud reliability engineering round.',
    expectedSignals: 'Expand and contract pattern: 1) add new nullable column, 2) double-write in backend, 3) backfill historical rows in small batches, 4) switch reads, 5) drop old column.'
  },

  // Uber (3 Qs)
  {
    id: 'q_be_uber_1',
    company: 'Uber',
    field: 'backend',
    topic: 'Geospatial Indexing & High-Frequency Location Ingestion',
    difficulty: 'Hard',
    question: 'How do you ingest and query GPS coordinates from 2 million active drivers every 4 seconds to match riders within a 2 km radius? Compare Uber H3 hexagonal indexing with GeoHash / R-Tree.',
    context: 'Uber Rider / Driver Matching Platform engineering interview.',
    expectedSignals: 'Hexagonal hierarchical spatial index (Uber H3), integer bitmask representations, in-memory spatial caches (Redis GEO / custom memory grid), pub/sub geospatial partitions.'
  },
  {
    id: 'q_be_uber_2',
    company: 'Uber',
    field: 'backend',
    topic: 'Circuit Breaker Pattern & Cascading Failures',
    difficulty: 'Medium',
    question: 'How does a Circuit Breaker (Closed, Open, Half-Open) protect backend microservices from cascading failure when a downstream partner API becomes unresponsive?',
    context: 'Uber Core Platform Resiliency technical screen.',
    expectedSignals: 'Failure threshold triggers, timeout bounds, fallback degraded responses, exponential probing in half-open state, correlation with bulkheads.'
  },
  {
    id: 'q_be_uber_3',
    company: 'Uber',
    field: 'backend',
    topic: 'WebSocket Connection Management at Scale',
    difficulty: 'Medium',
    question: 'How do you maintain 5 million persistent WebSocket connections for real-time driver ride dispatch across multiple stateless server nodes?',
    context: 'Uber Real-time Push Messaging team evaluation.',
    expectedSignals: 'Redis Pub/Sub or Kafka routing backbone, sticky sessions vs connection brokers, TCP socket file descriptor limits (ulimit), ping-pong heartbeats to detect ghost sockets.'
  },

  // Netflix (3 Qs)
  {
    id: 'q_be_nflx_1',
    company: 'Netflix',
    field: 'backend',
    topic: 'Distributed Caching Strategies: Cache-Aside vs Write-Through',
    difficulty: 'Medium',
    question: 'Contrast Cache-Aside, Write-Through, and Write-Behind caching strategies. How do you mitigate Cache Stampede (Thundering Herd) and Cache Penetration when cache keys expire?',
    context: 'Netflix Playback and Recommendation API platform round.',
    expectedSignals: 'Probabilistic early expiration (XFetch), mutex locking around cache miss DB queries, Bloom filters for non-existent keys (penetration), jitter on TTLs.'
  },
  {
    id: 'q_be_nflx_2',
    company: 'Netflix',
    field: 'backend',
    topic: 'Chaos Engineering & Graceful Degradation',
    difficulty: 'Hard',
    question: 'How do you design a tiered fallback response in your backend APIs so that when recommendation engines crash, users still see a working home feed instead of HTTP 500 errors?',
    context: 'Netflix Chaos Monkey & Resilience team interview.',
    expectedSignals: 'Graceful degradation, static pre-baked popular titles fallback, feature flags, aggressive client-side caching, circuit breaking with fallback lambdas.'
  },
  {
    id: 'q_be_nflx_3',
    company: 'Netflix',
    field: 'backend',
    topic: 'Data Partitioning & Consistent Hashing',
    difficulty: 'Hard',
    question: 'Explain how Consistent Hashing with virtual nodes prevents massive data reshuffling when nodes join or leave a distributed caching or database cluster.',
    context: 'Netflix EVCache / Distributed Data tier interview.',
    expectedSignals: 'Hash ring topology (0 to 2^32-1), virtual nodes for uniform distribution, O(1/N) keys migrated on node churn, replica placement strategies.'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DATA STRUCTURES & ALGORITHMS (DSA)
  // ═══════════════════════════════════════════════════════════════════════════
  // Google (3 Qs)
  {
    id: 'q_dsa_goog_1',
    company: 'Google',
    field: 'dsa',
    topic: 'Graph Algorithms & Topological Sort',
    difficulty: 'Medium',
    question: 'Given an array of build dependencies (e.g. Course Schedule), determine if all tasks can be completed and output a valid compile sequence. What algorithm and time complexity do you use?',
    context: 'Google L4 Core Coding Round (LeetCode #207 / #210).',
    expectedSignals: "Kahn's Algorithm (in-degree array + BFS Queue) or DFS with 3-color cycle detection (White/Gray/Black). Time O(V + E), Space O(V + E)."
  },
  {
    id: 'q_dsa_goog_2',
    company: 'Google',
    field: 'dsa',
    topic: 'Trie & Prefix Matching with Frequency',
    difficulty: 'Hard',
    question: 'Implement an autocomplete system (Search Autocomplete) that returns top 3 most frequently searched query suggestions matching a prefix in real-time.',
    context: 'Google Search Typeahead Engineering Coding Round (LeetCode #642).',
    expectedSignals: 'Trie node storing top-K heap or cached list of top queries, character transitions, updating frequencies dynamically without re-sorting entire tree.'
  },
  {
    id: 'q_dsa_goog_3',
    company: 'Google',
    field: 'dsa',
    topic: 'Monotonic Stack / Sliding Window Maximum',
    difficulty: 'Hard',
    question: 'Given an integer array nums and a sliding window of size k moving from left to right, return the max sliding window values in O(N) time.',
    context: 'Google Algorithm & Quantitative Assessment (LeetCode #239).',
    expectedSignals: 'Double-ended queue (Deque) maintaining indices in monotonically decreasing value order. Remove out-of-window elements from front, smaller elements from back.'
  },

  // Amazon (3 Qs)
  {
    id: 'q_dsa_amzn_1',
    company: 'Amazon',
    field: 'dsa',
    topic: 'Heap / Priority Queue & Top K Elements',
    difficulty: 'Medium',
    question: 'Given a stream of real-time product reviews with rating scores, how do you continuously maintain the median review rating or top K most frequent items in O(log K) per insertion?',
    context: 'Amazon SDE-1 / SDE-2 Algorithms round (LeetCode #295 / #347).',
    expectedSignals: 'Two heaps: Max-heap for lower half and Min-heap for upper half, balancing size difference <= 1. O(1) median lookup, O(log N) insertion.'
  },
  {
    id: 'q_dsa_amzn_2',
    company: 'Amazon',
    field: 'dsa',
    topic: 'Breadth-First Search on 2D Matrix (Rotting Oranges)',
    difficulty: 'Medium',
    question: 'You are given an m x n grid representing fresh and rotten packages. Every minute, any fresh package adjacent (4-directionally) to a rotten package rots. Return minimum minutes until no fresh packages remain.',
    context: 'Amazon Logistics & Fulfillment algorithmic screen (LeetCode #994).',
    expectedSignals: 'Multi-source BFS using queue seeded with all initial rotten positions, tracking fresh count, incrementing minutes per level until queue empty.'
  },
  {
    id: 'q_dsa_amzn_3',
    company: 'Amazon',
    field: 'dsa',
    topic: 'Dynamic Programming (Coin Change / Knapsack)',
    difficulty: 'Medium',
    question: 'You are given coin denominations and an amount. Compute the fewest coins needed to make up that amount, or return -1 if impossible. Analyze time and space complexity.',
    context: 'Amazon Payments & Financial calculations round (LeetCode #322).',
    expectedSignals: 'Bottom-up DP: dp[i] = min(dp[i], dp[i - coin] + 1) initialized to amount + 1. Time O(amount * coins.length), Space O(amount).'
  },

  // Microsoft (3 Qs)
  {
    id: 'q_dsa_msft_1',
    company: 'Microsoft',
    field: 'dsa',
    topic: 'Binary Tree Lowest Common Ancestor (LCA)',
    difficulty: 'Medium',
    question: 'Given a binary tree and two nodes p and q, find their Lowest Common Ancestor. What is the time complexity and how does your solution differ if it is a Binary Search Tree (BST)?',
    context: 'Microsoft SDE Technical Coding Assessment (LeetCode #236 / #235).',
    expectedSignals: 'Post-order DFS traversal returning non-null when node found. In BST, traverse left if both < root, right if both > root; split point is LCA in O(H) time.'
  },
  {
    id: 'q_dsa_msft_2',
    company: 'Microsoft',
    field: 'dsa',
    topic: 'LRU Cache Design (O(1) Get and Put)',
    difficulty: 'Medium',
    question: 'Design an LRU (Least Recently Used) cache with `get(key)` and `put(key, value)` both running in guaranteed strict O(1) time complexity.',
    context: 'Microsoft Systems & Operating Systems core round (LeetCode #146).',
    expectedSignals: 'Hash Map (key -> Node) paired with Doubly Linked List (head/tail dummy nodes). Move accessed nodes to head, evict from tail upon capacity limit.'
  },
  {
    id: 'q_dsa_msft_3',
    company: 'Microsoft',
    field: 'dsa',
    topic: 'Merge K Sorted Lists',
    difficulty: 'Hard',
    question: 'You are given an array of k linked-lists, each sorted in ascending order. Merge all into one sorted linked-list and return its head. Optimize beyond O(N * k).',
    context: 'Microsoft Azure Data engineering interview (LeetCode #23).',
    expectedSignals: 'Min-Heap of size k holding current node of each list (O(N log k)), or divide-and-conquer merge pairs (similar to merge sort, O(N log k), O(1) extra space).'
  },

  // Meta (3 Qs)
  {
    id: 'q_dsa_meta_1',
    company: 'Meta',
    field: 'dsa',
    topic: 'String Parsing & Minimum Remove to Make Valid Parentheses',
    difficulty: 'Medium',
    question: 'Given a string of parentheses and letters, remove the minimum number of parentheses so the resulting string is valid. Return any valid result in O(N) time.',
    context: 'Meta E4/E5 Speed Coding Round (LeetCode #1249).',
    expectedSignals: 'Stack storing indices of unmatched opening brackets; set of invalid closing indices; build output string skipping filtered indices.'
  },
  {
    id: 'q_dsa_meta_2',
    company: 'Meta',
    field: 'dsa',
    topic: 'Two Pointers & Trapping Rain Water',
    difficulty: 'Hard',
    question: 'Given n non-negative integers representing elevation map where width of each bar is 1, compute how much water it can trap after raining.',
    context: 'Meta Core Algorithms Round (LeetCode #42).',
    expectedSignals: 'Two pointers (left, right) with left_max and right_max variables. O(N) time and O(1) space, advancing the pointer with smaller max height.'
  },
  {
    id: 'q_dsa_meta_3',
    company: 'Meta',
    field: 'dsa',
    topic: 'Binary Search on Rotated Sorted Array',
    difficulty: 'Medium',
    question: 'Search for target in an integer array sorted in ascending order with distinct values, but rotated at an unknown pivot index. Must be strictly O(log N) time.',
    context: 'Meta E4 Coding Round (LeetCode #33).',
    expectedSignals: 'Modified binary search: determine which half (left to mid vs mid to right) is normally sorted, then check if target lies within that sorted range.'
  },

  // Apple (3 Qs)
  {
    id: 'q_dsa_appl_1',
    company: 'Apple',
    field: 'dsa',
    topic: 'Interval Merging & Insert Interval',
    difficulty: 'Medium',
    question: 'Given a collection of intervals, merge all overlapping intervals and return an array of non-overlapping intervals in sorted order.',
    context: 'Apple Calendar & Scheduling engine team round (LeetCode #56 / #57).',
    expectedSignals: 'Sort by interval start time, iterate and compare current interval start with last merged interval end; update max(end1, end2). O(N log N).'
  },
  {
    id: 'q_dsa_appl_2',
    company: 'Apple',
    field: 'dsa',
    topic: 'Bit Manipulation & Single Number II',
    difficulty: 'Medium',
    question: 'Given an integer array where every element appears three times except for one which appears exactly once, find that single element in linear time and O(1) space.',
    context: 'Apple Hardware / OS Embedded Software engineering round (LeetCode #137).',
    expectedSignals: 'Bitwise sum modulo 3 across all 32 bits, or bitmask states using two variables `ones` and `twos` with XOR and NOT gates.'
  },
  {
    id: 'q_dsa_appl_3',
    company: 'Apple',
    field: 'dsa',
    topic: 'Design Underground / Metro Transit System',
    difficulty: 'Medium',
    question: 'Design an underground railway tracker with `checkIn(id, station, t)`, `checkOut(id, station, t)`, and `getAverageTime(startStation, endStation)` in O(1) average time.',
    context: 'Apple Maps / Transit services technical interview (LeetCode #1396).',
    expectedSignals: 'Two hash maps: 1) Active check-ins: id -> {station, time}; 2) Aggregated route stats: "stationA-stationB" -> {totalDuration, tripCount}.'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. SYSTEM DESIGN & ARCHITECTURE
  // ═══════════════════════════════════════════════════════════════════════════
  // Meta (3 Qs)
  {
    id: 'q_sd_meta_1',
    company: 'Meta',
    field: 'system_design',
    topic: 'Design Real-Time Chat & Messaging (WhatsApp / Messenger)',
    difficulty: 'Hard',
    question: 'Design an end-to-end real-time chat application supporting 1-on-1 messaging, group chats (500 members), presence indicators (online/offline), and read receipts.',
    context: 'Meta E5 / E6 System Design Interview (WhatsApp Infrastructure).',
    expectedSignals: 'WebSocket gateway servers, message broker (Kafka/Pulsar), Cassandra/ScyllaDB for chronological chat storage, fan-out on write for group messages, heartbeat presence service in Redis.'
  },
  {
    id: 'q_sd_meta_2',
    company: 'Meta',
    field: 'system_design',
    topic: 'Design Social Media News Feed (Facebook Feed)',
    difficulty: 'Hard',
    question: 'Design Facebook News Feed for 2 billion daily active users. Address feed generation trade-offs between Fan-Out-on-Write (Push) versus Fan-Out-on-Read (Pull) for celebrity accounts.',
    context: 'Meta Core Feed & Ranking infrastructure interview.',
    expectedSignals: 'Hybrid model: Push to follower in-memory redis timelines for regular users; Pull at query time for celebrities (>100k followers). Ranking service, timeline cache.'
  },
  {
    id: 'q_sd_meta_3',
    company: 'Meta',
    field: 'system_design',
    topic: 'Design Distributed Web Crawler',
    difficulty: 'Hard',
    question: 'Design a distributed web crawler capable of crawling 10 billion web pages per month. How do you handle URL deduplication, politeness policies, and robot.txt compliance?',
    context: 'Meta Search & AI indexing systems engineering round.',
    expectedSignals: 'URL Frontier with priority and politeness queues (per domain), Bloom filter for visited URLs, content fingerprinting (SimHash) for duplicate detection, DNS cache.'
  },

  // Google (3 Qs)
  {
    id: 'q_sd_goog_1',
    company: 'Google',
    field: 'system_design',
    topic: 'Design YouTube / Video Streaming Platform',
    difficulty: 'Hard',
    question: 'Design YouTube video upload, transcoding pipeline, and adaptive bitrate streaming (HLS / DASH) across global edge CDN nodes for millions of concurrent viewers.',
    context: 'Google L5 / L6 Media Infrastructure System Design round.',
    expectedSignals: 'Chunked multi-part upload to Blob storage (GCS/S3), async task queue for transcoding into multiple resolutions (1080p, 720p, 480p), manifest generation, CDN edge caching strategy.'
  },
  {
    id: 'q_sd_goog_2',
    company: 'Google',
    field: 'system_design',
    topic: 'Design Google Docs Collaborative Real-Time Editor',
    difficulty: 'Hard',
    question: 'Design a real-time collaborative document editing system like Google Docs. Compare Operational Transformation (OT) with Conflict-Free Replicated Data Types (CRDTs).',
    context: 'Google Workspace Core Architecture technical interview.',
    expectedSignals: 'Centralized server state transformation (OT) vs peer-to-peer commutative state (CRDT - Yjs/Automerge), causal ordering, client undo/redo buffer, compaction of document history.'
  },
  {
    id: 'q_sd_goog_3',
    company: 'Google',
    field: 'system_design',
    topic: 'Design Distributed Unique ID Generator (Snowflake)',
    difficulty: 'Medium',
    question: 'Design a distributed 64-bit strictly unique, roughly time-sorted ID generator capable of generating 100,000 IDs per second without database auto-increment bottlenecks.',
    context: 'Google Cloud Platform Foundation infrastructure round.',
    expectedSignals: 'Twitter Snowflake structure: 1 sign bit + 41-bit timestamp (69 years) + 10-bit machine/datacenter ID + 12-bit sequence counter (4096 IDs per ms per node). Clock drift handling.'
  },

  // Amazon (3 Qs)
  {
    id: 'q_sd_amzn_1',
    company: 'Amazon',
    field: 'system_design',
    topic: 'Design Flash Sale / High-Concurrency Booking Engine',
    difficulty: 'Hard',
    question: 'Design an e-commerce flash sale system (like Amazon Great Indian Festival) where 50,000 users attempt to checkout 500 limited stock iPhone units in the first 5 seconds.',
    context: 'Amazon SDE-3 / Principal Retail Systems Architecture interview.',
    expectedSignals: 'Redis atomic Lua script `DECR` for stock pre-reservation, message queue decoupling (SQS) to throttle DB writes, virtual waiting room queue, cache warm-up, rate limiting checkout bots.'
  },
  {
    id: 'q_sd_amzn_2',
    company: 'Amazon',
    field: 'system_design',
    topic: 'Design Distributed Key-Value Store (Dynamo)',
    difficulty: 'Hard',
    question: 'Design a distributed key-value store with high availability, eventual consistency, sloppy quorums (W + R > N), and hinted handoff based on the Amazon Dynamo paper.',
    context: 'Amazon AWS DynamoDB & S3 Core team system design round.',
    expectedSignals: 'Consistent hashing ring, vector clocks for conflict resolution, read-repair, Merkle trees for anti-entropy sync, tunable consistency levels.'
  },
  {
    id: 'q_sd_amzn_3',
    company: 'Amazon',
    field: 'system_design',
    topic: 'Design URL Shortener Service (TinyURL)',
    difficulty: 'Easy',
    question: 'Design a scalable URL shortener service handling 100 million new URLs per month and a 10:1 read-to-write ratio. Discuss hashing algorithms and custom aliases.',
    context: 'Standard Amazon SDE-2 System Design primer interview.',
    expectedSignals: 'Base62 encoding of 64-bit ID (7 chars = 3.5 trillion URLs), MD5/SHA256 truncation vs auto-increment counter, caching top accessed URLs in Redis, HTTP 301 vs 302 redirect trade-offs.'
  },

  // Netflix (3 Qs)
  {
    id: 'q_sd_nflx_1',
    company: 'Netflix',
    field: 'system_design',
    topic: 'Design Netflix Open Connect CDN & Video Delivery',
    difficulty: 'Hard',
    question: 'How does Netflix route video traffic to Open Connect Appliances (OCAs) deployed directly inside ISP networks? How do you prevent ISP backhaul congestion during peak streaming hours?',
    context: 'Netflix Edge & Content Delivery Infrastructure Architecture.',
    expectedSignals: 'DNS steering and BGP routing, pre-positioning content during off-peak hours based on predicted regional views, health checking OCAs, byte-range caching.'
  },
  {
    id: 'q_sd_nflx_2',
    company: 'Netflix',
    field: 'system_design',
    topic: 'Design Recommendation Engine Scoring & Candidate Generation',
    difficulty: 'Hard',
    question: 'Design the backend architecture serving personalized top-picks for 250 million users within 200 milliseconds. Discuss offline training vs nearline feature stores and online ranking.',
    context: 'Netflix Machine Learning Platform & Algorithmic Systems.',
    expectedSignals: 'Two-stage architecture: Candidate retrieval (vector search / ANN in Milvus/Faiss from 100k to 500 items) followed by heavy neural ranking model inference; feature store (Redis/Feast).'
  },
  {
    id: 'q_sd_nflx_3',
    company: 'Netflix',
    field: 'system_design',
    topic: 'Design Centralized Logging & Anomaly Alerting',
    difficulty: 'Medium',
    question: 'Design a real-time log analytics platform processing 5 TB of log events per hour from 50,000 microservice containers with search and automated threshold anomaly alerts.',
    context: 'Netflix Platform Engineering & Observability interview.',
    expectedSignals: 'Log shippers (Vector/Fluentd) -> Kafka ingestion buffer -> Flink/Spark streaming aggregations -> Elasticsearch/OpenSearch indexing + S3 parquet deep archive.'
  },

  // Uber (3 Qs)
  {
    id: 'q_sd_uber_1',
    company: 'Uber',
    field: 'system_design',
    topic: 'Design Uber Ride Dispatch & Dynamic Surge Pricing',
    difficulty: 'Hard',
    question: 'Design Uber ride matching and real-time surge pricing engine. How do you aggregate supply (available drivers) and demand (requested rides) in micro-regions every 10 seconds?',
    context: 'Uber Core Marketplace Dynamic Pricing system design.',
    expectedSignals: 'Spatial grid aggregation using H3 hexagons, streaming stateful processing (Apache Flink), surge multiplier calculation curve, atomic lock on driver dispatch to avoid double-assignment.'
  },
  {
    id: 'q_sd_uber_2',
    company: 'Uber',
    field: 'system_design',
    topic: 'Design Real-Time ETA Calculation & Routing Service',
    difficulty: 'Hard',
    question: 'Design an ETA routing service that recalculates arrival estimates for 15 million rides simultaneously, accounting for real-time traffic slowdowns and road construction.',
    context: 'Uber Routing & Maps Infrastructure evaluation.',
    expectedSignals: 'Contraction Hierarchies / A* search on partitioned road network graph, live segment speed overlays, pre-computed routing tables, caching common OD (origin-destination) routes.'
  },
  {
    id: 'q_sd_uber_3',
    company: 'Uber',
    field: 'system_design',
    topic: 'Design Distributed Notification & Push Engine',
    difficulty: 'Medium',
    question: 'Design an omni-channel notification engine (APNs, FCM, SMS, Email) sending 50 million notifications daily with prioritization, user opt-out preferences, and frequency capping.',
    context: 'Uber Customer Communications Platform interview.',
    expectedSignals: 'Queue per channel (priority lanes for OTP vs marketing), idempotency key on notification dispatch, user preference service in Redis, dead-letter fallback (Push fails -> send SMS).'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. PYTHON, DATA SCIENCE & MACHINE LEARNING / AI
  // ═══════════════════════════════════════════════════════════════════════════
  // Google (3 Qs)
  {
    id: 'q_py_goog_1',
    company: 'Google',
    field: 'python_ai',
    topic: 'Python GIL (Global Interpreter Lock) & Concurrency',
    difficulty: 'Medium',
    question: 'How does the CPython Global Interpreter Lock impact multi-threaded CPU-bound programs versus I/O-bound programs? How do asyncio and multiprocessing bypass GIL limitations?',
    context: 'Google Brain / AI Infrastructure Python engineer interview.',
    expectedSignals: 'Reference counting thread safety, GIL released on I/O operations, process separation with IPC/shared memory (multiprocessing), async event loop cooperative multitasking.'
  },
  {
    id: 'q_py_goog_2',
    company: 'Google',
    field: 'python_ai',
    topic: 'Transformer Architecture & Self-Attention Calculation',
    difficulty: 'Hard',
    question: 'Explain the mathematical formulation of Scaled Dot-Product Attention in Transformers: $$\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$. Why is scaling by $$\\sqrt{d_k}$$ critical?',
    context: 'Google DeepMind & Gemini Research Engineering technical screen.',
    expectedSignals: 'Dot product magnitude grows with vector dimension causing softmax gradients to vanish (saturation in extreme regions); scaling maintains unit variance; O(N^2) memory complexity.'
  },
  {
    id: 'q_py_goog_3',
    company: 'Google',
    field: 'python_ai',
    topic: 'Vector Database & Approximate Nearest Neighbor (ANN)',
    difficulty: 'Hard',
    question: 'How do Hierarchical Navigable Small World (HNSW) graphs and Inverted File Index (IVF) search vector embeddings in sub-millisecond latencies for RAG pipelines?',
    context: 'Google Cloud Vertex AI & Enterprise Search interview.',
    expectedSignals: 'Multi-layer proximity graph navigation, Voronoi cell clustering in IVF, recall vs latency trade-offs, cosine similarity vs L2 Euclidean distance quantization.'
  },

  // Microsoft (3 Qs)
  {
    id: 'q_py_msft_1',
    company: 'Microsoft',
    field: 'python_ai',
    topic: 'Python Memory Management & Circular Garbage Collection',
    difficulty: 'Medium',
    question: 'How does Python manage object allocation and deallocation? How does the generational garbage collector (Gen 0, 1, 2) detect and eliminate circular reference loops?',
    context: 'Microsoft Azure Machine Learning & Python core platform round.',
    expectedSignals: 'PyObject reference counting (deallocated immediately when refcount reaches 0), cyclic GC tracking container types with doubly linked lists, generational promotion thresholds.'
  },
  {
    id: 'q_py_msft_2',
    company: 'Microsoft',
    field: 'python_ai',
    topic: 'Retrieval Augmented Generation (RAG) Architecture',
    difficulty: 'Hard',
    question: 'Design an enterprise RAG pipeline for Copilot answering queries across 50,000 PDFs. How do you optimize document chunking, semantic re-ranking, and prevent hallucinations?',
    context: 'Microsoft 365 Copilot & Azure OpenAI service architecture.',
    expectedSignals: 'Recursive semantic chunking with overlap, embedding model, cross-encoder re-ranking (Cohere/BGE), citations grounding, guardrails verification prompt filters.'
  },
  {
    id: 'q_py_msft_3',
    company: 'Microsoft',
    field: 'python_ai',
    topic: 'Pandas Vectorization vs Python Loops',
    difficulty: 'Easy',
    question: 'Why is `df.apply()` or row-by-row iteration dramatically slower than vectorized NumPy / Pandas operations on a 10-million row dataset? Explain memory layout and SIMD.',
    context: 'Microsoft Data Analytics & Power BI backend team screen.',
    expectedSignals: 'Homogeneous contiguous C-array memory blocks, CPU cache locality, SIMD vector instructions, avoiding Python interpreter overhead on each element.'
  },

  // Meta (3 Qs)
  {
    id: 'q_py_meta_1',
    company: 'Meta',
    field: 'python_ai',
    topic: 'PyTorch Autograd Engine & Gradient Computation',
    difficulty: 'Medium',
    question: 'How does PyTorch dynamically construct a Directed Acyclic Graph (DAG) of Tensor operations during the forward pass to execute reverse-mode automatic differentiation in `.backward()`?',
    context: 'Meta FAIR (Fundamental AI Research) & PyTorch core team interview.',
    expectedSignals: 'Computation graph tracking `grad_fn` on tensors with `requires_grad=True`, chain rule propagation, clearing gradients with `optimizer.zero_grad()`, `torch.no_grad()`.'
  },
  {
    id: 'q_py_meta_2',
    company: 'Meta',
    field: 'python_ai',
    topic: 'Model Quantization: FP32 to INT8 / FP8',
    difficulty: 'Hard',
    question: 'Explain post-training quantization (PTQ) vs quantization-aware training (QAT). How do INT8 / FP8 weights reduce inference VRAM footprint on GPUs while preserving perplexity?',
    context: 'Meta Llama Open Source Inference optimization engineering round.',
    expectedSignals: 'Symmetric vs asymmetric scaling factor and zero-point calibration, memory bandwidth bottleneck relief in LLMs, clipping outliers, simulated quantization during QAT.'
  },
  {
    id: 'q_py_meta_3',
    company: 'Meta',
    field: 'python_ai',
    topic: 'Python Decorators & Context Managers',
    difficulty: 'Easy',
    question: 'Write a Python decorator `@timed_retry(max_retries=3, delay=1.0)` that logs function runtime and retries on exceptions. Explain `functools.wraps` and `__enter__` / `__exit__`.',
    context: 'Meta Python infrastructure & production tooling interview.',
    expectedSignals: 'Closure retaining arguments, preserving `__name__` and docstring via wraps, context manager exception suppression via `__exit__` return value.'
  },

  // Amazon (3 Qs)
  {
    id: 'q_py_amzn_1',
    company: 'Amazon',
    field: 'python_ai',
    topic: 'Handling Imbalanced Datasets & Evaluation Metrics',
    difficulty: 'Medium',
    question: 'In a fraud detection model where only 0.05% of transactions are fraudulent, why is Accuracy completely misleading? Compare Precision, Recall, F1-Score, and ROC-AUC.',
    context: 'Amazon Fraud Detector & Machine Learning SDE-2 round.',
    expectedSignals: 'Accuracy paradox (99.95% accuracy by predicting all legitimate), Precision vs Recall trade-offs, PR-AUC for heavy skew, SMOTE oversampling vs focal loss.'
  },
  {
    id: 'q_py_amzn_2',
    company: 'Amazon',
    field: 'python_ai',
    topic: 'Distributed LLM Training: Data vs Tensor Parallelism',
    difficulty: 'Hard',
    question: 'When training a 70B parameter model that cannot fit into single 80GB A100 GPU VRAM, contrast DeepSpeed ZeRO stages, Pipeline Parallelism, and Megatron-LM Tensor Parallelism.',
    context: 'Amazon AWS Trainium & SageMaker Foundation Model training team.',
    expectedSignals: 'ZeRO-1/2/3 partitioning optimizer states, gradients, and model parameters; inter-GPU communication bandwidth (NVLink vs InfiniBand), all-reduce overhead.'
  },
  {
    id: 'q_py_amzn_3',
    company: 'Amazon',
    field: 'python_ai',
    topic: 'FastAPI Concurrency vs Flask WSGI',
    difficulty: 'Easy',
    question: 'How does FastAPI achieve high concurrent request handling using `async def` and Starlette compared to traditional synchronous WSGI servers like Flask / Django?',
    context: 'Amazon Microservices & Internal ML APIs technical screen.',
    expectedSignals: 'ASGI event loop handling thousands of concurrent idle sockets without dedicated OS thread per connection, Pydantic data validation with type hints.'
  },

  // Apple (3 Qs)
  {
    id: 'q_py_appl_1',
    company: 'Apple',
    field: 'python_ai',
    topic: 'On-Device ML Inference & CoreML Optimization',
    difficulty: 'Hard',
    question: 'How do you convert and prune a PyTorch model into Apple CoreML / Neural Engine (ANE) format to guarantee sub-10ms latency on an iPhone without draining battery?',
    context: 'Apple Siri & On-Device Intelligence engineering team round.',
    expectedSignals: 'Weight pruning (unstructured vs structured), FP16 quantization, Core ML Tools conversion, hardware-aware latency profiling for Apple Neural Engine.'
  },
  {
    id: 'q_py_appl_2',
    company: 'Apple',
    field: 'python_ai',
    topic: 'Python Generators & Memory Streaming',
    difficulty: 'Easy',
    question: 'How do generator functions using `yield` enable processing gigabyte-sized log files with almost zero RAM consumption? How does `itertools` optimize iterator pipelines?',
    context: 'Apple Data Infrastructure & OS telemetry processing round.',
    expectedSignals: 'Lazy evaluation (state suspended and resumed via generator protocol), generator expressions vs list comprehensions, avoiding full file buffering.'
  },
  {
    id: 'q_py_appl_3',
    company: 'Apple',
    field: 'python_ai',
    topic: 'Overfitting Detection & Regularization Techniques',
    difficulty: 'Medium',
    question: 'How do L1 Lasso, L2 Ridge, Dropout, and Early Stopping prevent neural network overfitting? What is the mathematical intuition behind L1 producing sparse weight vectors?',
    context: 'Apple Health & Biometric Machine Learning research round.',
    expectedSignals: 'Diamond constraint region in L1 leading to corner intersections (weights zeroed out) vs circular L2 penalizing large magnitudes; dropout breaking co-adaptations.'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. DEVOPS, CLOUD & INFRASTRUCTURE / SRE
  // ═══════════════════════════════════════════════════════════════════════════
  // Amazon AWS (3 Qs)
  {
    id: 'q_ops_amzn_1',
    company: 'Amazon',
    field: 'devops',
    topic: 'Kubernetes Pod Scheduling & Resource Constraints',
    difficulty: 'Medium',
    question: 'Explain the difference between Kubernetes CPU/Memory `requests` versus `limits`. What triggers OOMKilled (Exit Code 137) vs CPU Throttling, and how does CFS quota operate?',
    context: 'Amazon EKS & AWS Cloud Infrastructure DevOps evaluation.',
    expectedSignals: 'Requests dictate node scheduling placement; limits enforced by Linux cgroups. Memory exceeded triggers kernel OOM killer kill; CPU exceeded results in CFS bandwidth throttling without pod termination.'
  },
  {
    id: 'q_ops_amzn_2',
    company: 'Amazon',
    field: 'devops',
    topic: 'Infrastructure as Code: Terraform State & Drift Detection',
    difficulty: 'Medium',
    question: 'How does Terraform manage state in enterprise remote backends (S3 + DynamoDB locking)? What is configuration drift and how do you reconcile out-of-band AWS console modifications?',
    context: 'Amazon Managed Cloud DevOps Engineer interview.',
    expectedSignals: 'State locking prevents concurrent corruptions; `terraform plan` refreshes state against real cloud resources; `terraform import` or state surgery for drift reconciliation.'
  },
  {
    id: 'q_ops_amzn_3',
    company: 'Amazon',
    field: 'devops',
    topic: 'Blue-Green vs Canary Deployment with Istio Service Mesh',
    difficulty: 'Hard',
    question: 'How do you execute a 95/5 traffic split canary deployment for a critical microservice using Istio VirtualService and automated Prometheus error-rate rollback?',
    context: 'Amazon High-Scale Cloud Operations Bar Raiser round.',
    expectedSignals: 'VirtualService weight routing, Envoy sidecar proxy injection, Flagger / Argo Rollouts for automated canary analysis, rolling back if HTTP 5xx rate exceeds 0.5%.'
  },

  // Google GCP (3 Qs)
  {
    id: 'q_ops_goog_1',
    company: 'Google',
    field: 'devops',
    topic: 'SRE Principles: Error Budgets & SLA / SLO / SLI',
    difficulty: 'Medium',
    question: 'Define SLI, SLO, and SLA. If an API has a 99.9% monthly availability SLO, calculate its total permissible downtime budget. What happens when the error budget is exhausted?',
    context: 'Google Site Reliability Engineering (SRE) Core Assessment.',
    expectedSignals: 'SLI (measured metric), SLO (internal target, 43.8 minutes allowed downtime/month for 99.9%), SLA (contractual legal penalty). Freezing feature rollouts to prioritize stability when budget spent.'
  },
  {
    id: 'q_ops_goog_2',
    company: 'Google',
    field: 'devops',
    topic: 'Docker Multi-Stage Builds & Container Security',
    difficulty: 'Easy',
    question: 'How do Docker multi-stage builds dramatically shrink production container image size and eliminate security attack vectors? Why should containers never run as root?',
    context: 'Google Container Registry & Cloud Run security technical screen.',
    expectedSignals: 'Separating build dependencies (compilers, npm devDependencies) from lean runtime image (distroless / alpine), running as unprivileged non-root USER 1001, scanning CVEs with Trivy.'
  },
  {
    id: 'q_ops_goog_3',
    company: 'Google',
    field: 'devops',
    topic: 'Kubernetes Ingress & Service Networking Internals',
    difficulty: 'Hard',
    question: 'Trace the complete network packet path when an external HTTPS request reaches a Kubernetes Ingress Controller, traverses kube-proxy (iptables/IPVS), and lands on an application Pod.',
    context: 'Google Kubernetes Engine (GKE) networking team interview.',
    expectedSignals: 'NodePort / Cloud Load Balancer -> Ingress NGINX / Envoy -> CoreDNS resolution -> iptables DNAT rules rewrite destination IP to Pod IP -> veth pair into pod network namespace.'
  },

  // Microsoft Azure (3 Qs)
  {
    id: 'q_ops_msft_1',
    company: 'Microsoft',
    field: 'devops',
    topic: 'CI/CD Pipeline Security & Secret Management',
    difficulty: 'Medium',
    question: 'How do you prevent secrets leakage in GitHub Actions / Azure DevOps pipelines? Explain OpenID Connect (OIDC) federated credentials without storing long-lived cloud keys.',
    context: 'Microsoft Cloud Security & DevSecOps engineering round.',
    expectedSignals: 'Short-lived JWT token exchange via OIDC with AWS/Azure, avoiding hardcoded static access keys, secret masking in console logs, HashiCorp Vault / Azure Key Vault.'
  },
  {
    id: 'q_ops_msft_2',
    company: 'Microsoft',
    field: 'devops',
    topic: 'Linux System Debugging & Kernel Metrics',
    difficulty: 'Hard',
    question: 'A Linux server exhibits 100% CPU utilization, but `top` displays no individual process consuming more than 5%. How do you diagnose high I/O wait, hardware interrupts, or zombie processes?',
    context: 'Microsoft Azure Linux OS Infrastructure & Hyper-V team round.',
    expectedSignals: 'Checking `dmesg`, `vmstat 1`, `iostat -xz 1`, `/proc/interrupts`, checking for excessive context switching (`pidstat -w`), kernel threads stuck in uninterruptible sleep state (D-state).'
  },
  {
    id: 'q_ops_msft_3',
    company: 'Microsoft',
    field: 'devops',
    topic: 'Disaster Recovery (DR): RTO and RPO Architecture',
    difficulty: 'Medium',
    question: 'Contrast Recovery Time Objective (RTO) with Recovery Point Objective (RPO). Design a multi-region Active-Passive failover architecture for a critical database with RPO < 1 min.',
    context: 'Microsoft Enterprise Architecture & Cloud Disaster Recovery.',
    expectedSignals: 'Cross-region asynchronous replication, geo-redundant storage, health check automated DNS failover (Route 53 / Azure Traffic Manager), database promotion procedures.'
  },

  // Netflix (3 Qs)
  {
    id: 'q_ops_nflx_1',
    company: 'Netflix',
    field: 'devops',
    topic: 'Spinnaker Continuous Delivery & Automated Rollouts',
    difficulty: 'Hard',
    question: 'How does Netflix automate multi-region cloud deployments using Spinnaker pipelines with Kayenta automated canary analysis (ACA) comparing healthy baseline vs canary clusters?',
    context: 'Netflix Continuous Delivery & Cloud Infrastructure interview.',
    expectedSignals: 'Synthetic test traffic, metric statistical comparison (Mann-Whitney U-test) across CPU, error rates, latency percentiles (p99); automated termination of degraded canary.'
  },
  {
    id: 'q_ops_nflx_2',
    company: 'Netflix',
    field: 'devops',
    topic: 'Auto-Scaling Algorithms: Predictive vs Reactive',
    difficulty: 'Medium',
    question: 'Why does traditional CPU-threshold auto-scaling fail during sudden traffic surges (e.g. popular show premiere), and how do custom metrics (request queue depth) and predictive scaling solve this?',
    context: 'Netflix Elastic Infrastructure & Capacity planning round.',
    expectedSignals: 'Virtual machine boot latencies (2-5 min cooldown), scaling on leading indicators (Kafka consumer lag, incoming connection rate) rather than lagging indicators (CPU). Pre-warming.'
  },
  {
    id: 'q_ops_nflx_3',
    company: 'Netflix',
    field: 'devops',
    topic: 'Zero-Trust Network Security & Mutual TLS (mTLS)',
    difficulty: 'Hard',
    question: 'How do you implement zero-trust microservice communication using SPIFFE / SPIRE identities and automated X.509 certificate rotation for mutual TLS (mTLS) across thousands of containers?',
    context: 'Netflix Security Infrastructure & Cloud Operations round.',
    expectedSignals: 'Cryptographic workload attestation (SPIFFE ID in SAN of cert), Envoy sidecar terminating mTLS transparently, ephemeral cert renewal (every 12-24h), strict network policy enforcement.'
  },

  // Apple (3 Qs)
  {
    id: 'q_ops_appl_1',
    company: 'Apple',
    field: 'devops',
    topic: 'GitOps Workflow with ArgoCD / Flux',
    difficulty: 'Medium',
    question: 'How does a GitOps workflow enforce declarative cluster desired state? What happens when an engineer manually runs `kubectl edit` directly on a live production deployment?',
    context: 'Apple Cloud Services & Kubernetes Platform Operations.',
    expectedSignals: 'Git as single source of truth, reconciliation loop detecting drift between live cluster and Git repo, ArgoCD automated self-heal reverting manual unauthorized overrides.'
  },
  {
    id: 'q_ops_appl_2',
    company: 'Apple',
    field: 'devops',
    topic: 'TLS / SSL Handshake Optimization & ALPN',
    difficulty: 'Medium',
    question: 'Walk through the TLS 1.3 cryptographic handshake. How does it reduce connection latency to 1-RTT (or 0-RTT resumption) compared to TLS 1.2, and how does ALPN negotiate HTTP/2?',
    context: 'Apple Worldwide Services Edge Networking engineering round.',
    expectedSignals: 'Diffie-Hellman key exchange parameters sent in ClientHello alongside cipher suites, removal of insecure ciphers, session tickets for 0-RTT, ALPN extension in handshake.'
  },
  {
    id: 'q_ops_appl_3',
    company: 'Apple',
    field: 'devops',
    topic: 'Database Backup Strategies & Point-in-Time Recovery (PITR)',
    difficulty: 'Medium',
    question: 'How do Write-Ahead Logging (WAL) and continuous base snapshots enable Point-in-Time Recovery (PITR) to restore a database to 1 second before an accidental DROP TABLE occurred?',
    context: 'Apple Core Data Reliability & Storage Infrastructure.',
    expectedSignals: 'Periodic full snapshot + continuous streaming of archived WAL segments to object storage; replaying WAL transactions up to the exact transaction timestamp before the drop.'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. JAVA & SPRING BOOT ENTERPRISE
  // ═══════════════════════════════════════════════════════════════════════════
  // Amazon (3 Qs)
  {
    id: 'q_java_amzn_1',
    company: 'Amazon',
    field: 'java',
    topic: 'JVM Garbage Collection: G1GC vs ZGC Mechanics',
    difficulty: 'Hard',
    question: 'Compare G1GC with low-latency ZGC (Z Garbage Collector). How does ZGC achieve sub-millisecond stop-the-world (STW) pauses even on multi-terabyte heap allocations using colored pointers?',
    context: 'Amazon Payments & Retail Core Java services interview.',
    expectedSignals: 'Colored pointers (reference bitmask metadata), load barriers on memory dereference, concurrent marking and relocation phases eliminating long STW pauses.'
  },
  {
    id: 'q_java_amzn_2',
    company: 'Amazon',
    field: 'java',
    topic: 'Spring Boot Dependency Injection & Bean Lifecycles',
    difficulty: 'Medium',
    question: 'Explain the lifecycle of a Spring Bean from instantiation to destruction. How does Spring detect and resolve circular dependencies between `@Service` beans in Singleton scope?',
    context: 'Amazon SDE-2 Enterprise Java Services technical screen.',
    expectedSignals: 'Three-stage cache in DefaultSingletonBeanRegistry (singletonObjects, earlySingletonObjects, singletonFactories), BeanPostProcessor callbacks, `@PostConstruct` vs InitializingBean.'
  },
  {
    id: 'q_java_amzn_3',
    company: 'Amazon',
    field: 'java',
    topic: 'Java Concurrency: ConcurrentHashMap Internals',
    difficulty: 'Medium',
    question: 'How does ConcurrentHashMap achieve high concurrent read/write throughput without global synchronized locks in Java 8+? Compare CAS (Compare-And-Swap) with synchronized bucket heads.',
    context: 'Amazon High-Throughput Services SDE-2 interview.',
    expectedSignals: 'Lock-free CAS for empty bucket insertion, synchronizing only the root node of single hash bin during collision, volatile Node.val for lock-free reads, TreeBin conversion at 8 nodes.'
  },

  // Microsoft (3 Qs)
  {
    id: 'q_java_msft_1',
    company: 'Microsoft',
    field: 'java',
    topic: 'Java Memory Model (JMM) & Volatile Keyword',
    difficulty: 'Hard',
    question: 'What is the Java Memory Model happens-before guarantee? Why does `volatile` guarantee visibility and prevent instruction reordering without providing mutual exclusion (atomicity)?',
    context: 'Microsoft Cloud & Enterprise Java Infrastructure technical screen.',
    expectedSignals: 'CPU memory barriers (LoadLoad, StoreStore), flush to main memory, CPU cache coherency (MESI protocol), why `volatile int count; count++` is not thread-safe (requires AtomicInteger).'
  },
  {
    id: 'q_java_msft_2',
    company: 'Microsoft',
    field: 'java',
    topic: 'Spring Boot Transactional Propagation & Pitfalls',
    difficulty: 'Medium',
    question: 'Explain Spring `@Transactional` propagation types (REQUIRED vs REQUIRES_NEW). Why does calling a `@Transactional` method from within the same class fail to initiate a new transaction?',
    context: 'Microsoft Commerce & Billing Platform Java interview.',
    expectedSignals: 'Spring CGLIB / JDK dynamic AOP proxy interception: internal `this.method()` bypasses proxy layer; rollbackFor default on unchecked RuntimeExceptions vs checked exceptions.'
  },
  {
    id: 'q_java_msft_3',
    company: 'Microsoft',
    field: 'java',
    topic: 'Java Virtual Threads (Project Loom)',
    difficulty: 'Medium',
    question: 'How do Java 21 Virtual Threads revolutionize asynchronous programming compared to traditional 1:1 OS Platform Threads? What is thread pinning and carrier thread unmounting?',
    context: 'Microsoft Azure Core Services Java 21 adoption round.',
    expectedSignals: 'M:N lightweight user-mode threads mounted on carrier ForkJoinPool, unmounting on non-blocking I/O, thread pinning when executing synchronized blocks or native JNI calls.'
  },

  // Oracle (3 Qs)
  {
    id: 'q_java_orcl_1',
    company: 'Oracle',
    field: 'java',
    topic: 'Java ClassLoader Hierarchy & Delegation Model',
    difficulty: 'Hard',
    question: 'Explain the Parent Delegation model in Java ClassLoaders (Bootstrap, Extension/Platform, Application). How do application servers or OSGi break this model to allow hot code swapping?',
    context: 'Oracle JVM & WebLogic Core Engineering interview.',
    expectedSignals: 'Child delegates to parent first to prevent tampering with core classes (`java.lang.*`), custom `loadClass()` override for child-first loading in servlet containers, class isolation.'
  },
  {
    id: 'q_java_orcl_2',
    company: 'Oracle',
    field: 'java',
    topic: 'JPA / Hibernate N+1 Query Problem & Solutions',
    difficulty: 'Medium',
    question: 'What causes the notorious N+1 query problem in Hibernate when fetching `@OneToMany` relationships? Compare `JOIN FETCH`, `@EntityGraph`, and Batch Size (`default_batch_fetch_size`).',
    context: 'Oracle Cloud Applications Database & JPA engineering round.',
    expectedSignals: 'Lazy loading triggering individual SELECT query per child entity, JPQL `JOIN FETCH` resulting in single query, `@BatchSize(size = 50)` using SQL `IN (?, ?...)`, pagination memory risks.'
  },
  {
    id: 'q_java_orcl_3',
    company: 'Oracle',
    field: 'java',
    topic: 'Java Reflection vs MethodHandles vs Bytecode Manipulation',
    difficulty: 'Hard',
    question: 'Why is standard Java Reflection slow compared to direct method invocation? How do `MethodHandles` (JSR 292) and Bytecode manipulation (ByteBuddy/ASM) achieve near-native performance?',
    context: 'Oracle Java Language & Compiler Tools team round.',
    expectedSignals: 'Security access checks, boxing/unboxing overhead, JIT inability to inline reflective invocations; MethodHandle invocation inlining by GraalVM/HotSpot after type profiling.'
  },

  // Google (3 Qs)
  {
    id: 'q_java_goog_1',
    company: 'Google',
    field: 'java',
    topic: 'Google Guava & Immutability Patterns',
    difficulty: 'Easy',
    question: 'Why does Google mandate `ImmutableList` and `ImmutableMap` across its internal Java codebases? Compare defensive copying with unmodifiable collections (`Collections.unmodifiableList`).',
    context: 'Google Core Libraries & Shared Java Infrastructure round.',
    expectedSignals: '`unmodifiableList` is only a wrapper (if backing collection changes, view changes); immutable collections guarantee thread safety, zero synchronization overhead, and memory compaction.'
  },
  {
    id: 'q_java_goog_2',
    company: 'Google',
    field: 'java',
    topic: 'Java Generics Type Erasure & Reification',
    difficulty: 'Medium',
    question: 'Why cannot you instantiate `new T()` or `new T[10]` in Java Generics? How does Type Erasure work at bytecode level and how does Super Type Tokens (`TypeToken<T>`) capture generic types at runtime?',
    context: 'Google Android Framework & Gson team interview.',
    expectedSignals: 'Backward compatibility with pre-Java 5 JVMs, type information erased and replaced with upper bound / Object and synthetic casts inserted; anonymous inner class retaining metadata in Signature attribute.'
  },
  {
    id: 'q_java_goog_3',
    company: 'Google',
    field: 'java',
    topic: 'High-Performance Java: Memory Alignment & Off-Heap Storage',
    difficulty: 'Hard',
    question: 'How do high-frequency applications use `sun.misc.Unsafe` or `Foreign Function & Memory API` (Project Panama) to allocate memory off-heap, bypassing Garbage Collection overhead completely?',
    context: 'Google Ads High-Throughput Auction Bidding engine round.',
    expectedSignals: 'Direct byte buffers, avoiding GC pauses for multi-gigabyte caches, manual memory deallocation lifecycle, cache line padding (preventing false sharing via `@Contended`).'
  },

  // Goldman Sachs (3 Qs)
  {
    id: 'q_java_gs_1',
    company: 'Goldman Sachs',
    field: 'java',
    topic: 'LMAX Disruptor Pattern & Ring Buffers',
    difficulty: 'Hard',
    question: 'How does the LMAX Disruptor pattern achieve millions of transactions per second on single core Java systems? Explain mechanical sympathy, ring buffers, and sequence barriers.',
    context: 'Goldman Sachs Electronic Trading Platform Java interview.',
    expectedSignals: 'Pre-allocated contiguous memory ring buffer avoiding object allocations, lock-free sequence counters with CAS, cache-line padding to prevent false sharing between consumer/producer.'
  },
  {
    id: 'q_java_gs_2',
    company: 'Goldman Sachs',
    field: 'java',
    topic: 'BigDecimal vs Floating Point for Financial Calculations',
    difficulty: 'Easy',
    question: 'Why must financial monetary amounts never be represented using `double` or `float` in Java? Explain binary floating-point representation IEEE 754 and `BigDecimal.valueOf()`.',
    context: 'Goldman Sachs Risk & Pricing Core Java assessment.',
    expectedSignals: 'Inability to accurately represent decimal fractions like 0.1 in binary (results in precision accumulation error); `new BigDecimal(0.1)` vs `new BigDecimal("0.1")` or `BigDecimal.valueOf(0.1)`.'
  },
  {
    id: 'q_java_gs_3',
    company: 'Goldman Sachs',
    field: 'java',
    topic: 'Distributed Transactions & Saga Pattern in Spring Boot',
    difficulty: 'Hard',
    question: 'How do you coordinate distributed transactions across multiple microservices without Two-Phase Commit (2PC) blocking locks? Contrast Choreography vs Orchestration in the Saga pattern.',
    context: 'Goldman Sachs Transaction Banking & Clearing interview.',
    expectedSignals: 'Compensating transactions on failure, eventual consistency, event-driven choreography via Kafka vs centralized state machine orchestrator (Temporal/Camunda).'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. BEHAVIORAL & LEADERSHIP PRINCIPLES
  // ═══════════════════════════════════════════════════════════════════════════
  // Amazon (3 Qs)
  {
    id: 'q_beh_amzn_1',
    company: 'Amazon',
    field: 'behavioral',
    topic: 'Customer Obsession & Bias for Action',
    difficulty: 'Medium',
    question: 'Tell me about a time when you had to make an urgent technical decision without having all the required data. What calculated risks did you take and what was the customer outcome?',
    context: 'Amazon SDE / Engineering Manager Leadership Principles Bar Raiser.',
    expectedSignals: 'STAR method (Situation, Task, Action, Result), two-way door decision framework, customer-first metrics, quantifying business impact and learnings.'
  },
  {
    id: 'q_beh_amzn_2',
    company: 'Amazon',
    field: 'behavioral',
    topic: 'Have Backbone; Disagree and Commit',
    difficulty: 'Medium',
    question: 'Describe a situation where you strongly disagreed with a senior leader or architect on an architectural direction. How did you present your counter-evidence, and what happened after the final decision?',
    context: 'Amazon SDE-2 / SDE-3 Leadership Evaluation.',
    expectedSignals: 'Respectful and data-driven debate, focusing on system requirements rather than ego, committing 100% to team execution once a decision was finalized.'
  },
  {
    id: 'q_beh_amzn_3',
    company: 'Amazon',
    field: 'behavioral',
    topic: 'Ownership & Deep Dive (Root Cause Analysis)',
    difficulty: 'Medium',
    question: 'Tell me about a critical production outage or bug that occurred in your service. How did you diagnose the root cause using the 5 Whys, and what systemic guardrails did you put in place?',
    context: 'Amazon Correction of Error (COE) / Bar Raiser assessment.',
    expectedSignals: 'Taking personal responsibility, 5 Whys RCA, automating regression tests, preventive monitors rather than blaming individuals.'
  },

  // Google (3 Qs)
  {
    id: 'q_beh_goog_1',
    company: 'Google',
    field: 'behavioral',
    topic: 'Googliness & Navigating Ambiguity',
    difficulty: 'Medium',
    question: 'Describe a project where the initial requirements were extremely vague and stakeholders had conflicting visions. How did you navigate the ambiguity to create alignment and deliver?',
    context: 'Google Googliness & Culture Technical Fit round.',
    expectedSignals: 'Proactive requirement clarification, creating rapid prototypes or RFCs to get feedback, empathetic stakeholder collaboration, doing the right thing for users.'
  },
  {
    id: 'q_beh_goog_2',
    company: 'Google',
    field: 'behavioral',
    topic: 'Collaboration Across Diverse Global Teams',
    difficulty: 'Easy',
    question: 'Tell me about a time you worked with a cross-functional teammate (e.g. Product Manager, Designer, QA) who had a very different working style or communication friction with you.',
    context: 'Google Collaborative Engineering & Teamwork round.',
    expectedSignals: 'Active listening, seeking common goals, adapting communication style, positive conflict resolution without escalation.'
  },
  {
    id: 'q_beh_goog_3',
    company: 'Google',
    field: 'behavioral',
    topic: 'Pushing Technical Boundaries & Learning from Failure',
    difficulty: 'Medium',
    question: 'Walk through an ambitious technical initiative or prototype you championed that ultimately did not succeed or was shelved. What did you learn and how did it influence your future engineering decisions?',
    context: 'Google Innovation & Growth Mindset assessment.',
    expectedSignals: 'Intellectual humility, rapid experimentation, extracting valuable reusable learnings, celebrating courageous attempts.'
  },

  // Microsoft (3 Qs)
  {
    id: 'q_beh_msft_1',
    company: 'Microsoft',
    field: 'behavioral',
    topic: 'Growth Mindset & Adopting Unfamiliar Tech',
    difficulty: 'Easy',
    question: 'Tell me about a time you had to deliver on a critical feature using a programming language or framework you had never used before under a tight deadline. How did you ramp up?',
    context: 'Microsoft Growth Mindset & Continuous Learning evaluation.',
    expectedSignals: 'Disciplined self-learning, consulting documentation and team mentors, delivering incremental working code, turning the learning into team knowledge.'
  },
  {
    id: 'q_beh_msft_2',
    company: 'Microsoft',
    field: 'behavioral',
    topic: 'Mentorship & Elevating Others',
    difficulty: 'Medium',
    question: 'Describe an occasion where you noticed a junior engineer or intern was struggling with a complex codebase or feeling imposter syndrome. How did you support and mentor them?',
    context: 'Microsoft Senior Engineer Leadership & Inclusion interview.',
    expectedSignals: 'Empathy, pair programming, breaking tasks into manageable milestones, celebrating their independent wins, creating psychological safety.'
  },
  {
    id: 'q_beh_msft_3',
    company: 'Microsoft',
    field: 'behavioral',
    topic: 'Customer Focus & Resolving Technical Debt',
    difficulty: 'Medium',
    question: 'How do you balance pushing for clean code and refactoring accumulated technical debt against strict product feature launch deadlines demanded by business management?',
    context: 'Microsoft Engineering Excellence & Pragmatism interview.',
    expectedSignals: 'Quantifying technical debt in terms of developer velocity, incident rates, and customer latency; allocating dedicated 15-20% capacity in sprint cycles.'
  },

  // Meta (3 Qs)
  {
    id: 'q_beh_meta_1',
    company: 'Meta',
    field: 'behavioral',
    topic: 'Move Fast & Ruthless Prioritization',
    difficulty: 'Medium',
    question: 'Meta operates with a "Move Fast" philosophy. Describe a time you made a deliberate technical trade-off (e.g. cutting scope or shipping with known non-critical bugs) to hit a competitive market window.',
    context: 'Meta Cultural Fit & Speed of Execution screen.',
    expectedSignals: 'Understanding business value vs engineering perfectionism, risk containment, establishing clear post-launch cleanup tickets, tracking monitoring metrics.'
  },
  {
    id: 'q_beh_meta_2',
    company: 'Meta',
    field: 'behavioral',
    topic: 'Handling Direct Constructive Feedback',
    difficulty: 'Easy',
    question: 'Tell me about the toughest, most critical code review or performance review feedback you have ever received. How did you react emotionally and how did it change your engineering practices?',
    context: 'Meta Open Communication & Feedback interview.',
    expectedSignals: 'Receptiveness without defensiveness, separating self-worth from code, concrete behavior changes, thanking the reviewer for their investment.'
  },
  {
    id: 'q_beh_meta_3',
    company: 'Meta',
    field: 'behavioral',
    topic: 'High Agency & Solving Ambiguous Broken Systems',
    difficulty: 'Medium',
    question: 'Describe a situation where an important issue or broken internal workflow was nobody’s explicit responsibility, but you stepped up and fixed it for the whole team.',
    context: 'Meta High-Impact Ownership interview.',
    expectedSignals: 'Internal locus of control, proactive tool creation, improving team productivity, inspiring others to take initiative.'
  },

  // Netflix (3 Qs)
  {
    id: 'q_beh_nflx_1',
    company: 'Netflix',
    field: 'behavioral',
    topic: 'Freedom and Responsibility & Context Not Control',
    difficulty: 'Hard',
    question: 'Netflix culture emphasizes "Freedom and Responsibility" with minimal micro-management. Tell me about a time you operated autonomously as the single decision maker on a critical project.',
    context: 'Netflix Culture Memo & Executive Leadership interview.',
    expectedSignals: 'Seeking context actively from cross-functional peers, self-discipline, accountable for outcomes without shifting blame, high transparency.'
  },
  {
    id: 'q_beh_nflx_2',
    company: 'Netflix',
    field: 'behavioral',
    topic: 'Radical Candor & Courageous Conversations',
    difficulty: 'Medium',
    question: 'Tell me about a time you had to deliver direct, uncomfortable feedback to a peer or manager whose performance or code quality was hurting the project velocity.',
    context: 'Netflix High Performance & Radical Candor interview.',
    expectedSignals: 'Caring personally while challenging directly, timely 1-on-1 private conversation, factual examples, helping them find a path to improvement.'
  },
  {
    id: 'q_beh_nflx_3',
    company: 'Netflix',
    field: 'behavioral',
    topic: 'Keeper Test Mindset & Talent Density',
    difficulty: 'Hard',
    question: 'Netflix aims for high talent density (the "Keeper Test"). What does excellence mean to you in day-to-day engineering, and how do you hold yourself and your teammates to high standards?',
    context: 'Netflix Culture & Senior Staff round.',
    expectedSignals: 'Commitment to high quality, constructive rigor in code reviews, continuous curiosity, pride in team excellence rather than individual heroics.'
  }
];

/**
 * Filter questions by field domain and/or company
 */
export function getCatalogQuestions({ field = 'all', company = 'all', search = '' } = {}) {
  return COMPANY_QUESTION_CATALOG.filter(q => {
    if (field && field !== 'all' && q.field !== field) return false;
    if (company && company !== 'all' && q.company.toLowerCase() !== company.toLowerCase()) return false;
    if (search && search.trim()) {
      const s = search.toLowerCase();
      const match = q.question.toLowerCase().includes(s) ||
                    q.topic.toLowerCase().includes(s) ||
                    q.company.toLowerCase().includes(s) ||
                    (q.context && q.context.toLowerCase().includes(s));
      if (!match) return false;
    }
    return true;
  });
}

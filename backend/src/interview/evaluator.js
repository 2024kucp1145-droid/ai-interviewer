/**
 * Semantic Technical Evaluator & Requirement Coverage Engine
 * Rigorously evaluates candidate responses against expected technical key points and correctness criteria.
 */

// Comprehensive rubric of required technical concepts for common questions & domains
export const QUESTION_RUBRIC_MAP = {
  // Frontend
  lifecycle: {
    skill: "Component Lifecycle & State",
    required_points: [
      "Mounting, updating, and unmounting lifecycle stages",
      "State mutability and reactive re-rendering triggers",
      "Props vs State (unidirectional data flow)",
      "Hooks or state management libraries (useState, useReducer, Redux, Context API)"
    ]
  },
  performance: {
    skill: "Performance Optimization",
    required_points: [
      "Profiling tools (Chrome DevTools Profiler, React Profiler, Lighthouse)",
      "Memoization techniques (useMemo, useCallback, React.memo)",
      "Code splitting, lazy loading, and bundle optimization",
      "Minimizing DOM repaints, reflows, or virtual DOM reconciliation"
    ]
  },
  api_cache: {
    skill: "API Integration & Client Caching",
    required_points: [
      "Client-side caching strategies (SWR, TanStack React Query, Apollo Client)",
      "Optimistic UI updates with rollback on network failure",
      "Stateless HTTP status handling (4xx client vs 5xx server errors)",
      "Loading states, skeletons, and error boundaries"
    ]
  },

  // Backend & Databases
  auth: {
    skill: "Authentication & Security",
    required_points: [
      "Stateless token-based authentication (JWT, OAuth 2.0)",
      "Secure cookie transmission (HttpOnly, Secure, SameSite flags)",
      "Password hashing with salt (bcrypt, Argon2, PBKDF2)",
      "Token expiration, refresh token rotation, and invalidation strategies"
    ]
  },
  database_acid: {
    skill: "Database Concurrency & ACID",
    required_points: [
      "ACID guarantees (Atomicity, Consistency, Isolation, Durability)",
      "Transaction isolation levels (Read Committed, Repeatable Read, Serializable)",
      "Connection pooling to prevent socket exhaustion",
      "Locking mechanisms (row-level locks, optimistic vs pessimistic locking)"
    ]
  },
  microservices: {
    skill: "Microservices & Fault Tolerance",
    required_points: [
      "Asynchronous messaging (Kafka, RabbitMQ, SQS, event-driven architecture)",
      "Fault tolerance patterns (Circuit Breaker, retries with exponential backoff)",
      "Service discovery and API gateway routing",
      "Distributed tracing or idempotency keys for inter-service communication"
    ]
  },
  indexes: {
    skill: "Database Indexing & Query Optimization",
    required_points: [
      "B-tree index data structure and fast binary search lookups",
      "Tradeoff: Fast SELECT reads vs write overhead on INSERT/UPDATE",
      "Composite index column ordering (leftmost prefix rule & selectivity)",
      "Query profiling using EXPLAIN / EXPLAIN ANALYZE to identify full table scans"
    ]
  },

  // Core Languages
  python_memory: {
    skill: "Python Memory & Concurrency",
    required_points: [
      "Generators with 'yield' producing items lazily one-at-a-time",
      "Memory complexity: O(1) constant memory vs O(N) full list allocation",
      "Iterator protocol (__iter__ and __next__ methods)",
      "Global Interpreter Lock (GIL) implications on threading vs multiprocessing"
    ]
  },
  rest_api: {
    skill: "RESTful API Architecture",
    required_points: [
      "HTTP methods semantics (GET idempotent, POST non-idempotent, PUT/PATCH, DELETE)",
      "Proper HTTP status codes (200 OK, 201 Created, 400 Bad Request, 404 Not Found, 500)",
      "Stateless client-server architecture and resource-oriented URIs",
      "Data serialization (JSON) and pagination/filtering"
    ]
  },

  // HR & Management
  hr_star: {
    skill: "Behavioral & Competency Screening",
    required_points: [
      "STAR framework structure: Situation, Task, Action, Result",
      "Objective behavioral scoring rubrics to eliminate bias",
      "Assessing practical past behavior as predictor of future performance",
      "Distinguishing culture-add / competency from subjective personal rapport"
    ]
  },
  conflict: {
    skill: "Conflict Resolution & People Management",
    required_points: [
      "Private 1-on-1 mediation and active empathetic listening",
      "Root-cause analysis separating personal emotion from workflow issues",
      "Clear collaborative action plan and mutual expectations",
      "Follow-up milestones and confidential documentation"
    ]
  }
};

/**
 * Extract 3-4 essential technical requirements from any question dynamically
 */
export function extractExpectedRequirements(questionText = '', skillName = '') {
  const qLower = (questionText || '').toLowerCase();

  // 1. Check known rubric maps
  if (qLower.includes('lifecycle') || qLower.includes('state management') || qLower.includes('component')) {
    return QUESTION_RUBRIC_MAP.lifecycle.required_points;
  }
  if (qLower.includes('profiling') || qLower.includes('optimization') || qLower.includes('slow re-render')) {
    return QUESTION_RUBRIC_MAP.performance.required_points;
  }
  if (qLower.includes('caching') && (qLower.includes('api') || qLower.includes('optimistic') || qLower.includes('client-side'))) {
    return QUESTION_RUBRIC_MAP.api_cache.required_points;
  }
  if (qLower.includes('authentication') || qLower.includes('session management') || qLower.includes('stateless')) {
    return QUESTION_RUBRIC_MAP.auth.required_points;
  }
  if (qLower.includes('transaction') || qLower.includes('acid') || qLower.includes('concurrency') || qLower.includes('deadlock')) {
    return QUESTION_RUBRIC_MAP.database_acid.required_points;
  }
  if (qLower.includes('microservice') || qLower.includes('asynchronous') || qLower.includes('inter-service')) {
    return QUESTION_RUBRIC_MAP.microservices.required_points;
  }
  if (qLower.includes('index') || qLower.includes('b-tree') || qLower.includes('select query performance')) {
    return QUESTION_RUBRIC_MAP.indexes.required_points;
  }
  if (qLower.includes('generator') || qLower.includes('yield') || qLower.includes('memory consumption')) {
    return QUESTION_RUBRIC_MAP.python_memory.required_points;
  }
  if (qLower.includes('rest') || qLower.includes('http method') || qLower.includes('status code')) {
    return QUESTION_RUBRIC_MAP.rest_api.required_points;
  }
  if (qLower.includes('star method') || qLower.includes('behavioral') || qLower.includes('sourcing')) {
    return QUESTION_RUBRIC_MAP.hr_star.required_points;
  }
  if (qLower.includes('conflict') || qLower.includes('mediation') || qLower.includes('workplace')) {
    return QUESTION_RUBRIC_MAP.conflict.required_points;
  }

  // 2. Dynamic generation based on question content & skill
  return [
    `Core definition and working mechanism of ${skillName || 'the topic'}`,
    "Real-world practical implementation details and syntax/methodology",
    "Performance tradeoffs, optimization, or potential edge-case handling"
  ];
}

/**
 * Deeply analyze candidate answer for correctness and requirement coverage
 */
export function analyzeAnswerCorrectnessAndCoverage(questionText = '', answerText = '', skillName = '') {
  const ans = (answerText || '').trim();
  const ansLower = ans.toLowerCase();
  const words = ans.split(/\s+/).filter(Boolean);

  const expectedPoints = extractExpectedRequirements(questionText, skillName);
  const totalPoints = expectedPoints.length;

  // Pattern detection for refusal / evasion / empty / gibberish
  const refusalRegex = /^(no|nope|na|nahi|nahi pata|idk|i don'?t know|don'?t know|skip|pass|nothing|none|nil|n\/a|not sure|\s*|\.)$/i;
  const isRefusal = refusalRegex.test(ans) || ans.length < 5 || (words.length <= 2 && !ansLower.includes('generator') && !ansLower.includes('index'));

  if (isRefusal) {
    return {
      correctness: "Incorrect / Refusal",
      correctnessLevel: 0, // 0 = Refused/Wrong, 1 = Superficial, 2 = Partial, 3 = Accurate & Complete
      coverageScore: 0,
      coveredKeyPoints: [],
      missingKeyPoints: expectedPoints,
      technicalNotes: "Candidate refused to answer or stated 'no' without demonstrating any technical knowledge.",
      isRefusal: true
    };
  }

  // Check each expected requirement against candidate answer
  const coveredKeyPoints = [];
  const missingKeyPoints = [];

  expectedPoints.forEach(point => {
    // Extract key conceptual keywords from the point
    const keywords = point
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['with', 'from', 'this', 'that', 'when', 'what', 'have', 'using', 'into', 'under', 'over'].includes(w));

    // Check if candidate answer contains relevant keywords or conceptual synonyms
    let matchCount = 0;
    keywords.forEach(kw => {
      if (ansLower.includes(kw)) matchCount++;
    });

    const threshold = Math.max(1, Math.floor(keywords.length * 0.35));
    if (matchCount >= threshold || (keywords.some(kw => ansLower.includes(kw)) && words.length > 20)) {
      coveredKeyPoints.push(point);
    } else {
      missingKeyPoints.push(point);
    }
  });

  const coveragePercent = Math.round((coveredKeyPoints.length / totalPoints) * 100);

  // Determine correctness and technical rating
  let correctness = "Partially Correct";
  let correctnessLevel = 1;

  if (coveragePercent >= 75 && words.length >= 25) {
    correctness = "Accurate & Complete";
    correctnessLevel = 3;
  } else if (coveragePercent >= 40 && words.length >= 15) {
    correctness = "Partially Correct";
    correctnessLevel = 2;
  } else if (words.length < 12) {
    correctness = "Superficial / Incomplete";
    correctnessLevel = 1;
  } else {
    correctness = "Incomplete / Missing Key Concepts";
    correctnessLevel = 1;
  }

  const technicalNotes = coveredKeyPoints.length === totalPoints
    ? `Fully addressed all ${totalPoints} required technical concepts with clear understanding.`
    : (coveredKeyPoints.length > 0 
        ? `Partially addressed (${coveredKeyPoints.length} of ${totalPoints} required concepts). Missed: ${missingKeyPoints.map(p => p.split('(')[0].trim()).join('; ')}.`
        : `Failed to address required core technical concepts (${missingKeyPoints.length} key points missing).`);

  return {
    correctness,
    correctnessLevel,
    coverageScore: coveragePercent,
    coveredKeyPoints,
    missingKeyPoints,
    technicalNotes,
    isRefusal: false
  };
}

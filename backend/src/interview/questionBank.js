import { analyzeAnswerCorrectnessAndCoverage } from './evaluator.js';
/**
 * Comprehensive Domain & Skill Question Bank
 * Provides dynamic, role-specific questions across all 11 categories and 100+ skills
 */

// Category and Role specific question progression ladders
export const DOMAIN_QUESTION_BANK = {
  'Software & Tech': {
    frontend: [
      {
        question: "Can you explain how component lifecycle and state management work in your primary frontend framework (e.g. React, Angular, Vue)?",
        skill: "Component Architecture",
        level: 1
      },
      {
        question: "When a web application suffers from slow re-renders or sluggish UI interactions, what profiling tools and optimization techniques do you use?",
        skill: "Frontend Performance",
        level: 2
      },
      {
        question: "How do you handle client-side caching, optimistic UI updates, and error states when consuming RESTful or GraphQL APIs?",
        skill: "API Integration & State",
        level: 2
      },
      {
        question: "Could you walk me through your approach to responsive CSS layout, accessibility (WCAG), and maintaining reusable design systems?",
        skill: "CSS & Accessibility",
        level: 2
      },
      {
        question: "Have you worked on a complex frontend project recently? What was the biggest architectural tradeoff you had to make?",
        skill: "Project Deep-Dive",
        level: 3
      }
    ],
    backend: [
      {
        question: "In backend API development, how do you design secure, stateless authentication and handle session management at scale?",
        skill: "Authentication & Security",
        level: 1
      },
      {
        question: "How do you handle database transactions, connection pooling, and prevent race conditions or deadlocks under high concurrency?",
        skill: "Database Concurrency & ACID",
        level: 2
      },
      {
        question: "When designing microservices or modular backend systems, how do you handle asynchronous communication and inter-service failures?",
        skill: "Microservices & Fault Tolerance",
        level: 2
      },
      {
        question: "Could you describe a real performance bottleneck or high memory usage issue you debugged in your server code and how you resolved it?",
        skill: "Debugging & Profiling",
        level: 3
      },
      {
        question: "How do you approach automated testing (unit, integration) and safe database schema migrations in a continuous delivery pipeline?",
        skill: "Testing & CI/CD",
        level: 2
      }
    ],
    devops: [
      {
        question: "Can you walk me through how you containerize an application using Docker and optimize image build layers for production?",
        skill: "Containerization (Docker)",
        level: 1
      },
      {
        question: "In Kubernetes or cloud environments, how do you handle auto-scaling, health probes, and zero-downtime rolling deployments?",
        skill: "Kubernetes & Deployment",
        level: 2
      },
      {
        question: "How do you manage Infrastructure as Code (IaC) using tools like Terraform, and ensure secret credentials are never leaked?",
        skill: "IaC & Security",
        level: 2
      },
      {
        question: "What metrics and log monitoring strategies (e.g. Prometheus, Grafana, ELK) do you set up to detect and alert on production outages?",
        skill: "Observability & Alerting",
        level: 3
      }
    ],
    qa: [
      {
        question: "How do you determine test coverage and distinguish between critical test cases vs exploratory manual testing in an agile sprint?",
        skill: "Test Strategy & Planning",
        level: 1
      },
      {
        question: "What automation framework (e.g. Cypress, Selenium, Playwright) do you prefer, and how do you design resilient, non-flaky test scripts?",
        skill: "Test Automation",
        level: 2
      },
      {
        question: "How do you structure API automated testing, validate boundary edge cases, and integrate test suites into the CI/CD pipeline?",
        skill: "API Testing & CI/CD",
        level: 2
      }
    ],
    general: [
      {
        question: "Could you walk me through your technical background and the core technologies you use most effectively on a daily basis?",
        skill: "Technical Foundations",
        level: 1
      },
      {
        question: "How do you approach code readability, error handling, and writing self-documenting code when collaborating with a team?",
        skill: "Code Quality",
        level: 2
      },
      {
        question: "When faced with an unexpected production bug or edge case, what is your systematic troubleshooting process?",
        skill: "Problem Solving",
        level: 2
      },
      {
        question: "Could you describe a technical project you built recently and the key engineering challenges you solved?",
        skill: "Practical Experience",
        level: 3
      }
    ]
  },

  'Data, AI & Analytics': {
    general: [
      {
        question: "In your data workflows, how do you approach data cleaning, handling missing values, and detecting anomalies in raw datasets?",
        skill: "Data Cleaning & Wrangling",
        level: 1
      },
      {
        question: "Can you explain the difference between window functions and group-by aggregations in SQL, with a practical business use case?",
        skill: "Advanced SQL",
        level: 2
      },
      {
        question: "When building predictive models or analytics dashboards, how do you evaluate model performance and avoid data leakage or overfitting?",
        skill: "Model Validation & Metrics",
        level: 2
      },
      {
        question: "How do you translate complex analytical insights or machine learning predictions into actionable recommendations for non-technical stakeholders?",
        skill: "Business Translation & Storytelling",
        level: 2
      },
      {
        question: "Could you describe a data pipeline or machine learning project you worked on and how you handled data quality issues?",
        skill: "Project Deep-Dive",
        level: 3
      }
    ]
  },

  'Security & Networking': {
    general: [
      {
        question: "Can you explain the principles of Zero Trust Architecture and how least-privilege access is enforced across enterprise networks?",
        skill: "Security Architecture",
        level: 1
      },
      {
        question: "Walk me through how you identify and mitigate the most common web application vulnerabilities, such as SQL Injection or Cross-Site Scripting (XSS).",
        skill: "Vulnerability Assessment",
        level: 2
      },
      {
        question: "In network troubleshooting, how do you analyze packet captures (e.g. Wireshark) and trace routing or DNS resolution failures?",
        skill: "Network Diagnostics",
        level: 2
      },
      {
        question: "If a security incident or anomalous spike in failed authentications occurs, what is your step-by-step incident response playbook?",
        skill: "Incident Response",
        level: 3
      }
    ]
  },

  'Design & Creative': {
    general: [
      {
        question: "Can you walk me through your end-to-end design process, from initial user research and wireframing to high-fidelity prototypes in Figma?",
        skill: "Design Process & Figma",
        level: 1
      },
      {
        question: "How do you establish and maintain a cohesive Design System, ensuring components are reusable, accessible (WCAG), and easily handed off to engineers?",
        skill: "Design Systems & Accessibility",
        level: 2
      },
      {
        question: "When user feedback or usability testing contradicts your initial design assumptions, how do you iterate and make data-informed design pivots?",
        skill: "User Research & Iteration",
        level: 2
      },
      {
        question: "Could you describe a recent UI/UX or creative project from your portfolio and explain the core problem you solved for the user?",
        skill: "Portfolio Deep-Dive",
        level: 3
      }
    ]
  },

  'Marketing & Content': {
    general: [
      {
        question: "How do you conduct keyword intent research and balance search engine technical optimization (SEO) with engaging, high-conversion copy?",
        skill: "SEO & Content Strategy",
        level: 1
      },
      {
        question: "In paid digital marketing campaigns (Google Ads / Meta Ads), what metrics do you prioritize to optimize ROAS and lower customer acquisition costs (CAC)?",
        skill: "Performance Marketing & ROAS",
        level: 2
      },
      {
        question: "How do you structure A/B split tests for landing pages, ad creatives, or email subject lines to statistically validate what drives higher engagement?",
        skill: "Conversion Rate Optimization (CRO)",
        level: 2
      },
      {
        question: "Can you share an example of a successful marketing campaign or piece of content you spearheaded that delivered measurable business results?",
        skill: "Campaign Case Study",
        level: 3
      }
    ]
  },

  'Sales & Business': {
    general: [
      {
        question: "How do you qualify prospective leads in your sales pipeline (e.g. BANT framework) before investing significant demonstration time?",
        skill: "Lead Qualification",
        level: 1
      },
      {
        question: "When a prospective client pushes back on pricing or claims they are already satisfied with a competitor, what is your approach to handling objections?",
        skill: "Objection Handling",
        level: 2
      },
      {
        question: "How do you balance high-volume outbound prospecting with building deep, consultative trust needed to close enterprise contracts?",
        skill: "Consultative Selling & Closing",
        level: 2
      },
      {
        question: "Could you walk me through your most challenging sales deal or client retention scenario and how you brought it to a successful close?",
        skill: "Deal Negotiation Case Study",
        level: 3
      }
    ]
  },

  'HR & Management': {
    general: [
      {
        question: "In technical and talent recruitment, what boolean sourcing strategies and candidate evaluation criteria do you use to identify top-tier talent?",
        skill: "Talent Sourcing & Screening",
        level: 1
      },
      {
        question: "How do you conduct structured behavioral interviews using the STAR method (Situation, Task, Action, Result) to objectively assess culture fit and competencies?",
        skill: "Behavioral Interviewing (STAR)",
        level: 2
      },
      {
        question: "When resolving workplace conflicts or employee grievances, how do you balance company policies and labor compliance with empathy and fairness?",
        skill: "Employee Relations & Compliance",
        level: 2
      },
      {
        question: "What metrics (e.g. Time-to-Hire, Cost-per-Hire, Retention Rate, eNPS) do you track to measure the effectiveness of your people operations?",
        skill: "HR Metrics & People Strategy",
        level: 3
      }
    ]
  },

  'Finance & Legal': {
    general: [
      {
        question: "In financial accounting and compliance, how do you ensure accurate general ledger reconciliation and adherence to statutory reporting standards?",
        skill: "Accounting & Statutory Compliance",
        level: 1
      },
      {
        question: "When constructing financial models (DCF, sensitivity analysis, budget forecasting), how do you validate your key assumptions and stress-test risk variables?",
        skill: "Financial Modeling & Valuation",
        level: 2
      },
      {
        question: "In contract negotiation or legal risk assessment, what critical clauses (indemnification, limitation of liability, IP rights) require the closest scrutiny?",
        skill: "Contractual Due Diligence",
        level: 2
      },
      {
        question: "Could you describe an audit discrepancy, complex tax scenario, or compliance review you successfully navigated?",
        skill: "Financial/Legal Case Study",
        level: 3
      }
    ]
  },

  'Operations & Core Engineering': {
    general: [
      {
        question: "In supply chain and manufacturing operations, how do you minimize inventory holding costs while avoiding stockouts or production delays (JIT)?",
        skill: "Supply Chain & Inventory",
        level: 1
      },
      {
        question: "How do you enforce quality control (QC), root-cause analysis (e.g. 5 Whys, Fishbone), and ISO/safety standards in day-to-day operations?",
        skill: "Quality Assurance & Six Sigma",
        level: 2
      },
      {
        question: "Can you walk me through how you interpret technical schematics, manage vendor procurement, and coordinate cross-functional engineering deliverables?",
        skill: "Engineering Project Execution",
        level: 2
      }
    ]
  },

  'Education, Healthcare & Others': {
    general: [
      {
        question: "How do you design lesson curricula or healthcare patient plans that adapt effectively to individuals with differing learning speeds or requirements?",
        skill: "Curriculum / Patient Planning",
        level: 1
      },
      {
        question: "When dealing with a stressful scenario, concerned parent, or critical patient inquiry, how do you maintain professional empathy and clear communication?",
        skill: "Empathy & Stakeholder Communication",
        level: 2
      },
      {
        question: "How do you ensure strict adherence to institutional safety standards, privacy ethics, and regulatory compliance in your practice?",
        skill: "Ethics & Compliance",
        level: 2
      }
    ]
  },

  'Non-job Interviews': {
    general: [
      {
        question: "Could you introduce yourself, explain what motivated you to apply for this opportunity, and why you feel this is the right next step for your growth?",
        skill: "Introduction & Motivation",
        level: 1
      },
      {
        question: "Can you share a specific situation where you encountered a significant setback or failure, and what concrete steps you took to overcome it?",
        skill: "Resilience & Problem Solving",
        level: 2
      },
      {
        question: "How do you prioritize competing deadlines, handle high-pressure environments, and collaborate effectively with diverse viewpoints?",
        skill: "Time Management & Teamwork",
        level: 2
      },
      {
        question: "Where do you envision your career or project in the next three to five years, and how does this engagement help you get there?",
        skill: "Vision & Long-Term Goals",
        level: 2
      }
    ]
  }
};

/**
 * Generate adaptive question tailored to role, category, skills, leetcode, and candidate response history
 */
export function generateAdaptiveQuestion({ role, category, skills, leetcode, candidateTurnIndex = 0, lastAnswer = '', resumeSummary = '' }) {
  const normCategory = category || 'Software & Tech';
  const catBank = DOMAIN_QUESTION_BANK[normCategory] || DOMAIN_QUESTION_BANK['Software & Tech'];

  // Check if role is frontend, backend, devops, or general
  let ladder = null;
  const roleLower = (role || '').toLowerCase();
  if (normCategory === 'Software & Tech') {
    if (roleLower.includes('front') || roleLower.includes('react') || roleLower.includes('angular') || roleLower.includes('vue') || roleLower.includes('ui')) {
      ladder = catBank.frontend;
    } else if (roleLower.includes('back') || roleLower.includes('node') || roleLower.includes('python') || roleLower.includes('java') || roleLower.includes('go')) {
      ladder = catBank.backend;
    } else if (roleLower.includes('devops') || roleLower.includes('cloud') || roleLower.includes('sre') || roleLower.includes('infra')) {
      ladder = catBank.devops;
    } else if (roleLower.includes('qa') || roleLower.includes('test')) {
      ladder = catBank.qa;
    } else {
      ladder = catBank.general;
    }
  } else {
    ladder = catBank.general || DOMAIN_QUESTION_BANK['Software & Tech'].general;
  }

  // DSA Problem specific progression if LeetCode problem attached
  if (leetcode && (candidateTurnIndex === 1 || candidateTurnIndex === 2)) {
    const probName = leetcode || 'the coding challenge';
    if (candidateTurnIndex === 1) {
      return {
        question: `Here is your coding challenge: ${probName}. Please open your online compiler on the right, implement your solution, and run your test cases against our automated judge.`,
        skill: "LeetCode DSA Challenge",
        level: 2
      };
    } else if (candidateTurnIndex === 2) {
      return {
        question: `For ${probName}, what are the expected time and space complexities (Big-O) of your solution, and what edge cases (such as empty inputs or boundary limits) did you consider?`,
        skill: "Algorithmic Complexity & Edge Cases",
        level: 3
      };
    }
  }

  // If candidate mentioned specific skills in the job specification, customize the question
  const skillItems = (skills || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (skillItems.length > 0 && candidateTurnIndex < skillItems.length) {
    const targetSkill = skillItems[candidateTurnIndex % skillItems.length];
    
    // Customize question by skill type
    const customQuestions = {
      // Tech skills
      'React': "In React, how do you decide between using local state (useState/useReducer) versus external state stores (Redux, Zustand), and how do you prevent unnecessary re-renders?",
      'Node.js': "In Node.js, how does the asynchronous Event Loop handle CPU-heavy operations without blocking incoming I/O requests?",
      'Python': "In Python, how do generator functions with 'yield' optimize memory consumption compared to returning standard lists, and where have you used them?",
      'SQL': "In relational databases, what is the impact of indexes on SELECT query performance versus INSERT/UPDATE write latency, and how do you choose composite index columns?",
      'Docker': "How do you structure multi-stage Dockerfiles to minimize final production container sizes and keep build dependencies separate?",
      'AWS': "On AWS, how do you architect high availability across multiple Availability Zones while keeping cloud resource costs under control?",
      'TypeScript': "What are the benefits of using Discriminated Unions and generics in TypeScript to prevent runtime type errors in complex payloads?",
      'Git': "In team Git workflows, how do you handle rebasing versus merging feature branches, and how do you resolve complex merge conflicts cleanly?",
      
      // Data skills
      'Machine Learning': "When training a model with an imbalanced dataset, why can accuracy be misleading, and what alternative evaluation metrics and sampling methods do you use?",
      'Power BI': "In Power BI or Tableau, how do you optimize DAX formulas or data models to ensure executive dashboards render sub-second queries?",
      
      // Design skills
      'Figma': "In Figma, how do you utilize Auto-Layout, variant properties, and design tokens to create components that scale smoothly across mobile and desktop breakpoints?",
      'UI/UX Design': "How do you conduct usability testing sessions, and how do you prioritize design changes when users face friction in your user journey?",
      
      // Marketing skills
      'SEO': "How do you optimize Core Web Vitals (LCP, FID, CLS) and structured schema markup to improve search rankings and rich snippet visibility on Google?",
      'Google Ads': "In performance marketing, how do you structure audience retargeting and negative keyword lists to maximize ROAS?",
      
      // HR skills
      'Technical Recruiting': "How do you evaluate candidates on cultural alignment and problem-solving mindset rather than just memorized resume buzzwords?",
      'Employee Relations': "Can you share how you handle a performance improvement plan (PIP) with transparency while supporting the employee's development?"
    };

    if (customQuestions[targetSkill]) {
      return {
        question: customQuestions[targetSkill],
        skill: targetSkill,
        level: 2
      };
    }
  }

  // Safe fallback to progression ladder
  const idx = Math.min(candidateTurnIndex, ladder.length - 1);
  const base = ladder[idx];

  // If candidate gave a good answer in the previous turn, add a brief transition
  let transition = "";
  if (lastAnswer && lastAnswer.length > 30) {
    transition = "Thank you for that explanation. ";
  }

  return {
    question: `${transition}${base.question}`,
    skill: base.skill,
    level: base.level
  };
}

/**
 * Return an ordered list of planned questions for a role preview
 */
export function getPlannedQuestions({ role = '', category = 'Software & Tech', skills = '', leetcode = '', maxQuestions = 6, customQuestions = '' }) {
  const customList = (customQuestions || '')
    .split('\n')
    .map(q => q.trim())
    .filter(Boolean);

  if (customList.length > 0) {
    return customList.slice(0, parseInt(maxQuestions, 10) || 6).map((q, idx) => ({
      index: idx + 1,
      question: q,
      skill: 'Custom Screening Question',
      level: 2
    }));
  }

  const planned = [];
  const total = Math.min(Math.max(parseInt(maxQuestions, 10) || 6, 2), 25);

  for (let i = 0; i < total; i++) {
    const qObj = generateAdaptiveQuestion({
      role,
      category,
      skills,
      leetcode,
      candidateTurnIndex: i,
      lastAnswer: ''
    });

    // Ensure questions are unique
    if (!planned.some(p => p.question === qObj.question)) {
      planned.push({
        index: planned.length + 1,
        question: qObj.question,
        skill: qObj.skill,
        level: qObj.level
      });
    } else {
      const catBank = DOMAIN_QUESTION_BANK[category] || DOMAIN_QUESTION_BANK['Software & Tech'];
      const ladder = catBank.general || DOMAIN_QUESTION_BANK['Software & Tech'].general;
      const fallback = ladder[i % ladder.length];
      planned.push({
        index: planned.length + 1,
        question: fallback.question,
        skill: fallback.skill,
        level: fallback.level
      });
    }
  }

  return planned;
}

/**
 * Generate intelligent follow-up question (max 1-2 per main topic)
 */
export function generateFollowUpQuestion({ lastQuestion = '', lastAnswer = '', skill = 'General', followUpCount = 0 }) {
  if (followUpCount >= 2) return null; // Maximum 2 follow-ups reached

  const analysis = analyzeAnswerCorrectnessAndCoverage(lastQuestion, lastAnswer, skill);

  // Case 1: Candidate refused, said "no", or gave an empty non-answer
  if (analysis.isRefusal) {
    if (followUpCount === 0) {
      return {
        question: `No worries at all. Could you share your high-level thoughts on the concept, or how you would research it on the job?`,
        skill: `${skill} (Foundational Check)`,
        level: 2,
        isFollowUp: true
      };
    }
    return null; // Don't ask multiple follow-ups if candidate repeatedly refuses
  }

  // Case 2: Candidate answered partially, but missed critical required concepts
  if (analysis.missingKeyPoints && analysis.missingKeyPoints.length > 0 && followUpCount === 0) {
    const missingTopic = analysis.missingKeyPoints[0].split('(')[0].trim();
    const humanIntros = [
      `That makes sense, but how would you specifically address ${missingTopic.toLowerCase()} in a production environment?`,
      `Got it. Could you walk me through your thinking around ${missingTopic.toLowerCase()}?`,
      `Interesting point. How would you handle ${missingTopic.toLowerCase()} if this was deployed live?`,
      `Understood. If you had to dive deeper into ${missingTopic.toLowerCase()}, what would your approach be?`
    ];
    const pickedIntro = humanIntros[Math.floor(Math.random() * humanIntros.length)];
    return {
      question: pickedIntro,
      skill: `${skill} (Missing Requirement Check)`,
      level: 2,
      isFollowUp: true
    };
  }

  // Case 3: Candidate covered requirements well, ask deep-dive on tradeoffs / scale
  if (followUpCount === 0 && analysis.coverageScore >= 60) {
    const deepDives = [
      `What potential performance trade-offs, edge cases, or failure modes would you consider with that approach?`,
      `How would you test and validate that implementation to guarantee high reliability in production?`,
      `If system load or data volume scaled up significantly, what adjustments or optimizations would you make?`
    ];
    const picked = deepDives[Math.floor(Math.random() * deepDives.length)];
    return {
      question: picked,
      skill: `${skill} (Tradeoffs & Scale)`,
      level: 3,
      isFollowUp: true
    };
  }

  return null;
}


import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

// Comprehensive technical and professional skill catalog
const SKILL_CATALOG = [
  // Programming Languages
  { name: 'JavaScript', aliases: ['javascript', 'js', 'es6', 'ecmascript'] },
  { name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { name: 'Python', aliases: ['python', 'py'] },
  { name: 'Java', aliases: ['java', 'core java'] },
  { name: 'C++', aliases: ['c++', 'cpp'] },
  { name: 'C', aliases: ['\\bc\\b'] },
  { name: 'C#', aliases: ['c#', 'csharp', '.net'] },
  { name: 'Go', aliases: ['golang', '\\bgo\\b'] },
  { name: 'Rust', aliases: ['rust'] },
  { name: 'PHP', aliases: ['php'] },
  { name: 'Ruby', aliases: ['ruby', 'rails', 'ruby on rails'] },
  { name: 'Swift', aliases: ['swift', 'ios'] },
  { name: 'Kotlin', aliases: ['kotlin', 'android'] },
  { name: 'SQL', aliases: ['sql', 't-sql', 'pl/sql'] },
  { name: 'HTML5', aliases: ['html', 'html5'] },
  { name: 'CSS3', aliases: ['css', 'css3', 'scss', 'sass'] },
  { name: 'Bash / Shell', aliases: ['bash', 'shell script', 'powershell', 'zsh'] },

  // Frontend & UI
  { name: 'React', aliases: ['react', 'react.js', 'reactjs'] },
  { name: 'Next.js', aliases: ['next.js', 'nextjs'] },
  { name: 'Angular', aliases: ['angular', 'angularjs'] },
  { name: 'Vue.js', aliases: ['vue', 'vue.js', 'vuejs'] },
  { name: 'Redux', aliases: ['redux', 'redux toolkit'] },
  { name: 'Tailwind CSS', aliases: ['tailwind', 'tailwindcss'] },
  { name: 'Bootstrap', aliases: ['bootstrap'] },
  { name: 'Webpack / Vite', aliases: ['webpack', 'vite'] },

  // Backend & Frameworks
  { name: 'Node.js', aliases: ['node', 'node.js', 'nodejs'] },
  { name: 'Express.js', aliases: ['express', 'express.js'] },
  { name: 'Django', aliases: ['django'] },
  { name: 'FastAPI', aliases: ['fastapi'] },
  { name: 'Flask', aliases: ['flask'] },
  { name: 'Spring Boot', aliases: ['spring', 'spring boot'] },
  { name: 'NestJS', aliases: ['nestjs'] },
  { name: 'GraphQL', aliases: ['graphql'] },
  { name: 'REST APIs', aliases: ['rest', 'rest api', 'restful', 'apis'] },
  { name: 'Microservices', aliases: ['microservices', 'microservice'] },

  // Databases
  { name: 'PostgreSQL', aliases: ['postgres', 'postgresql'] },
  { name: 'MongoDB', aliases: ['mongodb', 'mongo'] },
  { name: 'MySQL', aliases: ['mysql'] },
  { name: 'Redis', aliases: ['redis'] },
  { name: 'SQLite', aliases: ['sqlite'] },
  { name: 'Elasticsearch', aliases: ['elasticsearch', 'elk'] },
  { name: 'Firebase', aliases: ['firebase', 'firestore'] },

  // Cloud & DevOps
  { name: 'AWS', aliases: ['aws', 'amazon web services', 'ec2', 's3', 'lambda'] },
  { name: 'Azure', aliases: ['azure'] },
  { name: 'Google Cloud (GCP)', aliases: ['gcp', 'google cloud'] },
  { name: 'Docker', aliases: ['docker', 'containerization'] },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'] },
  { name: 'CI/CD', aliases: ['ci/cd', 'github actions', 'jenkins', 'gitlab ci'] },
  { name: 'Terraform', aliases: ['terraform'] },
  { name: 'Linux', aliases: ['linux', 'ubuntu', 'centos', 'debian'] },
  { name: 'Git', aliases: ['git', 'github', 'gitlab'] },

  // Core CS, Architecture & Testing
  { name: 'Data Structures', aliases: ['data structures', 'dsa'] },
  { name: 'Algorithms', aliases: ['algorithms', 'problem solving', 'dynamic programming'] },
  { name: 'System Design', aliases: ['system design', 'distributed systems', 'scalability'] },
  { name: 'Object-Oriented Programming (OOP)', aliases: ['oop', 'object oriented'] },
  { name: 'Unit Testing', aliases: ['jest', 'mocha', 'junit', 'pytest', 'unit testing'] },
  { name: 'Selenium / Cypress', aliases: ['selenium', 'cypress', 'automation testing'] },

  // AI & Data Science
  { name: 'Machine Learning', aliases: ['machine learning', 'ml', 'scikit-learn'] },
  { name: 'Deep Learning', aliases: ['deep learning', 'pytorch', 'tensorflow', 'keras'] },
  { name: 'Pandas / NumPy', aliases: ['pandas', 'numpy'] },
  { name: 'NLP', aliases: ['nlp', 'natural language processing'] },
  { name: 'LLMs / Prompt Engineering', aliases: ['llm', 'llms', 'prompt engineering', 'langchain', 'openai'] },
  { name: 'Power BI / Tableau', aliases: ['power bi', 'tableau', 'data visualization'] },

  // Product, Design & Management
  { name: 'UI/UX Design', aliases: ['ui/ux', 'ux design', 'ui design', 'wireframing'] },
  { name: 'Figma', aliases: ['figma', 'adobe xd'] },
  { name: 'Agile / Scrum', aliases: ['agile', 'scrum', 'jira', 'kanban'] },
  { name: 'Cybersecurity', aliases: ['cybersecurity', 'penetration testing', 'kali linux', 'owasp'] }
];

/**
 * Extract raw text from buffer (PDF or plain text)
 */
export async function extractTextFromBuffer(buffer, mimeType = 'application/pdf') {
  if (mimeType === 'text/plain') {
    return buffer.toString('utf8');
  }

  // PDF extraction
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text || '';
  } catch (err) {
    // If PDF parse fails, try fallback string conversion
    const raw = buffer.toString('utf8');
    const cleaned = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ');
    if (cleaned.length > 100) return cleaned;
    throw new Error('Failed to extract text from PDF: ' + err.message);
  }
}

/**
 * Intelligent Resume Information Parser (Rule-based + AI Heuristics)
 */
export function parseResumeText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      name: '',
      email: '',
      phone: '',
      experienceYears: '0-1 Yrs',
      skills: [],
      education: [],
      projects: [],
      summary: ''
    };
  }

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // 1. Extract Email
  const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
  const email = emailMatch ? emailMatch[0].toLowerCase() : '';

  // 2. Extract Phone
  const phoneMatch = rawText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+?91[-.\s]?[6-9]\d{9}|\b\d{10}\b/);
  const phone = phoneMatch ? phoneMatch[0] : '';

  // 3. Extract Candidate Name
  let name = '';
  // Look in the first 8 lines for a clean human name (not containing email, http, or resume keywords)
  const headerLines = lines.slice(0, 8);
  for (const line of headerLines) {
    const clean = line.replace(/^(name|resume|curriculum vitae|cv|profile)\s*[:\-\.]\s*/i, '').trim();
    if (
      clean.length >= 3 &&
      clean.length <= 40 &&
      !clean.includes('@') &&
      !clean.includes('http') &&
      !clean.includes('/') &&
      !clean.toLowerCase().includes('curriculum') &&
      !clean.toLowerCase().includes('resume') &&
      /^[a-zA-Z\s\.\'-]+$/.test(clean) &&
      clean.split(/\s+/).length >= 2 &&
      clean.split(/\s+/).length <= 4
    ) {
      name = clean;
      break;
    }
  }

  // Fallback name: if no multi-word line found, try first non-empty clean line
  if (!name && headerLines.length > 0) {
    const firstLine = headerLines[0].replace(/[^a-zA-Z\s]/g, '').trim();
    if (firstLine.length >= 3 && firstLine.length <= 35) {
      name = firstLine;
    }
  }

  // 4. Extract Skills
  const detectedSkills = [];
  const lowerText = rawText.toLowerCase();

  for (const skill of SKILL_CATALOG) {
    for (const alias of skill.aliases) {
      const isWordBoundary = alias.startsWith('\\b') || alias.endsWith('\\b');
      const pattern = isWordBoundary
        ? new RegExp(alias, 'i')
        : new RegExp(`(?:\\b|(?<=\\W))${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|(?=\\W))`, 'i');

      if (pattern.test(lowerText)) {
        if (!detectedSkills.includes(skill.name)) {
          detectedSkills.push(skill.name);
        }
        break;
      }
    }
  }

  // 5. Extract Education
  const education = [];
  const eduKeywords = [
    'B.Tech', 'B.E.', 'Bachelor of Technology', 'Bachelor of Engineering',
    'M.Tech', 'M.E.', 'Master of Technology',
    'BCA', 'MCA', 'B.Sc', 'M.Sc', 'Bachelor of Science', 'Master of Science',
    'MBA', 'B.Com', 'Diploma', 'Ph.D'
  ];

  for (const kw of eduKeywords) {
    const pattern = new RegExp(`(?:\\b|(?<=\\W))${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|(?=\\W))`, 'i');
    if (pattern.test(rawText)) {
      if (!education.includes(kw)) {
        education.push(kw);
      }
    }
  }

  // 6. Experience Estimation
  let experienceYears = '0-1 Yrs';
  const expMatch = rawText.match(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)(?:\s+of)?\s+experience/i);
  if (expMatch) {
    const yrs = parseFloat(expMatch[1]);
    if (yrs >= 5) experienceYears = '5+ Yrs';
    else if (yrs >= 3) experienceYears = '3-5 Yrs';
    else if (yrs >= 1) experienceYears = '1-3 Yrs';
    else experienceYears = '0-1 Yrs';
  } else {
    // Check year ranges like 2021-2024
    const yearMatches = rawText.match(/\b(20[0-2][0-9])\s*[-–to]+\s*(20[0-2][0-9]|present)\b/gi);
    if (yearMatches && yearMatches.length > 0) {
      if (yearMatches.length >= 3) experienceYears = '3-5 Yrs';
      else if (yearMatches.length >= 2) experienceYears = '1-3 Yrs';
      else experienceYears = '0-1 Yrs';
    }
  }

  // 7. Project & Role Highlights Extraction
  const projects = [];
  let inProjects = false;
  let inExperience = false;
  const rawLines = rawText.split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    if (/^(projects|academic projects|key projects|personal projects)\b/i.test(line)) {
      inProjects = true;
      inExperience = false;
      continue;
    }
    if (/^(experience|work experience|employment history|internships)\b/i.test(line)) {
      inExperience = true;
      inProjects = false;
      continue;
    }
    if (/^(education|skills|certifications|awards|interests)\b/i.test(line)) {
      inProjects = false;
      inExperience = false;
      continue;
    }

    if (inProjects && projects.length < 4) {
      if (line.length >= 8 && line.length <= 80 && !line.startsWith('http')) {
        const cleanProj = line.replace(/^[\-\*•\d\.]+\s*/, '').trim();
        if (cleanProj && !projects.includes(cleanProj)) {
          projects.push(cleanProj);
        }
      }
    }
  }

  // 8. Generate Structured Interview Context Summary
  const summaryParts = [];
  if (name) summaryParts.push(`Candidate: ${name}`);
  if (experienceYears) summaryParts.push(`Experience Level: ${experienceYears}`);
  if (education.length) summaryParts.push(`Education: ${education.join(', ')}`);
  if (detectedSkills.length) summaryParts.push(`Core Skills: ${detectedSkills.slice(0, 15).join(', ')}`);
  if (projects.length) summaryParts.push(`Key Projects / Claims: ${projects.join('; ')}`);

  const summary = summaryParts.join(' | ');

  return {
    name: name || 'Candidate',
    email,
    phone,
    experienceYears,
    skills: detectedSkills,
    education,
    projects,
    summary,
    rawTextLength: rawText.length
  };
}

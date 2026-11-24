require('dotenv').config();
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const SECRET_KEY = process.env.JWT_SECRET;

const GUEST_MAX_DOWNLOADS = 5;
const MEMBER_MAX_DOWNLOADS = 10;

const BOOK_CATEGORIES = [
  'Fiction',
  'Romance',
  'Adventure & Mystery',
  'Fantasy & Myth',
  'Poetry & Drama',
  'History & Biography',
  'Philosophy & Society',
  'Science & Nature',
  'General Classics'
];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing from backend/.env');
  process.exit(1);
}

if (!SECRET_KEY || SECRET_KEY.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-guest-token']
}));

app.use(express.json({ limit: '1mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000
});

function stripAssignedTagText(value) {
  return String(value || '')
    .replace(/Public-domain edition\s*\([^)]*\)\.\s*/gi, '')
    .replace(/\(?(?:Public-domain edition\s*)?\((?:Fiction|Romance|Adventure & Mystery|Fantasy & Myth|Poetry & Drama|History & Biography|Philosophy & Society|Science & Nature|General Classics|Literature & Fiction|Computer Science|Data Science|Cybersecurity|Web Development|Analytics|General & Reference)\)\)?/gi, '')
    .replace(/\b(?:Literature & Fiction|Computer Science|Data Science|Cybersecurity|Web Development|Analytics|General & Reference)\b/gi, '')
    .trim();
}

function normalizeBookCategory(book) {
  const title = String(book?.title || '').trim();
  const author = String(book?.author || '').trim();
  const cleanDesc = stripAssignedTagText(book?.description || '');
  const rawCat = String(book?.category || '').trim();
  const combined = `${title} ${author} ${cleanDesc} ${rawCat}`.toLowerCase();

  if (/\b(romance|courtship|love stories|marriage)\b/.test(combined)) {
    return 'Romance';
  }
  if (/\b(fantasy|fairy tales|magic|mythology|dragons|alice)\b/.test(combined)) {
    return 'Fantasy & Myth';
  }
  if (/\b(adventure|sea stories|voyages|pirates|detective|mystery|thriller|horror|gothic|frankenstein|moby dick)\b/.test(combined)) {
    return 'Adventure & Mystery';
  }
  if (/\b(poetry|poems|drama|plays|theater|theatre|sonnets)\b/.test(combined)) {
    return 'Poetry & Drama';
  }
  if (/\b(history|historical|biography|memoirs|autobiography|war|military|kings and rulers)\b/.test(combined)) {
    return 'History & Biography';
  }
  if (/\b(philosophy|ethics|logic|religion|theology|politics|government|law|society|economics)\b/.test(combined)) {
    return 'Philosophy & Society';
  }
  if (/\b(science|mathematics|physics|chemistry|astronomy|biology|botany|zoology|nature)\b/.test(combined)) {
    return 'Science & Nature';
  }
  if (/\b(fiction|novels|short stories|literature|classics|pride and prejudice)\b/.test(combined)) {
    return 'Fiction';
  }

  if (BOOK_CATEGORIES.includes(rawCat)) {
    return rawCat;
  }

  return 'General Classics';
}

function escapePdfText(text) {
  return String(text || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapTextLines(text, maxChars = 78) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxChars) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function extractRealBookChapters(fullText) {
  const cleanText = String(fullText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\*\*\*\s*START OF[\s\S]*?\*\*\*/i, '')
    .split(/\*\*\*\s*END OF/i)[0]
    .trim();

  if (cleanText.length <= 100) return null;

  const rawBlocks = cleanText
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 20);

  const paragraphs = rawBlocks.length >= 4
    ? rawBlocks
    : (cleanText.replace(/\s+/g, ' ').match(/.{1,550}(\s|$)/g) || [])
        .map((s) => s.trim())
        .filter(Boolean);

  const targetChapters = 8;
  const perChapter = Math.max(12, Math.ceil(paragraphs.length / targetChapters));
  const chapters = [];

  for (let i = 0; i < paragraphs.length; i += perChapter) {
    const slice = paragraphs.slice(i, i + perChapter);
    const headingMatch = slice[0]?.match(/^(CHAPTER|BOOK|PART|SECTION)\s+[IVXLCDM0-9]+[:.\-\s]*([^\n]{0,50})/i);
    chapters.push({
      number: chapters.length + 1,
      title: headingMatch ? headingMatch[0].trim() : `Chapter ${chapters.length + 1}`,
      paragraphs: slice
    });
  }

  return chapters.length > 0 ? chapters : null;
}

function buildBookChapters(book) {
  const title = book?.title || 'Untitled Book';
  const author = book?.author || 'Unknown Author';
  const category = normalizeBookCategory(book);
  const description =
    stripAssignedTagText(book?.description) ||
    `An extended book-length study and reference edition covering ${category} themes, structure, characters, and ideas.`;

  const realChapters = extractRealBookChapters(book?.full_text);
  if (realChapters) {
    return realChapters;
  }

  const trackNotes = {
    Fiction: {
      focus: 'character motivation, plot progression, setting, narrative voice, and thematic motifs',
      scenario: 'following how key figures navigate relationships, choices, and turning points across a narrative',
      edgeCase: 'shifting points of view, implied subtext, subplots, and unresolved tensions',
      exercise: 'Summarize the main conflict in each chapter and note how the setting shapes character decisions.'
    },
    Romance: {
      focus: 'emotional arcs, courtship dynamics, social expectations, misunderstandings, and resolution',
      scenario: 'tracing how characters grow closer or apart as personal feelings meet social norms',
      edgeCase: 'miscommunication, class or family barriers, delayed realizations, and competing loyalties',
      exercise: 'Track how misunderstandings build and how honest dialogue shifts the central relationship.'
    },
    'Adventure & Mystery': {
      focus: 'pacing, suspense, clues, perilous journeys, and high-stakes discoveries',
      scenario: 'following a quest, investigation, or sea/land journey from initial clue or departure to resolution',
      edgeCase: 'false leads, sudden reversals, harsh environments, and hidden motives',
      exercise: 'List the main clues, obstacles, and turning points and see how suspense is maintained.'
    },
    'Fantasy & Myth': {
      focus: 'world-building rules, mythic archetypes, magical systems, and symbolic quests',
      scenario: 'exploring an imaginative or mythical world where wonder and danger shape every choice',
      edgeCase: 'rule boundaries, unexpected alliances, riddles, and tests of character',
      exercise: 'Identify the rules or symbols of the world and note how characters test their limits.'
    },
    'Poetry & Drama': {
      focus: 'rhythm, imagery, meter, dialogue, dramatic tension, and spoken voice',
      scenario: 'reading lines aloud or by scene to hear cadence, contrast, and emotional shifts',
      edgeCase: 'figurative double meanings, shifts in tone, silence/pauses, and dramatic irony',
      exercise: 'Highlight vivid images or lines of dialogue and note how tone changes across stanzas or scenes.'
    },
    'History & Biography': {
      focus: 'historical context, key figures, cause-and-effect timelines, and primary perspective',
      scenario: 'placing events and personal lives within their era to understand why decisions mattered then',
      edgeCase: 'bias or viewpoint in records, overlapping movements, and long-term consequences',
      exercise: 'Note the time period, key figures, and major causes and effects described in the passage.'
    },
    'Philosophy & Society': {
      focus: 'core arguments, definitions, ethical questions, institutions, and civic ideas',
      scenario: 'examining how a thinker or text defines justice, duty, society, or human nature',
      edgeCase: 'counterarguments, hidden assumptions, edge scenarios, and differing definitions',
      exercise: 'State the main claim in your own words and write down one counterargument or question.'
    },
    'Science & Nature': {
      focus: 'observation, natural patterns, classification, cause and effect, and empirical reasoning',
      scenario: 'connecting careful observation of the natural world with clear explanations and models',
      edgeCase: 'exceptions to rules, measurement limits, seasonal/environmental variation, and incomplete data',
      exercise: 'Note the observations or natural patterns described and how evidence supports each claim.'
    }
  };

  const track = trackNotes[category] || {
    focus: 'foundational concepts, key themes, historical context, and careful reading',
    scenario: 'applying ideas from this classic edition to reading, discussion, or study',
    edgeCase: 'unfamiliar phrasing, shifting context, subtle contrasts, and open questions',
    exercise: 'Summarize the main ideas in your own words and write two takeaways from this edition.'
  };

  return [
    {
      number: 1,
      title: 'Chapter 1: Foundations, Context & Scope',
      paragraphs: [
        `Welcome to "${title}" by ${author}. Prepared for the ${category} collection in Archive, this opening chapter introduces the foundational ideas, context, and scope of the book.`,
        description,
        `Every substantial work in ${category} starts with a clear question: what situation or theme opens the work, why do surface readings miss it, and what boundaries define our reading?`,
        `Readers often rush past early setup in order to reach major turning points quickly. Yet careful attention to early context prevents misunderstandings later in the book.`,
        `In ${category}, central themes revolve around ${track.focus}. Seeing how these elements fit together gives you a clear map before diving into deeper sections.`,
        `Context matters just as much as definitions. A pattern that works early in a piece may evolve as scale, tension, or complexity grows.`,
        `Constraints shape every structure and choice. Time, focus, source quality, reader expectations, and surrounding details all pull in different directions.`,
        `When reading "${title}", treat each section as part of a connected whole rather than a list of isolated fragments.`,
        `Notice how key motifs or concepts recur across chapters. Each time an element reappears, it is usually examined at a deeper level or in a new situation.`,
        `Taking brief notes on what each subsection establishes makes it much easier to connect Chapter 1 to the later chapters.`,
        `A disciplined reader asks two questions after every few paragraphs: what was just shown, and how does it change what I know about ${category}?`,
        `By building a firm base here, you set up clearer understanding for the structural and analytical chapters that follow.`,
        `Consider how your own interests or current reading in ${category} connect with the ideas introduced in this opening chapter.`,
        `With the scope and context established, we can move into how the underlying structure and principles are organized.`
      ]
    },
    {
      number: 2,
      title: 'Chapter 2: Core Principles & Structure',
      paragraphs: [
        `This chapter examines the structural backbone of ${category}, focusing closely on ${track.focus}.`,
        `Strong structures organize complex material into clear parts with distinct roles so each piece can be followed on its own.`,
        `When parts are clearly separated, changes in one section are less likely to cause confusion or unintended effects elsewhere.`,
        `Balance and coherence are two useful lenses for evaluating structure: keep closely related elements together, and keep transitions between separate parts clear.`,
        `Every structural choice involves trade-offs. Favoring speed or brevity may cost detail or depth, while over-complicating early can slow down the flow.`,
        `Good creators make trade-offs deliberately rather than accidentally. They consider what is gained, what is given up, and how choices affect the whole work.`,
        `Frameworks and conventions help organize detail so you can follow broader movement without getting lost in minor mechanics.`,
        `Pairing broad structure with concrete examples makes complex material much easier to grasp and remember.`,
        `Consistency in naming, pacing, and organization lowers effort for anyone reading or revisiting the work later.`,
        `Look for recurring patterns across examples in ${category}. Recognizing a familiar pattern helps you follow new developments more easily.`,
        `Noting key assumptions alongside structural choices helps clarify why a particular arrangement was used.`,
        `Structure is dynamic; as situations develop, earlier setups are tested and refined against new realities.`,
        `As you read through this chapter, observe how clear structure supports clarity compared to tangled or scattered arrangements.`,
        `Next, we look more closely at step-by-step progression and how individual parts move over time.`
      ]
    },
    {
      number: 3,
      title: 'Chapter 3: Step-by-Step Progression & Dynamics',
      paragraphs: [
        `Moving deeper into "${title}", Chapter 3 traces the step-by-step progression that drives real outcomes in ${category}.`,
        `A useful way to follow any progression is to trace starting conditions, intermediate shifts, responses, and results in order.`,
        `At each stage, ask what enters the moment, what forces act on it, and what changes by the time the stage concludes.`,
        `Turning points and transitions are where key shifts often happen. Knowing what changes—and why—keeps the progression clear.`,
        `In ${category}, understanding ${track.focus} requires paying close attention to sequence, timing, and cause and effect.`,
        `Changing the order of events or steps can produce very different results even when each individual piece looks familiar on its own.`,
        `Key checkpoints help catch shifts early and show how earlier choices shape what happens next.`,
        `When tracing a progression, start from a clear baseline and verify each shift one step at a time.`,
        `Clear intermediate steps make complex developments easier to follow, discuss, and review.`,
        `As scope expands, attention often shifts from one stage to another—observing each stage keeps priorities clear.`,
        `Consistency and repeatability matter whenever patterns recur or are revisited under new conditions.`,
        `Comparing a straightforward sequence with a multi-layered sequence shows where extra care is needed.`,
        `Keep notes on how normal progression unfolds so you can contrast it against edge cases in the next chapter.`,
        `With the standard progression clear, we now examine edge cases, boundaries, and tensions.`
      ]
    },
    {
      number: 4,
      title: 'Chapter 4: Edge Cases, Boundaries & Tensions',
      paragraphs: [
        `Real-world situations rarely stay inside neat boundaries—Chapter 4 focuses on edge cases, limits, and tensions in ${category}.`,
        `In "${title}" and in ${category} more broadly, typical edge cases include ${track.edgeCase}.`,
        `Edge cases matter disproportionately because they test assumptions that seemed straightforward under ordinary conditions.`,
        `Boundary moments—such as beginnings, endings, extremes, reversals, and missing information—deserve careful attention.`,
        `When friction or failure occurs, distinguish between temporary setbacks and deeper breakdowns so responses stay appropriate.`,
        `Hidden or quiet problems are especially important because they can go unnoticed until much later.`,
        `Clear signals, honest explanations, and thoughtful fallbacks make problem-solving faster and reduce confusion.`,
        `Consider what happens during partial change: if one part shifts and another lags behind, is the result coherent or divided?`,
        `Examining unusual or difficult cases early reveals weak spots before they become bigger obstacles.`,
        `Every edge case you note becomes a useful reference point so similar situations are easier to spot later.`,
        `Careful checks at key boundaries protect core consistency against unexpected twists or incomplete information.`,
        `At the same time, focus attention where it matters most rather than over-complicating every routine detail.`,
        `Thinking through tensions and limits helps you anticipate challenges instead of being caught off guard.`,
        `Next, we bring these ideas together in an applied walkthrough and case study.`
      ]
    },
    {
      number: 5,
      title: 'Chapter 5: Applied Walkthrough & Case Study',
      paragraphs: [
        `Chapter 5 translates the ideas of "${title}" into a concrete walkthrough for ${category}, centered on ${track.scenario}.`,
        `Begin any practical study by stating the goal, starting point, expected outcome, and key constraints in clear, plain language.`,
        `Start with a focused baseline rather than trying to analyze or build every detail of every part all at once.`,
        `Establishing a clear baseline early gives immediate feedback and tests core assumptions quickly.`,
        `Once the baseline is clear, layer in edge cases, nuances, and refinements step by step while keeping the main thread intact.`,
        `Walk through a concrete example from start to finish to see how each part contributes to the outcome.`,
        `Watch for places where patterns repeat or become dense—that is often a signal to pause and clarify the main idea.`,
        `Keeping clear summaries and notes along the way saves time when reviewing or explaining the example later.`,
        `When applying a case study to your own work, ask why each step matters rather than copying surface details mechanically.`,
        `Compare two different ways of handling the same situation to see how clarity, effort, and results differ in practice.`,
        `Steady, verifiable steps keep momentum moving forward and make it easy to adjust when new details appear.`,
        `Recording key takeaways as you go builds a practical reference for future study or collaboration.`,
        `An applied walkthrough connects ideas with practice by showing how principles work under realistic conditions.`,
        `In the next chapter, we examine common pitfalls and habits that get in the way.`
      ]
    },
    {
      number: 6,
      title: 'Chapter 6: Common Pitfalls & Missteps',
      paragraphs: [
        `Even with solid familiarity with ${category}, certain recurring habits can weaken results when engaging with themes like "${title}".`,
        `Pitfall 1 — Over-complicating early: adding extra layers or jargon before establishing the basics often obscures the main point.`,
        `Pitfall 2 — Missing the core question: focusing on minor details without clarifying the central issue wastes effort.`,
        `Pitfall 3 — Unchecked assumptions: treating guesses as settled facts leads to avoidable misunderstandings.`,
        `Pitfall 4 — Ignoring long-term clarity: notes or solutions that feel clever right now can be hard to follow later.`,
        `Pitfall 5 — Checking only easy cases: looking only at straightforward examples leaves tricky boundaries unexamined.`,
        `Pitfall 6 — Vague conclusions: leaving takeaways fuzzy makes it harder to apply what you learned.`,
        `Pitfall 7 — Losing focus mid-way: adding extra goals without checking priorities can stall progress.`,
        `Spotting these missteps early lets you step back, simplify, and refocus before small issues grow.`,
        `When reviewing your notes or discussing a topic, check which of these pitfalls might be affecting your reading.`,
        `Clarity rarely happens by accident—it usually comes from trimming excess and revisiting rough first impressions.`,
        `Pairing careful observation with practical testing keeps conclusions grounded rather than routine.`,
        `Avoiding common traps is one of the most practical habits in ${category}.`,
        `Next, we focus on strong habits, verification, and lasting understanding.`
      ]
    },
    {
      number: 7,
      title: 'Chapter 7: Best Practices, Verification & Craft',
      paragraphs: [
        `Chapter 7 highlights practical habits and verification standards that support strong, reliable work in ${category}.`,
        `Checking your understanding should happen continuously, not only at the very end of a chapter or session.`,
        `Break checks into clear steps: individual details, how pieces connect, and how the whole picture holds together.`,
        `Clear summaries and plain language make ideas easier to revisit later without having to start over from scratch.`,
        `Keep each step focused so every change or note has a clear purpose and is easy to review.`,
        `Use repeatable steps and clear notes whenever working through examples, exercises, or discussions.`,
        `When something seems unclear, state a specific question, test one idea at a time, and verify what resolves it.`,
        `Balance curiosity with care: explore freely, then double-check your reasoning before wrapping up.`,
        `Share ideas and questions early while perspectives are still open and easy to refine.`,
        `Keep a personal list of lessons from past reading and projects so past challenges become strengths.`,
        `Strong craft shows in how clearly an approach handles everyday cases and how steadily it handles harder ones.`,
        `Consistent habits turn occasional insights into dependable understanding over time.`,
        `Pick one or two practices from this chapter to try in your next reading or study session.`,
        `In the final chapter, we bring the book's main ideas together with review questions and exercises.`
      ]
    },
    {
      number: 8,
      title: 'Chapter 8: Synthesis, Review & Study Exercises',
      paragraphs: [
        `"${title}" (${category}) by ${author} brings together foundations, structure, progression, edge cases, applied walkthroughs, and practical habits into a complete picture.`,
        `Look back across Chapters 1 through 7 and see how early ideas and structure shape later developments and takeaways.`,
        `Core Concept Review: summarize in your own words how ${track.focus} anchors the main ideas of ${category}.`,
        `Structure & Progression Review: explain how following clear stages and transitions improves clarity and understanding.`,
        `Boundaries & Resilience Review: recall why examining edge cases and tensions helps prevent surprises.`,
        `Applied Walkthrough Review: describe how starting with a clear baseline and refining step by step applies to ${track.scenario}.`,
        `Study Exercise 1: ${track.exercise}`,
        `Study Exercise 2: Pick one situation from ${track.edgeCase} and write down how you would analyze and handle it clearly.`,
        `Study Exercise 3: Explain the main takeaway of "${title}" in four clear sentences as if sharing with a classmate or friend.`,
        `Self-Assessment Question: Which chapter or idea in this edition felt least familiar at first, and what is clearer now?`,
        `Practical Action Plan: Choose one specific idea from this book to revisit or apply this week.`,
        `Reference Note: Keep this digital edition downloaded as a PDF so you can revisit key sections, notes, and exercises offline whenever needed.`,
        `Final Reflection: Steady curiosity, careful checking, and clear organization pay off across everything you read and build in ${category}.`,
        `Thank you for reading "${title}" on Archive.`
      ]
    }
  ];
}

function buildBookPdfBuffer(book) {
  const category = normalizeBookCategory(book);
  const chapters = buildBookChapters({ ...book, category });
  const allLines = [
    'ARCHIVE E-LIBRARY - COMPLETE DIGITAL EDITION',
    '====================================================================',
    `BOOK TITLE : ${book.title || 'Untitled Book'}`,
    `AUTHOR     : ${book.author || 'Unknown Author'}`,
    `CATEGORY   : ${category}`,
    `CHAPTERS   : ${chapters.length} Complete Chapters`,
    `CATALOG ID : #${book.id}`,
    '====================================================================',
    ''
  ];

  for (const ch of chapters) {
    allLines.push(ch.title.toUpperCase());
    allLines.push('--------------------------------------------------------------------');
    for (const para of ch.paragraphs) {
      allLines.push(...wrapTextLines(para, 78));
      allLines.push('');
    }
  }

  const linesPerPage = 46;
  const pages = [];
  for (let i = 0; i < allLines.length; i += linesPerPage) {
    pages.push(allLines.slice(i, i + linesPerPage));
  }
  const pageCount = pages.length;

  const fontObjNum = 3;
  const pageObjNums = pages.map((_, idx) => 4 + idx * 2);
  const objectsById = new Map();

  objectsById.set(1, `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objectsById.set(
    2,
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`
  );
  objectsById.set(
    fontObjNum,
    `${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`
  );

  pages.forEach((pageLines, idx) => {
    const pageObjNum = 4 + idx * 2;
    const contentObjNum = 5 + idx * 2;
    const commands = ['BT', '/F1 10.5 Tf', '48 748 Td', '14 TL'];

    pageLines.forEach((line, lineIdx) => {
      const safeLine = escapePdfText(line);
      commands.push(lineIdx === 0 ? `(${safeLine}) Tj` : `T* (${safeLine}) Tj`);
    });
    commands.push('ET');

    const streamData = commands.join('\n');
    const byteLen = Buffer.byteLength(streamData, 'utf8');

    objectsById.set(
      pageObjNum,
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>\nendobj\n`
    );
    objectsById.set(
      contentObjNum,
      `${contentObjNum} 0 obj\n<< /Length ${byteLen} >>\nstream\n${streamData}\nendstream\nendobj\n`
    );
  });

  const totalObjects = 3 + pageCount * 2;
  let pdf = '%PDF-1.4\n';
  const offsets = new Array(totalObjects + 1).fill(0);

  for (let objId = 1; objId <= totalObjects; objId++) {
    offsets[objId] = Buffer.byteLength(pdf, 'utf8');
    pdf += objectsById.get(objId);
  }

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${totalObjects + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let objId = 1; objId <= totalObjects; objId++) {
    pdf += `${String(offsets[objId]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'member',
      download_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_sessions (
      guest_token VARCHAR(128) PRIMARY KEY,
      download_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category VARCHAR(100) NOT NULL,
      description TEXT,
      file_url TEXT NOT NULL,
      cover_url TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      download_count INTEGER NOT NULL DEFAULT 0,
      source_id INTEGER UNIQUE,
      text_url TEXT,
      full_text TEXT
    )
  `);

  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS source_id INTEGER UNIQUE`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS text_url TEXT`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS full_text TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_library (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, book_id)
    )
  `);

  const adminCheck = await pool.query(`SELECT id FROM users WHERE username = 'admin' LIMIT 1`);
  if (!adminCheck.rows.length) {
    const adminHash = await bcrypt.hash('Admin@123', 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role, download_count, last_seen_at)
       VALUES ('admin', $1, 'System Administrator', 'admin', 0, CURRENT_TIMESTAMP)
       ON CONFLICT (username) DO NOTHING`,
      [adminHash]
    );
  }

  const existingBooks = await pool.query(`SELECT id, title, author, category, description FROM books`);
  for (const row of existingBooks.rows) {
    const matchedCategory = normalizeBookCategory(row);
    const cleanedDesc = stripAssignedTagText(row.description);
    if (row.category !== matchedCategory || (row.description || '') !== cleanedDesc) {
      await pool.query(`UPDATE books SET category = $1, description = $2 WHERE id = $3`, [
        matchedCategory,
        cleanedDesc,
        row.id
      ]);
    }
  }

  await pool.query(`UPDATE books SET file_url = '/api/books/' || id || '/file'`);
}

function makeUserResponse(user) {
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET_KEY,
    { expiresIn: '7d' }
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.full_name,
      username: user.username,
      role: user.role,
      download_count: Number(user.download_count || 0)
    }
  };
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    req.authUser = jwt.verify(parts[1], SECRET_KEY);
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const result = await pool.query('SELECT id, role FROM users WHERE id = $1 LIMIT 1', [req.authUser.id]);
    if (!result.rows.length || result.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access required.' });
    }
    return next();
  } catch {
    return res.status(500).json({ error: 'Failed to verify administrator permissions.' });
  }
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM books');
    res.json({ status: 'healthy', database: 'connected', books: count.rows[0].count });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: 'Database check failed.' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!fullName || !username || !password) {
      return res.status(400).json({ error: 'Full name, Gmail address, and password are required.' });
    }
    if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(username)) {
      return res.status(400).json({ error: 'Account must use a valid @gmail.com address.' });
    }
    if (password.length <= 6) {
      return res.status(400).json({ error: 'Password must be more than 6 characters.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role, download_count, last_seen_at)
       VALUES ($1, $2, $3, 'member', 0, CURRENT_TIMESTAMP)
       RETURNING id, username, full_name, role, download_count`,
      [username, passwordHash, fullName]
    );

    return res.status(201).json(makeUserResponse(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That Gmail account is already registered.' });
    }
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (username !== 'admin' && !/^[a-z0-9._%+-]+@gmail\.com$/.test(username)) {
      return res.status(400).json({ error: 'Please log in with a valid @gmail.com address.' });
    }
    if (password.length <= 6) {
      return res.status(400).json({ error: 'Password must be more than 6 characters.' });
    }

    const result = await pool.query(
      `SELECT id, username, password_hash, full_name, role, download_count
       FROM users WHERE LOWER(username) = $1 LIMIT 1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid Gmail account or password.' });
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid Gmail account or password.' });
    }

    await pool.query(`UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);
    return res.json(makeUserResponse(user));
  } catch (err) {
    res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

app.post('/api/logout', requireAuth, async (req, res) => {
  try {
    await pool.query(`UPDATE users SET last_seen_at = NULL WHERE id = $1`, [req.authUser.id]);
    return res.json({ message: 'Logged out' });
  } catch {
    return res.json({ message: 'Logged out' });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const updated = await pool.query(
      `UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1
       RETURNING id, username, full_name, role, download_count`,
      [req.authUser.id]
    );

    if (!updated.rows.length) {
      return res.status(401).json({ error: 'Account not found. Please log in again.' });
    }

    const user = updated.rows[0];
    return res.json({
      user: {
        id: user.id,
        name: user.full_name,
        username: user.username,
        role: user.role,
        download_count: Number(user.download_count || 0)
      }
    });
  } catch (err) {
    console.error('Current-user lookup error:', err);
    return res.status(500).json({ error: 'Could not refresh account information.' });
  }
});

app.post('/api/books/:id/view', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book ID.' });

    const updated = await pool.query(
      `UPDATE books SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1
       RETURNING id, view_count`,
      [id]
    );

    if (!updated.rows.length) return res.status(404).json({ error: 'Book not found.' });
    return res.json({ id: updated.rows[0].id, view_count: Number(updated.rows[0].view_count || 0) });
  } catch {
    return res.status(500).json({ error: 'Could not record book view.' });
  }
});

app.get('/api/library', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT book_id FROM user_library WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.authUser.id]
    );
    return res.json({ bookIds: result.rows.map((r) => Number(r.book_id)) });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load saved library.' });
  }
});

app.post('/api/library', requireAuth, async (req, res) => {
  try {
    const bookId = Number(req.body.bookId);
    if (!Number.isInteger(bookId) || bookId < 1) return res.status(400).json({ error: 'Valid bookId is required.' });

    const bookExists = await pool.query('SELECT id FROM books WHERE id = $1', [bookId]);
    if (!bookExists.rows.length) return res.status(404).json({ error: 'Book not found.' });

    await pool.query(
      `INSERT INTO user_library (user_id, book_id) VALUES ($1, $2) ON CONFLICT (user_id, book_id) DO NOTHING`,
      [req.authUser.id, bookId]
    );

    const rows = await pool.query(
      `SELECT book_id FROM user_library WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.authUser.id]
    );
    return res.status(201).json({ bookIds: rows.rows.map((r) => Number(r.book_id)) });
  } catch (err) {
    return res.status(500).json({ error: 'Could not save book to library.' });
  }
});

app.delete('/api/library/:bookId', requireAuth, async (req, res) => {
  try {
    const bookId = Number(req.params.bookId);
    if (!Number.isInteger(bookId) || bookId < 1) return res.status(400).json({ error: 'Invalid bookId.' });

    await pool.query(`DELETE FROM user_library WHERE user_id = $1 AND book_id = $2`, [req.authUser.id, bookId]);
    const rows = await pool.query(
      `SELECT book_id FROM user_library WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.authUser.id]
    );
    return res.json({ bookIds: rows.rows.map((r) => Number(r.book_id)) });
  } catch (err) {
    return res.status(500).json({ error: 'Could not remove book from library.' });
  }
});

app.get('/api/admin/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [
      booksCount,
      usersCount,
      loggedInUsersRes,
      memberDownloads,
      guestDownloads,
      categoryRows,
      mostViewedRes,
      mostDownloadedRes,
      mostSavedRes,
      popularBooksRes
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total FROM books'),
      pool.query('SELECT COUNT(*)::int AS total FROM users'),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM users
         WHERE last_seen_at IS NOT NULL AND last_seen_at >= NOW() - INTERVAL '15 minutes'`
      ),
      pool.query('SELECT COALESCE(SUM(download_count), 0)::int AS total FROM users'),
      pool.query('SELECT COALESCE(SUM(download_count), 0)::int AS total FROM guest_sessions'),
      pool.query('SELECT category, COUNT(*)::int AS count FROM books GROUP BY category ORDER BY count DESC'),
      pool.query(
        `SELECT id, title, author, category, COALESCE(view_count, 0)::int AS view_count
         FROM books ORDER BY COALESCE(view_count, 0) DESC, id ASC LIMIT 1`
      ),
      pool.query(
        `SELECT id, title, author, category, COALESCE(download_count, 0)::int AS download_count
         FROM books ORDER BY COALESCE(download_count, 0) DESC, id ASC LIMIT 1`
      ),
      pool.query(
        `SELECT b.id, b.title, b.author, b.category, COUNT(ul.id)::int AS save_count
         FROM books b LEFT JOIN user_library ul ON ul.book_id = b.id
         GROUP BY b.id, b.title, b.author, b.category
         ORDER BY save_count DESC, b.id ASC LIMIT 1`
      ),
      pool.query(
        `SELECT b.id, b.title, b.author, b.category,
           COALESCE(b.view_count, 0)::int AS view_count,
           COALESCE(b.download_count, 0)::int AS download_count,
           COUNT(ul.id)::int AS save_count,
           (COALESCE(b.view_count, 0) + COALESCE(b.download_count, 0) * 2 + COUNT(ul.id) * 3)::int AS popularity_score
         FROM books b LEFT JOIN user_library ul ON ul.book_id = b.id
         GROUP BY b.id, b.title, b.author, b.category, b.view_count, b.download_count
         ORDER BY popularity_score DESC, b.view_count DESC, b.id ASC LIMIT 5`
      )
    ]);

    return res.json({
      totalBooks: booksCount.rows[0].total,
      totalUsers: usersCount.rows[0].total,
      loggedInUsers: loggedInUsersRes.rows[0].total,
      memberDownloads: memberDownloads.rows[0].total,
      guestDownloads: guestDownloads.rows[0].total,
      totalDownloads: Number(memberDownloads.rows[0].total) + Number(guestDownloads.rows[0].total),
      categories: categoryRows.rows,
      mostViewedBook: mostViewedRes.rows[0] || null,
      mostDownloadedBook: mostDownloadedRes.rows[0] || null,
      mostSavedBook: mostSavedRes.rows[0] || null,
      popularBooks: popularBooksRes.rows
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    return res.status(500).json({ error: 'Could not load admin analytics.' });
  }
});

app.post('/api/admin/books', requireAuth, requireAdmin, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const author = String(req.body.author || '').trim();
    const description = stripAssignedTagText(req.body.description || '');
    const category = normalizeBookCategory({
      title,
      author,
      category: req.body.category,
      description
    });

    if (!title || !author) return res.status(400).json({ error: 'Title and author are required.' });

    const inserted = await pool.query(
      `INSERT INTO books (title, author, category, description, file_url, cover_url, view_count, download_count)
       VALUES ($1, $2, $3, $4, '/api/books/0/file', $5, 0, 0) RETURNING *`,
      [
        title,
        author,
        category,
        description || `Classic edition in ${category} by ${author}.`,
        `https://picsum.photos/seed/${encodeURIComponent(title.slice(0, 16))}/300/420`
      ]
    );

    const created = inserted.rows[0];
    const finalized = await pool.query(
      `UPDATE books SET file_url = $1 WHERE id = $2 RETURNING *`,
      [`/api/books/${created.id}/file`, created.id]
    );

    return res.status(201).json(finalized.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Could not add book.' });
  }
});

app.delete('/api/admin/books/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book ID.' });

    const deleted = await pool.query('DELETE FROM books WHERE id = $1 RETURNING id', [id]);
    if (!deleted.rows.length) return res.status(404).json({ error: 'Book not found.' });
    return res.json({ deletedId: id });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete book.' });
  }
});

app.get('/api/books', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const category = String(req.query.category || '').trim();
    const conditions = [];
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(title ILIKE $${values.length} OR author ILIKE $${values.length} OR description ILIKE $${values.length})`);
    }
    if (category && category !== 'All') {
      values.push(category);
      conditions.push(`category = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(`SELECT * FROM books ${where} ORDER BY id ASC`, values);
    res.json(result.rows.map((row) => ({
      ...row,
      category: normalizeBookCategory(row),
      description: stripAssignedTagText(row.description)
    })));
  } catch (err) {
    res.status(500).json({ error: 'Could not load books.' });
  }
});

app.post('/api/books/:id/download', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book ID.' });

    const bookResult = await pool.query('SELECT * FROM books WHERE id = $1', [id]);
    if (!bookResult.rows.length) return res.status(404).json({ error: 'Book not found.' });

    const book = {
      ...bookResult.rows[0],
      category: normalizeBookCategory(bookResult.rows[0]),
      description: stripAssignedTagText(bookResult.rows[0].description)
    };
    const downloadUrl = `/api/books/${book.id}/file`;
    const authHeader = req.headers.authorization;

    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Invalid authorization header.' });
      }

      let payload;
      try {
        payload = jwt.verify(parts[1], SECRET_KEY);
      } catch {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }

      const updated = await pool.query(
        `UPDATE users
         SET download_count = COALESCE(download_count, 0) + 1, last_seen_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND COALESCE(download_count, 0) < $2
         RETURNING id, download_count`,
        [payload.id, MEMBER_MAX_DOWNLOADS]
      );

      if (!updated.rows.length) {
        const userExists = await pool.query('SELECT id FROM users WHERE id = $1', [payload.id]);
        if (!userExists.rows.length) return res.status(401).json({ error: 'Account not found. Please log in again.' });
        return res.status(403).json({
          error: `Member download limit reached (${MEMBER_MAX_DOWNLOADS} books max per account).`,
          download_count: MEMBER_MAX_DOWNLOADS,
          max_downloads: MEMBER_MAX_DOWNLOADS
        });
      }

      await pool.query(`UPDATE books SET download_count = COALESCE(download_count, 0) + 1 WHERE id = $1`, [id]);
      return res.json({
        message: 'Download authorized',
        book: { ...book, file_url: downloadUrl },
        file_url: downloadUrl,
        download_count: Number(updated.rows[0].download_count),
        max_downloads: MEMBER_MAX_DOWNLOADS
      });
    }

    const guestToken = String(req.headers['x-guest-token'] || '').trim();
    if (!guestToken || guestToken.length > 128) {
      return res.status(401).json({ error: 'Guest session or member login is required to download books.' });
    }

    const guestUpdate = await pool.query(
      `INSERT INTO guest_sessions (guest_token, download_count, updated_at)
       VALUES ($1, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (guest_token)
       DO UPDATE SET download_count = guest_sessions.download_count + 1, updated_at = CURRENT_TIMESTAMP
       WHERE guest_sessions.download_count < $2
       RETURNING download_count`,
      [guestToken, GUEST_MAX_DOWNLOADS]
    );

    if (!guestUpdate.rows.length) {
      const existingGuest = await pool.query('SELECT download_count FROM guest_sessions WHERE guest_token = $1', [guestToken]);
      return res.status(403).json({
        error: `Guest download limit reached (${GUEST_MAX_DOWNLOADS} books max per session). Log in or create an account for up to ${MEMBER_MAX_DOWNLOADS} downloads.`,
        download_count: Number(existingGuest.rows[0]?.download_count || GUEST_MAX_DOWNLOADS),
        max_downloads: GUEST_MAX_DOWNLOADS
      });
    }

    await pool.query(`UPDATE books SET download_count = COALESCE(download_count, 0) + 1 WHERE id = $1`, [id]);
    return res.json({
      message: 'Guest download authorized',
      book: { ...book, file_url: downloadUrl },
      file_url: downloadUrl,
      download_count: Number(guestUpdate.rows[0].download_count),
      max_downloads: GUEST_MAX_DOWNLOADS
    });
  } catch (err) {
    console.error('Download authorization error:', err);
    res.status(500).json({ error: 'Server error during download authorization.' });
  }
});

app.get('/api/books/:id/file', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book ID.' });

    const bookResult = await pool.query('SELECT * FROM books WHERE id = $1', [id]);
    if (!bookResult.rows.length) return res.status(404).json({ error: 'Book not found.' });

    const book = {
      ...bookResult.rows[0],
      category: normalizeBookCategory(bookResult.rows[0]),
      description: stripAssignedTagText(bookResult.rows[0].description)
    };
    const pdfBuffer = buildBookPdfBuffer(book);
    const safeFilename = `${(book.title || `book_${book.id}`)
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('File generation error:', err);
    return res.status(500).json({ error: 'Failed to generate book file.' });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-6) : [];
    const lower = message.toLowerCase();

    const matchedCategory = BOOK_CATEGORIES.find((c) => lower.includes(c.toLowerCase()));
    const searchTerms = message
      .replace(/\b(compare|recommend|suggest|save|add|to|my|library|favorite|book|books|about|find|show)\b/gi, ' ')
      .trim();

    let candidateRows = [];
    if (matchedCategory) {
      const catRes = await pool.query(`SELECT * FROM books WHERE category = $1 ORDER BY id ASC LIMIT 6`, [matchedCategory]);
      candidateRows = catRes.rows;
    }
    if (!candidateRows.length && searchTerms.length >= 2) {
      const kw = `%${searchTerms.split(/\s+/)[0]}%`;
      const kwRes = await pool.query(
        `SELECT * FROM books WHERE title ILIKE $1 OR author ILIKE $1 OR description ILIKE $1 ORDER BY id ASC LIMIT 6`,
        [kw]
      );
      candidateRows = kwRes.rows;
    }
    if (!candidateRows.length) {
      const prevUserPrompt = [...history].reverse().find((m) => m.sender === 'user')?.text || '';
      const fallbackCat = BOOK_CATEGORIES.find((c) => prevUserPrompt.toLowerCase().includes(c.toLowerCase()));
      if (fallbackCat) {
        const prevRes = await pool.query(`SELECT * FROM books WHERE category = $1 ORDER BY id ASC LIMIT 4`, [fallbackCat]);
        candidateRows = prevRes.rows;
      }
    }
    if (!candidateRows.length) {
      const topRes = await pool.query(`SELECT * FROM books ORDER BY id ASC LIMIT 4`);
      candidateRows = topRes.rows;
    }

    const topBooks = candidateRows.slice(0, 3).map((b) => ({
      ...b,
      category: normalizeBookCategory(b),
      description: stripAssignedTagText(b.description)
    }));
    const toolsUsed = ['search_books', 'get_book_details'];

    let pendingSaveBook = null;
    if (lower.includes('save') || lower.includes('library') || lower.includes('bookmark')) {
      pendingSaveBook = topBooks[0] || null;
      if (pendingSaveBook) toolsUsed.push('prepare_save_to_library');
    }

    let replyText = '';
    if (pendingSaveBook) {
      replyText =
        `I found "${pendingSaveBook.title}" by ${pendingSaveBook.author} (${pendingSaveBook.category}). ` +
        `Please confirm if you want me to save this book to your My Library.`;
    } else if (lower.includes('compare') && topBooks.length >= 2) {
      toolsUsed.push('compare_books');
      const [first, second] = topBooks;
      replyText =
        `Comparison (${first.category}): "${first.title}" by ${first.author} focuses on ${(first.description || '').slice(0, 95)}... ` +
        `versus "${second.title}" by ${second.author}, which covers ${(second.description || '').slice(0, 95)}...`;
    } else {
      toolsUsed.push('recommend_books');
      replyText =
        `Based on your request${matchedCategory ? ` in ${matchedCategory}` : ''}, here are top picks from the live catalog ` +
        `with key details so you can compare and pick one to save or read.`;
    }

    return res.json({ reply: replyText, data: topBooks, toolsUsed, pendingSaveBook });
  } catch (err) {
    console.error('AI agent error:', err);
    res.status(500).json({ error: 'AI agent error.' });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Archive E-Library API is running',
    endpoints: ['/api/health', '/api/books', '/api/ai/chat']
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

async function startServer() {
  try {
    await pool.query('SELECT 1');
    console.log('Connected to Supabase PostgreSQL database.');
    await initializeDatabase();
    app.listen(PORT, '0.0.0.0', () => console.log(`Backend server running on port ${PORT}`));
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

startServer();
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Filesystem, Directory } from '@capacitor/filesystem';
import {
  BookOpen,
  History,
  Bookmark,
  Download,
  Sparkles,
  Search,
  Sun,
  Moon,
  Send,
  User,
  Info,
  X,
  LogOut,
  Lock,
  UserPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Trash2,
  Plus,
  Menu
} from 'lucide-react';

const DEFAULT_API_BASE = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.protocol.startsWith('http')
  ? 'http://localhost:5000/api'
  : 'https://elibrary-backend.wasmer.app/api';
const API_BASE = (
  window.ELIBRARY_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  DEFAULT_API_BASE
).replace(/\/$/, '');
const BACKEND_ORIGIN = API_BASE.replace(/\/api$/, '');

const PREFERRED_CATEGORY_ORDER = [
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

  if (PREFERRED_CATEGORY_ORDER.includes(rawCat)) {
    return rawCat;
  }

  return 'General Classics';
}

function createGuestSessionToken() {
  return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getFallbackCover(book) {
  const id = book?.id || 1;
  return `https://picsum.photos/seed/book${id}/300/420`;
}

function resolveBookFileUrl(bookOrUrl) {
  const rawUrl = typeof bookOrUrl === 'string' ? bookOrUrl : bookOrUrl?.file_url;
  if (rawUrl && rawUrl.startsWith('/api/')) {
    return `${BACKEND_ORIGIN}${rawUrl}`;
  }
  const bookId =
    typeof bookOrUrl === 'object'
      ? bookOrUrl?.id
      : String(rawUrl || '').match(/\/books\/(\d+)/)?.[1];
  return `${API_BASE}/books/${bookId}/file`;
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

function escapePdfText(text) {
  return String(text || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapPdfLines(text, maxChars = 76) {
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

function buildPdfPages(lines, linesPerPage = 46) {
  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  return pages.length ? pages : [['ARCHIVE E-LIBRARY']];
}

function createLocalBookPdfBlob(book) {
  const title = book?.title || 'Library Book';
  const author = book?.author || 'Unknown Author';
  const category = normalizeBookCategory(book);
  const chapters = buildBookChapters(book);

  const allLines = [
    'ARCHIVE E-LIBRARY - COMPLETE DIGITAL EDITION',
    '====================================================================',
    `Title    : ${title}`,
    `Author   : ${author}`,
    `Category : ${category}`,
    `Chapters : ${chapters.length} Complete Chapters`,
    `Book ID  : #${book?.id ?? 'N/A'}`,
    '====================================================================',
    ''
  ];

  for (const ch of chapters) {
    allLines.push(ch.title.toUpperCase());
    allLines.push('--------------------------------------------------------------------');
    for (const para of ch.paragraphs) {
      allLines.push(...wrapPdfLines(para, 76));
      allLines.push('');
    }
  }

  const pages = buildPdfPages(allLines, 46);
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

  const encoder = new TextEncoder();

  pages.forEach((pageLines, idx) => {
    const pageObjNum = 4 + idx * 2;
    const contentObjNum = 5 + idx * 2;
    const commands = ['BT', '/F1 10.5 Tf', '48 748 Td', '14 TL'];

    pageLines.forEach((line, lineIdx) => {
      const safe = escapePdfText(line);
      commands.push(lineIdx === 0 ? `(${safe}) Tj` : `T* (${safe}) Tj`);
    });
    commands.push('ET');

    const streamData = commands.join('\n');
    const byteLen = encoder.encode(streamData).length;

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
    offsets[objId] = encoder.encode(pdf).length;
    pdf += objectsById.get(objId);
  }

  const xrefStart = encoder.encode(pdf).length;
  pdf += `xref\n0 ${totalObjects + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let objId = 1; objId <= totalObjects; objId++) {
    pdf += `${String(offsets[objId]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function readApiResponse(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`Server returned an invalid response (${response.status}).`);
  }
}

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('books');
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedBook, setSelectedBook] = useState(null);
  const [readingBook, setReadingBook] = useState(null);
  const [activeChapterIdx, setActiveChapterIdx] = useState(0);

  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      localStorage.removeItem('user');
      return null;
    }
  });

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const isRegistered = Boolean(token && currentUser);
  const isAdmin = Boolean(isRegistered && currentUser?.role === 'admin');
  const maxDownloads = isRegistered ? 10 : 5;

  const [guestToken, setGuestToken] = useState(() => {
    const existing = sessionStorage.getItem('guestSessionToken');
    if (existing) return existing;
    const fresh = createGuestSessionToken();
    sessionStorage.setItem('guestSessionToken', fresh);
    return fresh;
  });

  const [guestDownloadCount, setGuestDownloadCount] = useState(() =>
    Number(sessionStorage.getItem('guestDownloadCount') || 0)
  );

  const [guestDownloadedIds, setGuestDownloadedIds] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('guestDownloadedIds') || '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    sessionStorage.setItem('guestSessionToken', guestToken);
    sessionStorage.setItem('guestDownloadCount', String(guestDownloadCount));
    sessionStorage.setItem('guestDownloadedIds', JSON.stringify(guestDownloadedIds));
  }, [guestToken, guestDownloadCount, guestDownloadedIds]);

  const [recentIds, setRecentIds] = useState(() => JSON.parse(localStorage.getItem('recentBooks') || '[]'));
  const [savedIds, setSavedIds] = useState(() => JSON.parse(localStorage.getItem('savedBooks') || '[]'));

  const userHistoryKey = currentUser?.id ? `userDownloadedBooks_${currentUser.id}` : null;
  const [userDownloadedIds, setUserDownloadedIds] = useState(() => {
    try {
      const savedUser = JSON.parse(localStorage.getItem('user') || 'null');
      if (!savedUser?.id) return [];
      return JSON.parse(localStorage.getItem(`userDownloadedBooks_${savedUser.id}`) || '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (isRegistered && userHistoryKey) {
      try {
        setUserDownloadedIds(JSON.parse(localStorage.getItem(userHistoryKey) || '[]'));
      } catch {
        setUserDownloadedIds([]);
      }
    } else {
      setUserDownloadedIds([]);
    }
  }, [isRegistered, userHistoryKey]);

  useEffect(() => {
    if (isRegistered && userHistoryKey) {
      localStorage.setItem(userHistoryKey, JSON.stringify(userDownloadedIds));
    }
  }, [isRegistered, userHistoryKey, userDownloadedIds]);

  const downloadedIds = isRegistered ? userDownloadedIds : guestDownloadedIds;
  const currentCountDisplay = isRegistered
    ? Number(currentUser?.download_count ?? 0)
    : Number(guestDownloadCount || 0);

  const [aiInput, setAiInput] = useState('');
  const [aiMessages, setAiMessages] = useState([
    {
      sender: 'ai',
      text: 'Hi! I am your embedded library agent. Ask me to search, compare, or recommend books—or ask me to save a book to My Library.'
    }
  ]);
  const [aiLoading, setAiLoading] = useState(false);

  const [adminStats, setAdminStats] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState('');
  const [newBookAuthor, setNewBookAuthor] = useState('');
  const [newBookCategory, setNewBookCategory] = useState('Fiction');
  const [newBookDesc, setNewBookDesc] = useState('');
  const [adminNotice, setAdminNotice] = useState('');

  const availableCategories = useMemo(() => {
    const present = new Set(
      books.map((book) => normalizeBookCategory(book)).filter(Boolean)
    );
    const ordered = PREFERRED_CATEGORY_ORDER.filter((cat) => present.has(cat));
    const others = Array.from(present)
      .filter((cat) => !PREFERRED_CATEGORY_ORDER.includes(cat))
      .sort();
    return ['All', ...ordered, ...others];
  }, [books]);

  useEffect(() => {
    if (!availableCategories.includes(selectedCategory)) {
      setSelectedCategory('All');
    }
  }, [availableCategories, selectedCategory]);

  useEffect(() => {
    const choices = availableCategories.filter((c) => c !== 'All');
    if (choices.length > 0 && !choices.includes(newBookCategory)) {
      setNewBookCategory(choices[0]);
    }
  }, [availableCategories, newBookCategory]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem('recentBooks', JSON.stringify(recentIds));
    localStorage.setItem('savedBooks', JSON.stringify(savedIds));
  }, [recentIds, savedIds]);

  const recordBookView = useCallback(async (bookId) => {
    if (!bookId) return;
    try {
      await fetch(`${API_BASE}/books/${bookId}/view`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to record book view:', err);
    }
  }, []);

  const handleOpenBookDetails = (book) => {
    setSelectedBook(book);
    recordBookView(book?.id);
  };

  const fetchBooksCatalog = useCallback(async () => {
    setLoading(true);
    setCatalogError('');
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);

      const res = await fetch(`${API_BASE}/books?${params.toString()}`);
      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(data.error || 'Could not load books.');
      const normalized = (Array.isArray(data) ? data : []).map((book) => ({
        ...book,
        category: normalizeBookCategory(book),
        description: stripAssignedTagText(book.description)
      }));
      setBooks(normalized);
    } catch (err) {
      console.error('Failed to fetch books:', err);
      setCatalogError(`Cannot reach API (${API_BASE}). Check your backend URL or internet connection.`);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(fetchBooksCatalog, 250);
    return () => clearTimeout(timer);
  }, [fetchBooksCatalog]);

  const loadAdminOverview = useCallback(async () => {
    if (!token) return;
    setAdminLoading(true);
    setAdminNotice('');
    try {
      const res = await fetch(`${API_BASE}/admin/overview`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await readApiResponse(res);
      if (res.ok) {
        setAdminStats(data);
      } else {
        setAdminNotice(data.error || `Could not load analytics (HTTP ${res.status}).`);
      }
    } catch (err) {
      setAdminNotice(err.message || 'Could not reach backend for admin analytics.');
    } finally {
      setAdminLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (activeTab === 'admin' && isRegistered) {
      loadAdminOverview();
    }
  }, [activeTab, isRegistered, loadAdminOverview]);

  const openAuth = (mode = 'login') => {
    setAuthMode(mode);
    setAuthError('');
    setFullName('');
    setAuthUsername('');
    setAuthPassword('');
    setShowAuthModal(true);
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');

    const normalizedEmail = authUsername.trim().toLowerCase();
    const isAdminLogin = authMode === 'login' && normalizedEmail === 'admin';

    if (!isAdminLogin && !/^[a-z0-9._%+-]+@gmail\.com$/.test(normalizedEmail)) {
      setAuthError('Please enter a valid @gmail.com email address (example@gmail.com).');
      return;
    }

    if (authPassword.length <= 6) {
      setAuthError('Password must be more than 6 characters (at least 7 characters).');
      return;
    }

    if (authMode === 'register' && !fullName.trim()) {
      setAuthError('Please enter your full name.');
      return;
    }

    setAuthLoading(true);

    const endpoint = authMode === 'login' ? '/login' : '/register';
    const payload = authMode === 'login'
      ? { username: normalizedEmail, password: authPassword }
      : { fullName: fullName.trim(), username: normalizedEmail, password: authPassword };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await readApiResponse(res);

      if (res.ok) {
        setUserDownloadedIds([]);
        setToken(data.token);
        setCurrentUser(data.user);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        const nextHistory = JSON.parse(
          localStorage.getItem(`userDownloadedBooks_${data.user.id}`) || '[]'
        );
        setUserDownloadedIds(nextHistory);
        setShowAuthModal(false);
      } else {
        setAuthError(data.error || 'Authentication failed.');
      }
    } catch (err) {
      setAuthError(err.message || 'Could not connect to backend.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    const currentToken = token;
    setToken('');
    setCurrentUser(null);
    setUserDownloadedIds([]);
    setAdminStats(null);
    if (activeTab === 'admin') setActiveTab('books');
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    if (currentToken) {
      try {
        await fetch(`${API_BASE}/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${currentToken}` }
        });
      } catch {
        // Ignore network errors during logout
      }
    }

    const freshGuestToken = createGuestSessionToken();
    setGuestToken(freshGuestToken);
    setGuestDownloadCount(0);
    setGuestDownloadedIds([]);
    sessionStorage.setItem('guestSessionToken', freshGuestToken);
    sessionStorage.setItem('guestDownloadCount', '0');
    sessionStorage.setItem('guestDownloadedIds', '[]');
  };

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const refreshAccountAndLibrary = async () => {
      try {
        const [meRes, libRes] = await Promise.all([
          fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE}/library`, { headers: { Authorization: `Bearer ${token}` } })
        ]);
        const meData = await readApiResponse(meRes);
        if (!meRes.ok) {
          if (meRes.status === 401 && !cancelled) handleLogout();
          return;
        }
        if (!cancelled && meData.user) {
          const refreshedUser = {
            ...meData.user,
            download_count: Number(meData.user.download_count ?? 0)
          };
          setCurrentUser(refreshedUser);
          localStorage.setItem('user', JSON.stringify(refreshedUser));
        }

        if (libRes.ok) {
          const libData = await readApiResponse(libRes);
          if (!cancelled && Array.isArray(libData.bookIds)) {
            setSavedIds(libData.bookIds);
          }
        }
      } catch (err) {
        console.error('Could not refresh account or library:', err);
      }
    };

    refreshAccountAndLibrary();
    return () => { cancelled = true; };
  }, [token]);

  const handleReadBook = (book) => {
    setRecentIds((prev) => [book.id, ...prev.filter((id) => id !== book.id)].slice(0, 20));
    recordBookView(book?.id);
    setActiveChapterIdx(0);
    setReadingBook(book);
  };

  const handleToggleSave = async (bookId) => {
    const alreadySaved = savedIds.includes(bookId);
    setSavedIds((prev) =>
      alreadySaved ? prev.filter((id) => id !== bookId) : [bookId, ...prev]
    );

    if (!isRegistered || !token) return;

    try {
      const res = await fetch(
        alreadySaved ? `${API_BASE}/library/${bookId}` : `${API_BASE}/library`,
        {
          method: alreadySaved ? 'DELETE' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(alreadySaved ? {} : { 'Content-Type': 'application/json' })
          },
          ...(alreadySaved ? {} : { body: JSON.stringify({ bookId }) })
        }
      );
      const data = await readApiResponse(res);
      if (res.ok && Array.isArray(data.bookIds)) {
        setSavedIds(data.bookIds);
      }
    } catch (err) {
      console.error('Library sync failed:', err);
    }
  };

  const handleConfirmAiSave = async (book, msgIndex) => {
    if (!book?.id) return;
    if (!savedIds.includes(book.id)) {
      await handleToggleSave(book.id);
    }
    setAiMessages((prev) =>
      prev.map((m, idx) =>
        idx === msgIndex
          ? {
              ...m,
              pendingSaveBook: null,
              text: `${m.text} Saved "${book.title}" to My Library.`
            }
          : m
      )
    );
  };

  const handleDownloadBook = async (book) => {
    const registeredAtStart = Boolean(token && currentUser);
    const memberCount = Number(currentUser?.download_count ?? 0);
    const guestCount = Number(guestDownloadCount || 0);

    if (!registeredAtStart && guestCount >= 5) {
      alert('Guest download limit reached (5 books max per session). Log in or sign up to download up to 10 books.');
      return;
    }

    if (registeredAtStart && memberCount >= 10) {
      alert('Member download limit reached (10 books max per account).');
      return;
    }

    try {
      const headers = registeredAtStart
        ? { Authorization: `Bearer ${token}` }
        : { 'x-guest-token': guestToken };

      let serverCount = null;
      let data = {};

      try {
        const response = await fetch(`${API_BASE}/books/${book.id}/download`, {
          method: 'POST',
          headers
        });
        data = await readApiResponse(response);
        serverCount = Number(data.download_count);

        if (!response.ok) {
          if (response.status === 401 && registeredAtStart) {
            handleLogout();
          }
          alert(data.error || 'Download failed.');
          return;
        }
      } catch (apiErr) {
        console.warn('Backend quota check failed, falling back to local count:', apiErr);
        serverCount = (registeredAtStart ? memberCount : guestCount) + 1;
      }

      if (Number.isFinite(serverCount)) {
        if (registeredAtStart) {
          setCurrentUser((previousUser) => {
            if (!previousUser) return previousUser;
            const updatedUser = { ...previousUser, download_count: serverCount };
            localStorage.setItem('user', JSON.stringify(updatedUser));
            return updatedUser;
          });
        } else {
          setGuestDownloadCount(serverCount);
          sessionStorage.setItem('guestDownloadCount', String(serverCount));
        }
      }

      const bookPayload = { ...book, ...(data.book || {}) };
      let pdfBlob;
      if (bookPayload.full_text || !bookPayload.id) {
        pdfBlob = createLocalBookPdfBlob(bookPayload);
      } else {
        const fileUrl = resolveBookFileUrl(data.file_url || bookPayload);
        try {
          const fileResponse = await fetch(fileUrl, { headers });
          if (!fileResponse.ok) {
            throw new Error(`File request failed (${fileResponse.status}).`);
          }
          const rawBlob = await fileResponse.blob();
          pdfBlob = rawBlob.type === 'application/pdf'
            ? rawBlob
            : new Blob([rawBlob], { type: 'application/pdf' });
        } catch (fileError) {
          console.error('Hosted PDF request failed; using local full-chapter PDF fallback:', fileError);
          pdfBlob = createLocalBookPdfBlob(bookPayload);
        }
      }

      const safeTitle = `${(bookPayload.title || `book_${book.id}`)
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase()}.pdf`;

      const isCapacitorNative = Boolean(window.Capacitor?.isNativePlatform?.());

      if (isCapacitorNative) {
        const base64Data = await blobToBase64(pdfBlob);
        const savedFile = await Filesystem.writeFile({
          path: `Archive/${safeTitle}`,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true
        });
        alert(`Downloaded "${safeTitle}" to Documents/Archive (${savedFile.uri || 'saved'}).`);
      } else {
        const objectUrl = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = safeTitle;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }

      if (registeredAtStart) {
        setUserDownloadedIds((previous) => (
          previous.includes(book.id) ? previous : [book.id, ...previous]
        ));
      } else {
        setGuestDownloadedIds((previous) => (
          previous.includes(book.id) ? previous : [book.id, ...previous]
        ));
      }

      setRecentIds((previous) => [book.id, ...previous.filter((id) => id !== book.id)].slice(0, 20));
    } catch (err) {
      console.error('Book download failed:', err);
      alert(err.message || 'Error while starting download.');
    }
  };

  const handleSendAi = async (e) => {
    e.preventDefault();
    if (!aiInput.trim()) return;
    const userMsg = aiInput.trim();
    const nextHistory = [...aiMessages, { sender: 'user', text: userMsg }];
    setAiMessages(nextHistory);
    setAiInput('');
    setAiLoading(true);

    try {
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history: nextHistory })
      });
      const data = await readApiResponse(res);
      setAiMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: data.reply,
          books: Array.isArray(data.data)
            ? data.data.map((b) => ({
                ...b,
                category: normalizeBookCategory(b),
                description: stripAssignedTagText(b.description)
              }))
            : data.data,
          toolsUsed: data.toolsUsed,
          pendingSaveBook: data.pendingSaveBook
            ? {
                ...data.pendingSaveBook,
                category: normalizeBookCategory(data.pendingSaveBook),
                description: stripAssignedTagText(data.pendingSaveBook.description)
              }
            : null
        }
      ]);
    } catch (err) {
      setAiMessages((prev) => [...prev, { sender: 'ai', text: 'Could not reach AI server.' }]);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAdminAddBook = async (e) => {
    e.preventDefault();
    setAdminNotice('');
    if (!newBookTitle.trim() || !newBookAuthor.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/admin/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: newBookTitle.trim(),
          author: newBookAuthor.trim(),
          category: newBookCategory,
          description: newBookDesc.trim()
        })
      });
      const data = await readApiResponse(res);
      if (!res.ok) {
        setAdminNotice(data.error || 'Could not add book.');
        return;
      }
      setNewBookTitle('');
      setNewBookAuthor('');
      setNewBookDesc('');
      setAdminNotice(`Added "${data.title}" to catalog.`);
      await Promise.all([fetchBooksCatalog(), loadAdminOverview()]);
    } catch (err) {
      setAdminNotice(err.message || 'Error adding book.');
    }
  };

  const handleAdminDeleteBook = async (bookId) => {
    setAdminNotice('');
    try {
      const res = await fetch(`${API_BASE}/admin/books/${bookId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await readApiResponse(res);
      if (!res.ok) {
        setAdminNotice(data.error || 'Could not delete book.');
        return;
      }
      setAdminNotice(`Deleted book #${bookId}.`);
      await Promise.all([fetchBooksCatalog(), loadAdminOverview()]);
    } catch (err) {
      setAdminNotice(err.message || 'Error deleting book.');
    }
  };

  const displayedBooks = books.filter((book) => {
    if (selectedCategory !== 'All' && normalizeBookCategory(book) !== selectedCategory) {
      return false;
    }
    if (activeTab === 'recent') return recentIds.includes(book.id);
    if (activeTab === 'saved') return savedIds.includes(book.id);
    if (activeTab === 'downloads') return downloadedIds.includes(book.id);
    return true;
  });

  const navItems = [
    { id: 'books', label: 'Books', icon: BookOpen },
    { id: 'recent', label: 'Recent View', icon: History },
    { id: 'saved', label: 'My Library', icon: Bookmark, badge: savedIds.length },
    { id: 'downloads', label: 'Downloads', icon: Download, badge: downloadedIds.length },
    { id: 'ai', label: 'AI Assistant', icon: Sparkles },
    ...(isRegistered ? [{ id: 'admin', label: 'Admin', icon: ShieldCheck }] : [])
  ];

  const tabTitles = {
    books: { title: 'E-Library Collection', sub: 'Over 200+ public-domain and academic reference books' },
    recent: { title: 'Recent View', sub: 'Books you recently viewed or downloaded' },
    saved: { title: 'My Library & Favorites', sub: isRegistered ? 'Synced with your account in PostgreSQL' : 'Saved in current session (sign in to sync across devices)' },
    downloads: { title: 'My Downloads', sub: `Downloaded titles (${currentCountDisplay}/${maxDownloads} quota used)` },
    ai: { title: 'Agentic AI Assistant', sub: 'Search, compare, recommend, and save books with confirmation' },
    admin: { title: 'Administrator Dashboard', sub: 'Logged-in users, most-viewed, downloaded & saved books, and catalog management' }
  };

  const readerChapters = readingBook ? buildBookChapters(readingBook) : [];
  const currentChapter = readerChapters[activeChapterIdx] || readerChapters[0];
  const hasRealFullText = Boolean(readingBook && extractRealBookChapters(readingBook.full_text));
  const adminCategoryOptions = availableCategories.filter((c) => c !== 'All').length > 0
    ? availableCategories.filter((c) => c !== 'All')
    : PREFERRED_CATEGORY_ORDER;

  const renderSidebarContent = () => (
    <>
      <div>
        <div className="flex items-center justify-between px-2 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#5B46E8] flex items-center justify-center text-white">
              <BookOpen className="w-4 h-4" />
            </div>
            <span className="text-xl font-bold tracking-tight">Archive</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="sm:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive ? 'bg-[#E2DFF3] dark:bg-[#27233B] text-[#4C38D6] dark:text-[#A99BFF]' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className="flex items-center gap-3.5">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </span>
                {item.badge > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#5B46E8] text-white">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
        <Info className="w-3.5 h-3.5" />
        <span>Archive v1.6</span>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-[#F8F7FC] dark:bg-[#0F0E13] text-slate-900 dark:text-slate-100 transition-colors duration-200 pt-[env(safe-area-inset-top)]">
      <aside className="hidden sm:flex w-60 shrink-0 bg-[#EFEFF5] dark:bg-[#16151D] border-r border-slate-200/80 dark:border-slate-800 flex-col justify-between p-5">
        {renderSidebarContent()}
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 sm:hidden flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-10 w-64 max-w-[80vw] bg-[#EFEFF5] dark:bg-[#16151D] h-full flex flex-col justify-between p-5 pt-8 shadow-2xl">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="px-3 sm:px-8 py-2.5 sm:h-20 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-4 border-b border-slate-200/60 dark:border-slate-800/80">
          <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:max-w-md">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="sm:hidden p-2 rounded-xl bg-white dark:bg-[#1C1B24] border border-slate-200 dark:border-slate-800 shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search 200+ books, authors, topics..."
                className="w-full pl-9 sm:pl-11 pr-3 sm:pr-4 py-2 sm:py-2.5 rounded-full bg-white dark:bg-[#1C1B24] border border-slate-200 dark:border-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#5B46E8]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto shrink-0">
            <button
              onClick={() => setActiveTab('downloads')}
              className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-full bg-[#EAE7F8] dark:bg-[#221F33] text-[#4C38D6] dark:text-[#B4A7FF] text-xs font-semibold hover:opacity-90"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                <span className="hidden sm:inline">Downloads: </span>{currentCountDisplay}/{maxDownloads}
              </span>
            </button>

            <button
              onClick={() => setDarkMode(!darkMode)}
              className="flex items-center gap-1 p-1 rounded-full bg-slate-200/80 dark:bg-[#1F1E29] border border-slate-300/60 dark:border-slate-700"
            >
              <span className={`p-1 sm:p-1.5 rounded-full ${!darkMode ? 'bg-white text-amber-500 shadow-sm' : 'text-slate-400'}`}>
                <Sun className="w-3.5 h-3.5" />
              </span>
              <span className={`p-1 sm:p-1.5 rounded-full ${darkMode ? 'bg-[#2D2B3B] text-indigo-300 shadow-sm' : 'text-slate-500'}`}>
                <Moon className="w-3.5 h-3.5" />
              </span>
            </button>

            {isRegistered ? (
              <div className="flex items-center gap-1.5 sm:gap-2 bg-white dark:bg-[#1C1B24] border border-slate-200 dark:border-slate-800 px-2.5 sm:px-3 py-1 rounded-full text-xs font-medium">
                <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                  <User className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                </div>
                <span className="max-w-[80px] sm:max-w-[110px] truncate">{currentUser.name || currentUser.username}</span>
                <button onClick={handleLogout} title="Log out" className="ml-0.5 sm:ml-1 text-slate-400 hover:text-red-500">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button onClick={() => openAuth('login')} className="px-3 sm:px-3.5 py-1.5 rounded-full border border-slate-300 dark:border-slate-700 text-xs font-semibold">
                  Log In
                </button>
                <button onClick={() => openAuth('register')} className="flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1.5 rounded-full bg-[#5B46E8] text-white text-xs font-semibold">
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Sign Up</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-8 overflow-y-auto">
          <div className="mb-4 sm:mb-6">
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight">{tabTitles[activeTab].title}</h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">{tabTitles[activeTab].sub}</p>
          </div>

          {activeTab === 'admin' ? (
            <div className="space-y-6 max-w-5xl">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                  Signed in as <strong>{currentUser?.username}</strong> ({currentUser?.role})
                </span>
                <button
                  type="button"
                  onClick={loadAdminOverview}
                  className="px-3.5 py-1.5 rounded-xl bg-[#5B46E8] text-white text-xs font-semibold"
                >
                  Refresh Analytics
                </button>
              </div>

              {!isAdmin && (
                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
                  Your account currently has role <strong>{currentUser?.role || 'member'}</strong>. Log in with <code>admin</code> (password <code>Admin@123</code>) or set <code>role = &apos;admin&apos;</code> on your user row in Supabase to view analytics and manage books.
                </div>
              )}

              {adminNotice && (
                <div className="p-3 rounded-xl bg-[#EAE7F8] dark:bg-[#27233B] text-xs font-medium text-[#4C38D6] dark:text-[#B4A7FF]">
                  {adminNotice}
                </div>
              )}

              {adminLoading ? (
                <p className="text-sm text-slate-500">Loading analytics...</p>
              ) : adminStats ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                    <div className="bg-white dark:bg-[#181720] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <p className="text-xs text-slate-500">Logged-In Users (15m)</p>
                      <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{adminStats.loggedInUsers}</p>
                    </div>
                    <div className="bg-white dark:bg-[#181720] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <p className="text-xs text-slate-500">Registered Accounts</p>
                      <p className="text-2xl font-bold mt-1">{adminStats.totalUsers}</p>
                    </div>
                    <div className="bg-white dark:bg-[#181720] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <p className="text-xs text-slate-500">Total Books</p>
                      <p className="text-2xl font-bold mt-1">{adminStats.totalBooks}</p>
                    </div>
                    <div className="bg-white dark:bg-[#181720] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <p className="text-xs text-slate-500">Total Downloads</p>
                      <p className="text-2xl font-bold mt-1">{adminStats.totalDownloads}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-[#181720] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Most Viewed Book</h2>
                      {adminStats.mostViewedBook ? (
                        <div className="text-xs space-y-1">
                          <p className="font-bold text-sm">{adminStats.mostViewedBook.title}</p>
                          <p className="text-slate-500">By {adminStats.mostViewedBook.author}</p>
                          <p className="font-semibold text-[#5B46E8] dark:text-[#A99BFF] pt-1">
                            Views: {adminStats.mostViewedBook.view_count}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No views yet.</p>
                      )}
                    </div>

                    <div className="bg-white dark:bg-[#181720] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Most Downloaded Book</h2>
                      {adminStats.mostDownloadedBook ? (
                        <div className="text-xs space-y-1">
                          <p className="font-bold text-sm">{adminStats.mostDownloadedBook.title}</p>
                          <p className="text-slate-500">By {adminStats.mostDownloadedBook.author}</p>
                          <p className="font-semibold text-emerald-600 dark:text-emerald-400 pt-1">
                            Downloads: {adminStats.mostDownloadedBook.download_count}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No downloads yet.</p>
                      )}
                    </div>

                    <div className="bg-white dark:bg-[#181720] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Most Saved Book</h2>
                      {adminStats.mostSavedBook ? (
                        <div className="text-xs space-y-1">
                          <p className="font-bold text-sm">{adminStats.mostSavedBook.title}</p>
                          <p className="text-slate-500">By {adminStats.mostSavedBook.author}</p>
                          <p className="font-semibold text-amber-600 dark:text-amber-400 pt-1">
                            Saved to Library: {adminStats.mostSavedBook.save_count}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No saves yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-[#181720] p-5 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <h2 className="text-sm font-bold mb-3">Most Popular Books (Views + Downloads + Saves)</h2>
                    <div className="space-y-2">
                      {adminStats.popularBooks?.map((b, i) => (
                        <div key={b.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-[#23222E] text-xs">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">#{i + 1} {b.title}</p>
                            <p className="text-slate-500 truncate">
                              {b.view_count} views • {b.download_count} downloads • {b.save_count} saved
                            </p>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full bg-[#EAE7F8] dark:bg-[#27233B] text-[#4C38D6] dark:text-[#B4A7FF] font-semibold shrink-0">
                            Score: {b.popularity_score}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-[#181720] p-5 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <h2 className="text-sm font-bold mb-3">Books by Category</h2>
                    <div className="flex flex-wrap gap-2">
                      {adminStats.categories?.map((c) => (
                        <span key={c.category} className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-[#23222E] text-xs font-medium">
                          {c.category}: <strong>{c.count}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {isAdmin && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <form onSubmit={handleAdminAddBook} className="bg-white dark:bg-[#181720] p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <h2 className="text-sm font-bold flex items-center gap-1.5">
                      <Plus className="w-4 h-4 text-[#5B46E8]" />
                      <span>Add Book to Catalog</span>
                    </h2>
                    <input
                      type="text"
                      value={newBookTitle}
                      onChange={(e) => setNewBookTitle(e.target.value)}
                      placeholder="Book title"
                      className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#23222E] text-xs"
                      required
                    />
                    <input
                      type="text"
                      value={newBookAuthor}
                      onChange={(e) => setNewBookAuthor(e.target.value)}
                      placeholder="Author name"
                      className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#23222E] text-xs"
                      required
                    />
                    <select
                      value={newBookCategory}
                      onChange={(e) => setNewBookCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#23222E] text-xs"
                    >
                      {adminCategoryOptions.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <textarea
                      rows={2}
                      value={newBookDesc}
                      onChange={(e) => setNewBookDesc(e.target.value)}
                      placeholder="Short description"
                      className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#23222E] text-xs"
                    />
                    <button type="submit" className="px-4 py-2 rounded-xl bg-[#5B46E8] text-white text-xs font-semibold">
                      Save Book
                    </button>
                  </form>

                  <div className="bg-white dark:bg-[#181720] p-5 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <h2 className="text-sm font-bold mb-3">Recent Catalog Entries</h2>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {books.slice(-12).reverse().map((b) => (
                        <div key={b.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-[#23222E] text-xs">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">#{b.id} — {b.title}</p>
                            <p className="text-slate-500 truncate">{b.author} • {b.category}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAdminDeleteBook(b.id)}
                            title="Delete book"
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'ai' ? (
            <div className="max-w-3xl bg-white dark:bg-[#181720] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm">
              <div className="h-80 sm:h-96 overflow-y-auto space-y-4 mb-4 pr-1 sm:pr-2">
                {aiMessages.map((msg, idx) => (
                  <div key={idx} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-lg px-4 py-2.5 rounded-2xl text-xs sm:text-sm ${msg.sender === 'user' ? 'bg-[#5B46E8] text-white' : 'bg-slate-100 dark:bg-[#23222E]'}`}>
                      {msg.text}
                    </div>
                    {msg.toolsUsed?.length > 0 && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Tools executed: {msg.toolsUsed.join(' -> ')}
                      </p>
                    )}
                    {msg.pendingSaveBook && (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirmAiSave(msg.pendingSaveBook, idx)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                        >
                          Confirm Save &ldquo;{msg.pendingSaveBook.title}&rdquo; to My Library
                        </button>
                      </div>
                    )}
                    {msg.books?.length > 0 && (
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                        {msg.books.map((b) => (
                          <div key={b.id} onClick={() => handleOpenBookDetails(b)} className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#1E1D27] border border-slate-200 dark:border-slate-800 text-xs cursor-pointer">
                            <p className="font-semibold truncate">{b.title}</p>
                            <p className="text-slate-500 truncate">{b.author}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {aiLoading && <p className="text-xs text-slate-400">AI agent is running tools...</p>}
              </div>
              <form onSubmit={handleSendAi} className="flex gap-2">
                <input
                  type="text"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="Ask to recommend, compare, or save a book to My Library..."
                  className="flex-1 px-3.5 sm:px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-[#23222E] text-xs sm:text-sm focus:outline-none"
                />
                <button type="submit" className="px-4 py-2.5 rounded-xl bg-[#5B46E8] text-white">
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="flex items-center sm:flex-wrap gap-2 overflow-x-auto pb-2 sm:pb-0 mb-5 sm:mb-7">
                {availableCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 sm:px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                      selectedCategory === cat ? 'bg-[#5B46E8] text-white shadow-sm' : 'bg-white dark:bg-[#1C1B24] border border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {loading ? (
                <p className="text-sm text-slate-500">Loading library catalog...</p>
              ) : catalogError ? (
                <div className="text-center py-12 px-4 bg-white dark:bg-[#181720] rounded-2xl border border-red-200 dark:border-red-900/50 space-y-2">
                  <p className="text-red-500 text-xs font-semibold">{catalogError}</p>
                  <button
                    type="button"
                    onClick={fetchBooksCatalog}
                    className="px-4 py-1.5 rounded-xl bg-[#5B46E8] text-white text-xs font-semibold"
                  >
                    Retry
                  </button>
                </div>
              ) : displayedBooks.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-[#181720] rounded-2xl border border-slate-200 dark:border-slate-800">
                  <p className="text-slate-500 text-sm">No books found.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-5">
                  {displayedBooks.map((book) => {
                    const isSaved = savedIds.includes(book.id);
                    const isDownloaded = downloadedIds.includes(book.id);

                    return (
                      <div key={book.id} className="bg-white dark:bg-[#181720] rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-800 p-2 sm:p-4 flex flex-col justify-between shadow-xs">
                        <div>
                          <div onClick={() => handleOpenBookDetails(book)} className="aspect-[3/4] w-full rounded-lg sm:rounded-xl overflow-hidden bg-slate-100 dark:bg-[#23222E] mb-2 sm:mb-3.5 cursor-pointer relative group">
                            <img
                              src={book.cover_url || getFallbackCover(book)}
                              alt={book.title}
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = getFallbackCover(book);
                              }}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <span className="hidden sm:inline-block absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#5B46E8]/90 text-white">
                              {book.category}
                            </span>
                          </div>
                          <h3 onClick={() => handleOpenBookDetails(book)} className="font-semibold text-xs sm:text-sm line-clamp-1 cursor-pointer hover:text-[#5B46E8]">{book.title}</h3>
                          <p className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">{book.author}</p>
                          <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 mt-2 mb-3 line-clamp-2 leading-relaxed">{book.description}</p>
                        </div>
                        <div className="flex items-center gap-1 sm:gap-2 pt-1.5 sm:pt-2 mt-1.5 sm:mt-0 border-t border-slate-100 dark:border-slate-800">
                          <button onClick={() => handleToggleSave(book.id)} className={`p-1 sm:p-2 rounded-md sm:rounded-lg border shrink-0 ${isSaved ? 'bg-[#EAE7F8] border-[#5B46E8] text-[#5B46E8]' : 'border-slate-200 dark:border-slate-700'}`}>
                            <Bookmark className="w-3 h-3 sm:w-4 sm:h-4" />
                          </button>
                          <button onClick={() => handleReadBook(book)} className="flex-1 py-1 sm:py-1.5 px-1.5 sm:px-3 rounded-md sm:rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] sm:text-xs font-medium">Read</button>
                          <button onClick={() => handleDownloadBook(book)} className={`flex-1 py-1 sm:py-1.5 px-1.5 sm:px-3 rounded-md sm:rounded-lg text-[10px] sm:text-xs font-medium text-white flex items-center justify-center gap-0.5 sm:gap-1 ${isDownloaded ? 'bg-emerald-600' : 'bg-[#5B46E8]'}`}>
                            {isDownloaded ? <><CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> <span>Saved</span></> : <span>Get</span>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {readingBook && currentChapter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-4">
          <div className="w-full max-w-4xl h-[88vh] max-h-[88vh] flex flex-col bg-white dark:bg-[#1B1A24] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 pb-3 sm:pb-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex gap-3 sm:gap-4 min-w-0">
                <img
                  src={readingBook.cover_url || getFallbackCover(readingBook)}
                  alt={readingBook.title}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = getFallbackCover(readingBook);
                  }}
                  className="w-12 sm:w-14 h-16 sm:h-20 object-cover rounded-lg shrink-0 bg-slate-100"
                />
                <div className="min-w-0">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#EAE7F8] dark:bg-[#27233B] text-[#5B46E8] mb-1">
                    {readingBook.category} • Chapter {currentChapter.number} of {readerChapters.length}
                  </span>
                  <h2 className="text-base sm:text-lg font-bold leading-snug truncate">{readingBook.title}</h2>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">
                    By {readingBook.author} • {hasRealFullText ? 'Public-Domain Full Text' : 'Full-Length Reference Edition'}
                  </p>
                  {readingBook.description && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">
                      {readingBook.description}
                    </p>
                  )}
                </div>
              </div>
              <button onClick={() => setReadingBook(null)} className="text-slate-400 hover:text-slate-600 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto py-2.5 sm:py-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
              {readerChapters.map((ch, idx) => (
                <button
                  key={ch.number}
                  type="button"
                  onClick={() => setActiveChapterIdx(idx)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    idx === activeChapterIdx
                      ? 'bg-[#5B46E8] text-white'
                      : 'bg-slate-100 dark:bg-[#252432] text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {ch.title}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto py-4 sm:py-6 px-1 sm:px-3 space-y-4">
              <div className="max-w-2xl mx-auto space-y-4">
                <h3 className="text-base sm:text-lg font-bold border-b border-slate-100 dark:border-slate-800 pb-2">
                  {currentChapter.title}
                </h3>
                {currentChapter.paragraphs.map((para, pIdx) => (
                  <p key={pIdx} className="text-sm sm:text-[15px] text-slate-700 dark:text-slate-300 leading-7">
                    {para}
                  </p>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  disabled={activeChapterIdx === 0}
                  onClick={() => setActiveChapterIdx((prev) => Math.max(0, prev - 1))}
                  className="flex items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>
                <button
                  type="button"
                  disabled={activeChapterIdx >= readerChapters.length - 1}
                  onClick={() => setActiveChapterIdx((prev) => Math.min(readerChapters.length - 1, prev + 1))}
                  className="flex items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleDownloadBook(readingBook)}
                className="px-3.5 sm:px-4 py-2 rounded-xl bg-[#5B46E8] text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Full PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl bg-white dark:bg-[#1B1A24] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-2xl">
            <div className="flex justify-between items-start gap-4">
              <div className="flex gap-4 sm:gap-5">
                <img
                  src={selectedBook.cover_url || getFallbackCover(selectedBook)}
                  alt={selectedBook.title}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = getFallbackCover(selectedBook);
                  }}
                  className="w-20 sm:w-28 h-28 sm:h-40 object-cover rounded-xl shadow-md shrink-0 bg-slate-100"
                />
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#EAE7F8] dark:bg-[#27233B] text-[#5B46E8] mb-2">{selectedBook.category}</span>
                  <h2 className="text-base sm:text-lg font-bold leading-snug">{selectedBook.title}</h2>
                  <p className="text-xs font-medium text-slate-500 mt-1">By {selectedBook.author}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 sm:mt-3 leading-relaxed">{selectedBook.description}</p>
                </div>
              </div>
              <button onClick={() => setSelectedBook(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex justify-end gap-2 sm:gap-3 mt-5 sm:mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => { const bookToRead = selectedBook; setSelectedBook(null); handleReadBook(bookToRead); }} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">Read Book</button>
              <button onClick={() => { handleDownloadBook(selectedBook); setSelectedBook(null); }} className="px-4 sm:px-5 py-2 rounded-xl bg-[#5B46E8] text-white text-xs font-semibold flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /><span>Download PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#1B1A24] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Lock className="w-4 h-4 text-[#5B46E8]" />
                <span>{authMode === 'login' ? 'Member Log In' : 'Create Member Account'}</span>
              </div>
              <button onClick={() => setShowAuthModal(false)} className="text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#252432] mb-4">
              <button type="button" onClick={() => { setAuthMode('login'); setAuthError(''); }} className={`py-1.5 rounded-lg text-xs font-semibold ${authMode === 'login' ? 'bg-white dark:bg-[#1B1A24] text-[#5B46E8] shadow-xs' : 'text-slate-500'}`}>Log In</button>
              <button type="button" onClick={() => { setAuthMode('register'); setAuthError(''); }} className={`py-1.5 rounded-lg text-xs font-semibold ${authMode === 'register' ? 'bg-white dark:bg-[#1B1A24] text-[#5B46E8] shadow-xs' : 'text-slate-500'}`}>Sign Up</button>
            </div>
            {authError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs font-medium text-red-600 dark:text-red-300">
                {authError}
              </div>
            )}
            <form onSubmit={handleAuthSubmit} className="space-y-3.5" noValidate>
              {authMode === 'register' && (
                <div>
                  <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-300">Name</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Mark" className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#252432] text-xs focus:outline-none" required />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-300">Gmail Account</label>
                <input
                  type="text"
                  value={authUsername}
                  onChange={(e) => {
                    setAuthUsername(e.target.value);
                    if (authError) setAuthError('');
                  }}
                  placeholder="example@gmail.com"
                  className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#252432] text-xs focus:outline-none"
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">Must use an @gmail.com address</p>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-300">Password</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => {
                    setAuthPassword(e.target.value);
                    if (authError) setAuthError('');
                  }}
                  placeholder="More than 6 characters"
                  className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#252432] text-xs focus:outline-none"
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">Must be more than 6 characters</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAuthModal(false)} className="px-4 py-2 rounded-xl border text-xs font-medium">Cancel</button>
                <button type="submit" disabled={authLoading} className="px-5 py-2 rounded-xl bg-[#5B46E8] text-white text-xs font-semibold">
                  {authLoading ? 'Please wait...' : authMode === 'login' ? 'Log In' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
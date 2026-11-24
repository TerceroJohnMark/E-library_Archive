require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function mapCategory(subjects = [], bookshelves = [], title = '') {
  const combined = [...subjects, ...bookshelves, title].join(' ').toLowerCase();

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
  if (/\b(fiction|novels|short stories|literature|classics)\b/.test(combined)) {
    return 'Fiction';
  }

  return 'General Classics';
}

function pickPlainTextUrl(formats = {}) {
  return (
    formats['text/plain; charset=utf-8'] ||
    formats['text/plain; charset=us-ascii'] ||
    formats['text/plain'] ||
    null
  );
}

async function fetchTextSnippet(textUrl, maxChars = 60000) {
  if (!textUrl) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(textUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const raw = await res.text();
    return raw.replace(/\r\n/g, '\n').slice(0, maxChars);
  } catch {
    return null;
  }
}

async function seedRealBooks(targetCount = 210) {
  try {
    console.log(`Fetching ${targetCount}+ public-domain books from Gutendex...`);
    let nextUrl = 'https://gutendex.com/books?languages=en&copyright=false';
    const collected = [];

    while (nextUrl && collected.length < targetCount) {
      const res = await fetch(nextUrl);
      if (!res.ok) {
        throw new Error(`Gutendex request failed with status ${res.status}`);
      }
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];

      for (const item of results) {
        if (collected.length >= targetCount) break;
        const authors = Array.isArray(item.authors) && item.authors.length
          ? item.authors.map((a) => a.name).join(', ')
          : 'Unknown Author';
        const formats = item.formats || {};
        const coverUrl =
          formats['image/jpeg'] ||
          `https://covers.openlibrary.org/b/title/${encodeURIComponent(item.title || 'book')}-L.jpg`;
        const textUrl = pickPlainTextUrl(formats);
        const category = mapCategory(item.subjects, item.bookshelves, item.title);
        const summary =
          Array.isArray(item.subjects) && item.subjects.length
            ? `Public-domain edition (${category}). Subjects: ${item.subjects.slice(0, 3).join('; ')}.`
            : `Public-domain edition in ${category} sourced from Project Gutenberg.`;

        collected.push({
          source_id: item.id,
          title: item.title || 'Untitled Book',
          author: authors,
          category,
          description: summary,
          cover_url: coverUrl,
          text_url: textUrl
        });
      }

      nextUrl = data.next;
    }

    console.log(`Collected ${collected.length} books. Clearing old books and inserting into Supabase...`);
    await pool.query('DELETE FROM books');

    for (let i = 0; i < collected.length; i++) {
      const book = collected[i];
      const fullText = await fetchTextSnippet(book.text_url);

      const inserted = await pool.query(
        `INSERT INTO books (
           title, author, category, description, file_url, cover_url,
           view_count, download_count, source_id, text_url, full_text
         )
         VALUES ($1, $2, $3, $4, '/api/books/0/file', $5, 0, 0, $6, $7, $8)
         RETURNING id`,
        [
          book.title,
          book.author,
          book.category,
          book.description,
          book.cover_url,
          book.source_id,
          book.text_url,
          fullText
        ]
      );

      const bookId = inserted.rows[0].id;
      await pool.query(`UPDATE books SET file_url = $1 WHERE id = $2`, [
        `/api/books/${bookId}/file`,
        bookId
      ]);

      if ((i + 1) % 25 === 0 || i + 1 === collected.length) {
        console.log(`Inserted ${i + 1}/${collected.length} books...`);
      }
    }

    console.log(`Done! Seeded ${collected.length} real public-domain books into Supabase.`);
    process.exit(0);
  } catch (err) {
    console.error('Error seeding real books:', err);
    process.exit(1);
  }
}

seedRealBooks(210);
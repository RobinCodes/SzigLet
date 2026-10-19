# SzigLet

A shared flashcard library. One library, everybody studies the same sets, and a
handful of editors keep them up to date.

Two study modes, in the order the app enforces them:

1. **Flashcards** — pick what goes on the front and the back (Italian →
   Hungarian, the other way round, or any two variations), swipe right for *known* and left for *needs rehearsing*. Anything you
   push to rehearse comes back a few cards later. The round ends when every card
   is known.
2. **Tests** — unlocked once the deck is clear. Multiple choice, written, or
   mixed; whatever you get wrong comes straight back in the next round, and
   the test only ends when every card is right.

Progress is stored per account **and per direction**, because knowing
*la cucina → konyha* is not the same as knowing *konyha → la cucina*.

A card can carry a **note** — the context a single word cannot hold. *il
gesso* is *kréta* in a classroom and *gipsz* everywhere else, and that is
worth saying on the back of the card rather than in a third set. Notes show
when a card is flipped, when a test reveals the answer, and in the set's card
list.

### Variations

A card is not just two sides. Every set has its two languages, and can add
**variations** — *Italian plural*, *Italian with article*, anything an editor
names. Each field on a card says which variation it is; a × removes one, a +
adds another (one the set already has, a common one, or a new name). The set
decides which variations a new card starts with, so nobody types *the
plural* label a hundred times. Before studying, the learner picks any two:
Hungarian → Italian plural, singular → plural, whatever is worth drilling.

Sets made before variations existed read as the two languages; their old
article and plural fields were turned into variations of their own when the
database was upgraded, so nothing typed was lost.

Two more card settings:

- **One way** — a card can be asked only from Italian, or only towards it.
- **Preferred answers** — `ház; épület` accepts both, but when that side is
  the *question* only the starred one is shown (the first, unless changed).
  Star several and all of them are shown.

A **verb** is its own kind of card: the infinitive, its translation, and the
six present-tense forms — shown as six little cards to flip, and available as
variations of their own (*Hungarian → Italian · noi*).

**Mastery is scored per direction**, out of a hundred: half for swiping every
card to known, a quarter for the multiple choice test, a quarter for the
written one. Writing a set out subsumes multiple choice, so a written pass is
worth the whole test half on its own. Every pair of variations is scored on
its own, because being able to read a word and being able to produce it are
different skills and one average hid which was missing. A **mixed** test asks
some cards each way and counts as multiple choice; a test over only some of
the cards (*Advanced → how many*) is practice and does not count.

### Courses

Beyond sets there are **courses**: a path of **nodes**, Duolingo-style. Each
node is a few **steps**, and each step a handful of **parts**:

| Part | What the learner does |
| --- | --- |
| Vocabulary | one word, four options or typed |
| Matching pairs | five words a side, tap one on each side to pair them |
| Questions | a question (or a sentence with a gap) and its answers |
| Side by side | two or three questions with one pool of answers — *c'è / ci sono* |

Every part can be answered by choosing, by writing, or either at random.
A lesson draws a set number of exercises (the learner picks how many) from
the current step: what still counts towards completion first, then review. A
word never seen before is introduced right before it is first asked, and
whatever was missed comes back at the end of the lesson.

A part can **need something first** — another whole part, or one particular
word or question, either *seen* or *solved* — so nobody is asked about a
word they have not met. And each part says **when it is done**: not required,
every item seen, every item solved *n* times, or every item right the last
time it came up. A step opens when the one before it is done, a node when the
one before it is.

**Questions** live in **question sets**, or are written straight into a
node. A word set can be poured into a question's answers in one go, each
marked right, wrong or left out.

### For authors

A set or course can have **several authors**. Learners can **report** a card
or question — and hide it for themselves until somebody has looked — and the
reports go to the authors. Authors also see **statistics**: how many people
use the set or course, how far they get, which cards trip people up, which
node is most popular. All of it counted, none of it named.

Any set can be **exported as text** and pasted into another. Word sets are
tab-separated with a header naming the variations, so a spreadsheet opens
them too; question sets use one symbol per line (`!` instruction, `?`
question, `+` right, `-` wrong, `>` note).

The interface speaks **Italian by default, with Hungarian and English** under
*Account → Language*. Cards are never translated; they are whatever the
editors typed.

## What is in here

```
src/            the front end — React + TypeScript, no UI framework
  lib/          api client, proof-of-work solver, study engine, grading
  lib/variants.ts  the ways a card can be shown, and which pairs are askable
  lib/lesson.ts    building lessons, prerequisites, what counts as done
  lib/exchange.ts  sets as text, out and back in
  lib/i18n/     one dictionary per language; Italian is the source of truth
  components/   shell, swipe deck, small primitives
  routes/       one file per screen
server/         the API — PHP 8.1+, one front controller, no dependencies
  app/          database, auth, bot defence, sets, courses, progress, reports
public/         manifest, service worker, icons
deploy/         the .htaccess for the document root
scripts/        packaging for cPanel, service-worker manifest
.github/        build, lint and FTPS deploy on push to main
```

`lib/i18n/it.ts` is typed as the shape every other dictionary must match, so a
missing or misspelled key is a build error rather than a raw key on screen.

Everything on a card beyond its two base sides — variations, verb forms,
gender, preferred answers, one-way — lives in one `extras` JSON column rather
than a column per feature: it is sparse, and the list keeps growing. A node's
steps and parts are likewise one JSON document, because they are only ever
edited and read as a whole. The rules for lessons run in the browser, which
has the whole node in hand anyway; the server stores the structure and each
learner's record per card and question, and checks what it is given.

## Marking an answer

Answers are compared with the accents folded away and the punctuation trimmed,
so a missing accent is a nudge rather than a mistake. Two separators let one
card accept more than one spelling:

| On the card | Also accepted |
| --- | --- |
| `ház; épület` | either word |
| `vi/vu` | `vi`, `vu`, or both as written — spaces around the slash are ignored |
| `ház (épület)` | with or without the bracketed part |

If the card has an article, the article-led form counts too: nobody who has
been shown *il gesso* all round should be marked wrong for typing it back.

Spaces around a dash do not count either: `nord - est` is `nord-est`.

A near miss keeps what was typed in the box, so it can be fixed rather than
retyped, and **Enter checks the fix**. The second near miss also marks where
the mistake is — the wrong letter underlined, a missing one shown as a gap,
without giving the answer away. A third counts as wrong, and *show me the
answer* is there throughout.

## Running it locally

You need Node 20+ and PHP 8.1+ with the PDO MySQL extension, plus a MySQL or
MariaDB database.

```bash
npm install
cp server/app/config.sample.php server/app/config.php   # then edit it
npm run dev:api     # PHP on :8787
npm run dev         # Vite on :5173, proxying /api to the PHP server
```

Open <http://localhost:5173>. The tables create themselves on the first
request. Register the username you put in `owner_username` and that account
becomes the owner.

## Deploying

Push to `main`: the GitHub workflow builds and uploads over FTPS, and installed
phones offer a one-tap reload the next time they are opened. By hand it is
`npm run build && npm run package`, then everything inside `deploy/build/`
goes to `public_html`.

Either way, see [DEPLOY.md](DEPLOY.md) — in particular the two files on the
server that a deploy must never overwrite, and what to do when the
Content-Security-Policy hash moves.

## Working offline

The service worker precaches the whole build, not just the HTML, because it is
registered on `load` and is otherwise too late to catch the JavaScript that
drew the page. `scripts/sw-manifest.mjs` writes that file list, and a hash of
the build, into `dist/sw.js` after `vite build`; the hash names the caches, so
a new build gets fresh ones and sweeps the old ones up.

`/api/auth/me` is cached alongside the library, which is what lets an installed
app answer "who is signed in" with no connection instead of bouncing you to the
sign-in screen. Swipes and test results made offline queue in `localStorage`
and replay in order once there is a connection.

A waiting build never takes over a running page by itself — that would leave it
asking for chunks the new build does not have. It waits, the app says so, and
the reader decides.

## How the bot defence works

No captcha, no third-party service, nothing to click through in a dashboard:

- **Proof of work.** Before a registration or sign-in is accepted, the browser
  must find a nonce whose SHA-256 hash starts with N zero bits. The challenge is
  signed by the server, expires in ten minutes and can only be used once. One
  honest signup costs a fraction of a second; a hundred thousand fake ones cost
  real money. Difficulty is per purpose and climbs automatically for an address
  that keeps failing to sign in.
- **Rate limits** per IP and per account, kept in MySQL so they hold across the
  pool of PHP processes a shared host gives you.
- **A honeypot field** and a minimum form-fill time, which catch scripted posts
  that never rendered the page.
- **Argon2id** password hashing where the host provides it, bcrypt cost 12
  otherwise, with automatic upgrade on next sign-in.
- **Session tokens** stored hashed in the database and handed out in an
  httpOnly, Secure, SameSite=Lax cookie, so JavaScript can never read them.
  A double-submit CSRF token covers every state-changing request.
- **No user enumeration**: a wrong name and a wrong password give the same
  answer, in the same amount of time.

Difficulty and limits live in `server/app/config.php`.

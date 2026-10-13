# SzigLet

A shared flashcard library. One library, everybody studies the same sets, and a
handful of editors keep them up to date.

Two study modes, in the order the app enforces them:

1. **Flashcards** — pick a direction (Italian → Hungarian or the other way
   round), swipe right for *known* and left for *needs rehearsing*. Anything you
   push to rehearse comes back a few cards later. The round ends when every card
   is known.
2. **Tests** — unlocked once the deck is clear. Multiple choice or written
   answers; whatever you get wrong comes straight back in the next round, and
   the test only ends when every card is right.

Progress is stored per account **and per direction**, because knowing
*la cucina → konyha* is not the same as knowing *konyha → la cucina*.

A card can carry a **note** — the context a single word cannot hold. *il
gesso* is *kréta* in a classroom and *gipsz* everywhere else, and that is
worth saying on the back of the card rather than in a third set. Notes show
when a card is flipped, when a test reveals the answer, and in the set's card
list.

It can also carry **grammar**: an article, a plural and a gender, per side.
Each of the three is a switch on the set, so a round can put *il* in front of
every noun, or add *(m)* after it, or show the plural on a second line —
without that becoming a second set of cards. Anything switched off is still
one tap away on the back of the card, so you can check the gender of one
awkward noun without turning gender on for everything.

A verb can carry its **six present-tense forms**, shown as six little cards you
flip one at a time — a table you can test yourself against rather than just
read.

**Mastery is scored per direction**, out of a hundred: half for swiping every
card to known, a quarter for the multiple choice test, a quarter for the
written one. Writing a set out subsumes multiple choice, so a written pass is
worth the whole test half on its own. Italian→Hungarian and Hungarian→Italian
are scored separately, because being able to read a word and being able to
produce it are different skills and one average hid which was missing.

The interface speaks **Italian by default, with Hungarian and English** under
*Account → Language*. Cards are never translated; they are whatever the
editors typed.

## What is in here

```
src/            the front end — React + TypeScript, no UI framework
  lib/          api client, proof-of-work solver, study engine, grading
  lib/word.ts   reading a card's grammar, and scoring a set
  lib/i18n/     one dictionary per language; Italian is the source of truth
  components/   shell, swipe deck, small primitives
  routes/       one file per screen
server/         the API — PHP 8.1+, one front controller, no dependencies
  app/          database, auth, bot defence, sets, progress, admin
public/         manifest, service worker, icons
deploy/         the .htaccess for the document root
scripts/        packaging for cPanel, service-worker manifest
.github/        build, lint and FTPS deploy on push to main
```

`lib/i18n/it.ts` is typed as the shape every other dictionary must match, so a
missing or misspelled key is a build error rather than a raw key on screen.

A card's grammar lives in one `extras` JSON column rather than a column per
feature: it is sparse, almost no card has all of it, and the list is going to
keep growing. Every field is stored per side, because the app cannot know
which side is the Italian one — `langA` and `langB` are free text an editor
typed.

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

A near miss is forgiven **once** per card, and the nudge comes with a way out.
Collecting the same nudge forever, with nothing on screen offering to just show
you the answer, was a trap rather than a kindness.

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

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

## What is in here

```
src/            the front end — React + TypeScript, no UI framework
  lib/          api client, proof-of-work solver, study engine, grading
  components/   shell, swipe deck, small primitives
  routes/       one file per screen
server/         the API — PHP 8.1+, one front controller, no dependencies
  app/          database, auth, bot defence, sets, progress, admin
public/         manifest, service worker, icons
deploy/         the .htaccess for the document root
scripts/        packaging for cPanel
```

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

See [DEPLOY.md](DEPLOY.md). In short: `npm run build && npm run package`, then
upload everything inside `deploy/build/` to `public_html`.

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

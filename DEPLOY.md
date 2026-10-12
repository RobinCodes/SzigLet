# Putting SzigLet on cPanel hosting

About twenty minutes end to end, most of it waiting for DNS.

## 0. What the host has to offer

Any cPanel plan will do, as long as it has:

- **PHP 8.1 or newer** — set per domain, usually in *MultiPHP Manager*
- **MySQL or MariaDB** — one database is enough
- **Free SSL** (AutoSSL / Let's Encrypt) — every cPanel host has this

No Node, no Composer, no SSH needed. 1 GB of space is already generous; the
whole app is well under 1 MB and a few thousand cards are a rounding error.

Whichever PHP version you pick, cPanel records it as a generated block inside
`public_html/.htaccess`:

```apache
# php -- BEGIN cPanel-generated handler, do not edit
```

**That block is not in the build, so re-uploading `.htaccess` deletes it.**
See step 2.

## 1. Build the upload folder

On your own machine:

```bash
npm install
npm run build
npm run package
```

That leaves two things: `deploy/build/`, which is exactly what `public_html`
should contain, and `deploy/Upload.zip`, the same tree as one archive.

## 2. Upload

*cPanel → File Manager → public_html* → **Upload** `deploy/Upload.zip`, then
**Extract** it there.

Upload the zip rather than dragging files in. The three `.htaccess` files are
dotfiles, and file pickers routinely refuse to show them — including GTK ones,
where hidden files only appear after **Ctrl+H**. A drag-and-drop upload that
silently omits them leaves the site serving without its rewrite rules or its
CSP. `npm run package` builds the zip by walking the tree itself, so it cannot
make that mistake.

**On a re-deploy, do not overwrite `public_html/.htaccess` blindly.** cPanel
appends its PHP handler block to that file, and the build does not contain it.
Overwrite it and the domain loses its PHP version. Either extract everything
else and leave that one file, or paste the cPanel block back afterwards.

After extracting, `public_html` should look like:

```
public_html/
  .htaccess
  index.html
  manifest.webmanifest
  sw.js
  robots.txt
  assets/
  icons/
  api/
    .htaccess
    index.php        <- version check only, deliberately PHP 5 syntax
    app/
      main.php       <- every route lives here
```

`api/index.php` looks almost empty on purpose. PHP parses a whole file before
running any of it, so a version check sitting beside `match()` or a `readonly`
property can never fire on the old versions it is meant to catch — the request
dies as a blank 500 instead. Keeping the entry point boring is what makes
`php_too_old` reachable.

## 3. Create the database

*cPanel → MySQL® Database Wizard* — the wizard is three screens:

1. Database name, e.g. `sziglet`. cPanel prefixes it with your account name, so
   it ends up as something like `szigacc_sziglet`. **Write down the full name.**
2. A database user and a generated password. Write both down.
3. Privileges: tick **ALL PRIVILEGES**.

## 4. Configure

In the File Manager, go to `public_html/api/app/`, rename
`config.sample.php` to **`config.php`**, then *Edit* it:

```php
'db' => [
    'host'     => 'localhost',
    'name'     => 'szigacc_sziglet',   // the full prefixed name
    'user'     => 'szigacc_robin',
    'password' => 'the password from step 3',
    'port'     => 3306,
],

'secret' => 'paste 64+ random characters here',

'owner_username' => 'robin',           // the name you will register with
```

For the secret, mash the keyboard until you are past sixty characters, or run
`openssl rand -hex 32` anywhere. It signs the proof-of-work challenges and
hashes IP addresses. Changing it later signs everyone out, nothing worse.

## 5. Attach the domain and get HTTPS

Worth starting before step 1 — DNS needs time to settle and nothing else here
depends on it.

Both the domain and the hosting are at Rackhost, so **you do not touch DNS
records at all.** This happens inside cPanel, not in the Rackhost admin panel —
Rackhost's own hosting screens are for their older, non-cPanel plans and have
no domain settings for a cPanel account.

Two things to settle before you start:

- A domain can only be attached to one hosting at a time. If it is still on an
  older plan, detach it there first.
- Attaching it to cPanel **replaces the domain's existing DNS zone**. If
  anything is live on that domain — email above all — write the current records
  down before you start.

Then:

*cPanel → Domains → **Create A New Domain***

Enter the domain, and **tick "Share document root (`.../public_html`) with
…"** before submitting. Unticked — the default — cPanel gives the domain its
own empty folder and your site stays invisible in `public_html`.

Rackhost generates the `A`, `CNAME` and `MX` records for you.

Then *MultiPHP Manager* → set the domain to **PHP 8.1 or newer**.

Wait for `dig +short your-domain.hu` to return an address, then in cPanel:
*SSL/TLS Status* → **Run AutoSSL**. AutoSSL proves you own the domain over
plain HTTP, so it fails until the name resolves; that is not a fault, just
re-run it. Once the padlock works, open `public_html/.htaccess` and uncomment
the `Strict-Transport-Security` line.

From here on, edit DNS records **in cPanel's Zone Editor only**. Edits made in
Rackhost's own DNS panel will appear to save and then do nothing.

### No domain yet?

The account has a technical hostname of its own, and the whole app runs on it —
upload, database, `/api/_health`, accounts, sets, tests. Only the service
worker and PWA install need HTTPS and a real domain. Attaching one later
changes no files and no config.

## 6. First run

Visit `https://your-domain/api/_health`. You want:

```json
{"ok":true,"app":"SzigLet","schema":1,"php":"8.2.x","argon2":true,"claimed":false}
```

That single request also creates every table. If instead you get:

| Message | What to do |
| --- | --- |
| `not_configured` | `config.php` is missing or still named `config.sample.php` |
| `database_unavailable` | Database name, user or password is wrong in `config.php` |
| `weak_secret` | The `secret` is still the placeholder, or shorter than 32 characters |
| `php_too_old` | *MultiPHP Manager* → set this domain to PHP 8.1+ |
| A 404 page | `api/.htaccess` did not upload — check hidden files |
| **A blank 500, no body at all** | A PHP fatal error. Read the log — see below. |

### A blank 500 means: go read the log

Every failure the app knows about answers in JSON. An empty body with a 500 is
PHP dying before the app gets a say — a parse error or a fatal. The message is
always written to the error log, and it names the file and line:

```
PHP Fatal error: Cannot redeclare non-readonly property Exception::$code
as readonly SzigLet\ApiError::$code in api/app/Http.php on line 6
```

Find the log path in `public_html/php.ini` (`error_log = ...`), then open it in
the File Manager. On Rackhost it is `~/logs/php.error.log`.

Read it **first**. It is faster than any amount of reasoning about which
setting might be wrong, and it is right.

Now open `https://your-domain/`, choose **Create account**, and register with
exactly the `owner_username` from step 4. That account becomes the owner. Every
account after it is a learner until you promote it from **Admin → People**.

`argon2: false` is not a problem — the app falls back to bcrypt at cost 12.

## 7. Sanity check

- Register a second account in a private window; it should land as a learner.
- From the owner account, **Admin → People**, flip it to *Editor*.
- As the editor, **New set**, paste a word list, save.
- Swipe the whole set to Known, then take a test.
- On your phone, open the site and follow **Install**.

## A starter set to paste

**Editor → New set → Paste a list**, front side `Italian`, back side
`Hungarian`:

```
la cucina, konyha
il frigorifero, hűtőszekrény
il coltello, kés
la forchetta, villa
il cucchiaio, kanál
il piatto, tányér
il bicchiere, pohár
la tazza, csésze
la pentola, lábas
il forno, sütő
la tavola, asztal
la sedia, szék
```

Alternative answers go after a semicolon (`ház; épület`), and anything in
brackets is optional when typing (`hűtő (szekrény)`).

## Keeping it running

- **Updates.** Rebuild, repackage, upload `deploy/Upload.zip` over the top.
  Two files must survive: `api/app/config.php`, which the packaging step
  deliberately leaves out, and `public_html/.htaccess`, which carries cPanel's
  PHP handler block that the build does not have.
- **Backups.** Automated. `deploy/sziglet-backup.php` sits in the home
  directory, outside `public_html`, and a cron entry runs it every Monday at
  03:17. Each run writes `~/backups/sziglet-DATE.sql.gz` and a dated copy of
  `config.php`, then deletes anything in there over a year old. Roughly 100 KB
  a week. Check `~/sziglet-backup.log` if you ever want to confirm it ran.

  Two things that script knows which you would otherwise rediscover the hard
  way: it connects to `127.0.0.1` rather than `localhost`, because cron's PHP
  CLI looks for a Unix socket that is not where the web PHP's is and fails with
  a bare "No such file or directory"; and it dumps via PDO rather than
  `mysqldump`, which is not reliably on cron's PATH here.

  `config.php` is included because the `secret` in it signs every session —
  restoring the database without it logs everyone out.
- **Schema changes.** They apply themselves on the first request after upload.
- **Closing registration.** Set `'registration_open' => false` in `config.php`
  once everyone has an account. Existing people keep signing in.
- **Turning the bot defence up.** If anything ever does get through, raise
  `'pow' => ['register' => 21]`. Each step doubles the work a signup costs;
  19 is roughly a third of a second on a mid-range phone, 22 is about five
  seconds.

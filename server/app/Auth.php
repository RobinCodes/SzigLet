<?php
declare(strict_types=1);

namespace SzigLet;

final class Auth
{
    public const COOKIE      = 'sl_session';
    public const CSRF_COOKIE = 'sl_csrf';
    public const CSRF_HEADER = 'X-SzigLet-Csrf';
    private const LIFETIME   = 90 * 86400;

    /** Usernames that would be confusing or impersonating. */
    private const RESERVED = [
        'admin', 'administrator', 'root', 'owner', 'moderator', 'mod', 'system',
        'sziglet', 'support', 'help', 'api', 'null', 'undefined', 'me', 'you',
        'anonymous', 'guest', 'test', 'deleted',
    ];

    /** The 40 passwords that turn up first in every leak list. */
    private const WEAK = [
        'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
        'qwertyui', 'qwerty123', 'iloveyou', 'sunshine', 'princess', 'football',
        'baseball', 'welcome1', 'abc12345', 'letmein1', 'monkey12', 'dragon12',
        'trustno1', 'starwars', 'whatever', 'computer', 'michelle', 'jennifer',
        'jordan23', 'superman', 'batman12', 'shadow12', 'master12', 'hunter12',
        'asdfghjk', 'zxcvbnm1', '11111111', '00000000', 'aaaaaaaa', 'passw0rd',
        'p@ssword', 'jelszo12', 'szeretlek', 'arvizturo',
    ];

    /** @var array<string, mixed>|null */
    private ?array $user = null;
    private ?string $csrf = null;
    private bool $loaded = false;

    public function __construct(
        private readonly string $secret,
        private readonly Security $security,
    ) {
    }

    // ── Current request ─────────────────────────────────────────────────────

    /** @return array<string, mixed>|null */
    public function user(): ?array
    {
        if ($this->loaded) {
            return $this->user;
        }
        $this->loaded = true;

        $token = $_COOKIE[self::COOKIE] ?? null;
        if (!is_string($token) || $token === '' || strlen($token) > 128) {
            return null;
        }

        $row = Db::one(
            'SELECT s.id AS sid, s.csrf, s.expires_at, s.last_used_at,
                    u.id, u.username, u.role, u.created_at, u.last_seen_at
               FROM sl_sessions s
               JOIN sl_users u ON u.id = s.user_id
              WHERE s.token_hash = :h',
            ['h' => hash('sha256', $token)],
        );
        if ($row === null) {
            return null;
        }
        if ((int) $row['expires_at'] <= Util::now()) {
            Db::run('DELETE FROM sl_sessions WHERE id = :id', ['id' => $row['sid']]);
            return null;
        }

        $this->csrf = (string) $row['csrf'];

        // Rolling expiry, written at most once an hour to spare the database.
        if (Util::now() - (int) $row['last_used_at'] > 3600) {
            Db::run(
                'UPDATE sl_sessions SET last_used_at = :t, expires_at = :e WHERE id = :id',
                ['t' => Util::now(), 'e' => Util::now() + self::LIFETIME, 'id' => $row['sid']],
            );
            Db::run('UPDATE sl_users SET last_seen_at = :t WHERE id = :id',
                ['t' => Util::now(), 'id' => $row['id']]);
        }

        return $this->user = [
            'id'        => (int) $row['id'],
            'username'  => (string) $row['username'],
            'role'      => (string) $row['role'],
            'createdAt' => (int) $row['created_at'],
        ];
    }

    /** @return array<string, mixed> */
    public function require(): array
    {
        $u = $this->user();
        if ($u === null) {
            Http::fail(401, 'unauthenticated', 'Please sign in to continue.');
        }
        return $u;
    }

    /** @return array<string, mixed> */
    public function requireEditor(): array
    {
        $u = $this->require();
        if (!in_array($u['role'], ['editor', 'owner'], true)) {
            Http::fail(403, 'forbidden', 'Only editors can change the library.');
        }
        return $u;
    }

    /** @return array<string, mixed> */
    public function requireOwner(): array
    {
        $u = $this->require();
        if ($u['role'] !== 'owner') {
            Http::fail(403, 'forbidden', 'Only the owner can do that.');
        }
        return $u;
    }

    /**
     * Double-submit CSRF check. SameSite=Lax already blocks cross-site form
     * posts; this closes the gap for anything that slips past it.
     */
    public function checkCsrf(): void
    {
        if ($this->user() === null) {
            return; // nothing to protect yet
        }
        $sent = Http::header(self::CSRF_HEADER) ?? '';
        if ($this->csrf === null || $sent === '' || !Util::hashEquals($this->csrf, $sent)) {
            Http::fail(403, 'csrf', 'Your session expired. Please reload the page.');
        }
    }

    // ── Registration and sign-in ────────────────────────────────────────────

    /** @return array{user:array<string,mixed>,csrf:string} */
    public function register(string $username, string $password, bool $registrationOpen, int $maxPerIpPerDay, string $ownerUsername): array
    {
        if (!$registrationOpen) {
            Http::fail(403, 'closed', 'New accounts are closed at the moment.');
        }

        $ip = Util::ipHash($this->secret);
        $this->security->limit("register:ip:$ip", 8, 3600,
            'Too many attempts from this connection. Please try again in an hour.');

        self::validateUsername($username);
        self::validatePassword($password, $username);

        $key = Util::usernameKey($username);
        if (in_array($key, self::RESERVED, true)) {
            Http::fail(422, 'username_reserved', 'That name is reserved. Please pick another.');
        }

        $madeToday = (int) (Db::value(
            'SELECT COUNT(*) FROM sl_users WHERE signup_ip = :ip AND created_at > :t',
            ['ip' => $ip, 't' => Util::now() - 86400],
        ) ?? 0);
        if ($madeToday >= $maxPerIpPerDay) {
            Http::fail(429, 'too_many_accounts',
                'This connection has created too many accounts today.');
        }

        // The configured owner name claims the owner role on first registration.
        $role = $key === Util::usernameKey($ownerUsername)
            && Db::value("SELECT COUNT(*) FROM sl_users WHERE role = 'owner'") == 0
            ? 'owner'
            : 'viewer';

        try {
            Db::run(
                'INSERT INTO sl_users (username, username_key, password_hash, role, created_at, signup_ip)
                 VALUES (:n, :k, :p, :r, :t, :ip)',
                [
                    'n'  => $username,
                    'k'  => $key,
                    'p'  => self::hash($password),
                    'r'  => $role,
                    't'  => Util::now(),
                    'ip' => $ip,
                ],
            );
        } catch (\PDOException $e) {
            if (($e->errorInfo[1] ?? 0) === 1062) {
                Http::fail(409, 'username_taken', 'That name is already taken.');
            }
            throw $e;
        }

        $id = Db::lastId();
        $this->security->log($id, 'register', "role=$role");

        return $this->startSession($id);
    }

    /** @return array{user:array<string,mixed>,csrf:string} */
    public function login(string $username, string $password): array
    {
        $ip  = Util::ipHash($this->secret);
        $key = Util::usernameKey($username);

        $this->security->limit("login:ip:$ip", 30, 900,
            'Too many sign-in attempts. Please wait a few minutes.');
        $this->security->limit('login:user:' . substr(hash('sha256', $key), 0, 40), 12, 900,
            'Too many sign-in attempts for that account. Please wait a few minutes.');

        $row = Db::one(
            'SELECT id, username, password_hash, role, created_at, failed_count, locked_until
               FROM sl_users WHERE username_key = :k',
            ['k' => $key],
        );

        // Always spend comparable time whether or not the account exists, so
        // response timing does not reveal which usernames are registered.
        $hash = is_array($row) ? (string) $row['password_hash'] : self::dummyHash();
        $ok   = password_verify($password, $hash);

        if ($row === null || !$ok) {
            $this->security->note("loginfail:ip:$ip", 900);
            if (is_array($row)) {
                $fails = (int) $row['failed_count'] + 1;
                $lock  = $fails >= 10 ? Util::now() + 900 : null;
                Db::run(
                    'UPDATE sl_users SET failed_count = :f, locked_until = :l WHERE id = :id',
                    ['f' => $fails, 'l' => $lock, 'id' => $row['id']],
                );
            }
            // Deliberately vague: no distinction between the two failures.
            Http::fail(401, 'bad_credentials', 'That name and password do not match.');
        }

        if ($row['locked_until'] !== null && (int) $row['locked_until'] > Util::now()) {
            $mins = (int) ceil(((int) $row['locked_until'] - Util::now()) / 60);
            Http::fail(423, 'locked', "Too many failed attempts. Try again in {$mins} minute(s).");
        }

        if (password_needs_rehash($hash, self::algo(), self::algoOptions())) {
            Db::run('UPDATE sl_users SET password_hash = :p WHERE id = :id',
                ['p' => self::hash($password), 'id' => $row['id']]);
        }

        Db::run('UPDATE sl_users SET failed_count = 0, locked_until = NULL WHERE id = :id',
            ['id' => $row['id']]);
        $this->security->clear("loginfail:ip:$ip");

        return $this->startSession((int) $row['id']);
    }

    public function changePassword(int $userId, string $current, string $next): void
    {
        $row = Db::one('SELECT username, password_hash FROM sl_users WHERE id = :id', ['id' => $userId]);
        if ($row === null || !password_verify($current, (string) $row['password_hash'])) {
            Http::fail(401, 'bad_credentials', 'Your current password is not right.');
        }
        self::validatePassword($next, (string) $row['username']);
        Db::run('UPDATE sl_users SET password_hash = :p WHERE id = :id',
            ['p' => self::hash($next), 'id' => $userId]);

        // Every other device is signed out; this one gets a fresh session.
        Db::run('DELETE FROM sl_sessions WHERE user_id = :u', ['u' => $userId]);
        $this->startSession($userId);
        $this->security->log($userId, 'password_change');
    }

    public function logout(): void
    {
        $token = $_COOKIE[self::COOKIE] ?? null;
        if (is_string($token) && $token !== '') {
            Db::run('DELETE FROM sl_sessions WHERE token_hash = :h',
                ['h' => hash('sha256', $token)]);
        }
        $this->clearCookies();
    }

    public function logoutEverywhere(int $userId): void
    {
        Db::run('DELETE FROM sl_sessions WHERE user_id = :u', ['u' => $userId]);
        $this->clearCookies();
    }

    // ── Session plumbing ────────────────────────────────────────────────────

    /** @return array{user:array<string,mixed>,csrf:string} */
    private function startSession(int $userId): array
    {
        $token = Util::randomToken(32);
        $csrf  = Util::randomToken(32);
        $now   = Util::now();

        Db::run(
            'INSERT INTO sl_sessions (user_id, token_hash, csrf, created_at, expires_at, last_used_at, ua, ip)
             VALUES (:u, :h, :c, :t, :e, :t2, :ua, :ip)',
            [
                'u'  => $userId,
                'h'  => hash('sha256', $token),
                'c'  => $csrf,
                't'  => $now,
                't2' => $now,
                'e'  => $now + self::LIFETIME,
                'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 190, 'UTF-8'),
                'ip' => Util::ipHash($this->secret),
            ],
        );

        Db::run('UPDATE sl_users SET last_seen_at = :t WHERE id = :id', ['t' => $now, 'id' => $userId]);

        // Trim a user's session list so an old phone cannot hold a key forever.
        Db::run(
            'DELETE FROM sl_sessions WHERE user_id = :u AND id NOT IN (
                 SELECT id FROM (
                     SELECT id FROM sl_sessions WHERE user_id = :u2
                     ORDER BY last_used_at DESC LIMIT 10
                 ) keep
             )',
            ['u' => $userId, 'u2' => $userId],
        );

        $this->setCookie(self::COOKIE, $token, $now + self::LIFETIME, true);
        $this->setCookie(self::CSRF_COOKIE, $csrf, $now + self::LIFETIME, false);

        $row = Db::one('SELECT id, username, role, created_at FROM sl_users WHERE id = :id', ['id' => $userId]);
        $this->loaded = true;
        $this->csrf   = $csrf;
        $this->user   = [
            'id'        => (int) ($row['id'] ?? $userId),
            'username'  => (string) ($row['username'] ?? ''),
            'role'      => (string) ($row['role'] ?? 'viewer'),
            'createdAt' => (int) ($row['created_at'] ?? $now),
        ];

        return ['user' => $this->user, 'csrf' => $csrf];
    }

    private function setCookie(string $name, string $value, int $expires, bool $httpOnly): void
    {
        setcookie($name, $value, [
            'expires'  => $expires,
            'path'     => '/',
            'secure'   => self::isHttps(),
            'httponly' => $httpOnly,
            'samesite' => 'Lax',
        ]);
    }

    private function clearCookies(): void
    {
        foreach ([self::COOKIE, self::CSRF_COOKIE] as $name) {
            setcookie($name, '', [
                'expires'  => Util::now() - 3600,
                'path'     => '/',
                'secure'   => self::isHttps(),
                'httponly' => $name === self::COOKIE,
                'samesite' => 'Lax',
            ]);
        }
        $this->user   = null;
        $this->csrf   = null;
        $this->loaded = true;
    }

    private static function isHttps(): bool
    {
        if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
            return true;
        }
        if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') {
            return true;
        }
        return (int) ($_SERVER['SERVER_PORT'] ?? 80) === 443;
    }

    // ── Credentials ─────────────────────────────────────────────────────────

    private static function algo(): string
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    }

    /** @return array<string, int> */
    private static function algoOptions(): array
    {
        return defined('PASSWORD_ARGON2ID')
            ? ['memory_cost' => 65536, 'time_cost' => 4, 'threads' => 1]
            : ['cost' => 12];
    }

    private static function hash(string $password): string
    {
        $hash = password_hash($password, self::algo(), self::algoOptions());
        if (!is_string($hash) || $hash === '') {
            throw new \RuntimeException('Password hashing failed');
        }
        return $hash;
    }

    /** A real hash to verify against when the account does not exist. */
    private static function dummyHash(): string
    {
        static $cached = null;
        return $cached ??= self::hash('not-a-real-password-' . bin2hex(random_bytes(8)));
    }

    public static function validateUsername(string $username): void
    {
        $len = mb_strlen($username, 'UTF-8');
        if ($len < 3 || $len > 24) {
            Http::fail(422, 'username_length', 'Your name needs to be 3–24 characters long.');
        }
        if (!preg_match('/^[\p{L}\p{N}](?:[\p{L}\p{N}._\- ]*[\p{L}\p{N}])?$/u', $username)) {
            Http::fail(422, 'username_charset',
                'Use letters, numbers, spaces, dots, dashes or underscores.');
        }
        if (preg_match('/\s{2,}/u', $username)) {
            Http::fail(422, 'username_charset', 'Please use single spaces only.');
        }
    }

    public static function validatePassword(string $password, string $username): void
    {
        $len = mb_strlen($password, 'UTF-8');
        if ($len < 8) {
            Http::fail(422, 'password_short', 'Your password needs at least 8 characters.');
        }
        if ($len > 200) {
            Http::fail(422, 'password_long', 'That password is unreasonably long.');
        }
        $folded = Util::fold($password);
        if (in_array($folded, self::WEAK, true)) {
            Http::fail(422, 'password_weak', 'That password is one of the most guessed ones. Pick another.');
        }
        if ($folded === Util::fold($username) || str_contains($folded, Util::fold($username))) {
            Http::fail(422, 'password_weak', 'Your password cannot contain your name.');
        }
        if (preg_match('/^(.)\1+$/u', $password)) {
            Http::fail(422, 'password_weak', 'That password is a single repeated character.');
        }
    }
}

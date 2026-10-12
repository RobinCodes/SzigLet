<?php
declare(strict_types=1);

namespace SzigLet;

/**
 * Bot defence without a third-party captcha:
 *
 *  1. Proof of work  — the browser must burn measurable CPU for a signed,
 *     single-use challenge before an unauthenticated write is accepted.
 *  2. Rate limits    — per IP and per username, kept in MySQL so they survive
 *     across the pool of PHP processes shared hosting hands you.
 *  3. Form forensics — a honeypot field and a minimum fill time catch the
 *     naive scripted posts that never load the page at all.
 */
final class Security
{
    public function __construct(
        private readonly string $secret,
        /** @var array{register:int,login:int,login_hard:int,ttl:int} */
        private readonly array $pow,
    ) {
    }

    // ── Proof of work ───────────────────────────────────────────────────────

    /** @return array{salt:string,bits:int,expires:int,sig:string} */
    public function issueChallenge(string $purpose, ?int $bits = null): array
    {
        $bits ??= $this->difficultyFor($purpose);
        $salt    = bin2hex(random_bytes(16));
        $expires = Util::now() + $this->pow['ttl'];

        return [
            'salt'    => $salt,
            'bits'    => $bits,
            'expires' => $expires,
            'sig'     => $this->sign($salt, $bits, $expires, $purpose),
        ];
    }

    public function difficultyFor(string $purpose): int
    {
        if ($purpose === 'register') {
            return $this->pow['register'];
        }
        // Logins start cheap and get expensive for an address that keeps failing.
        $recent = $this->peek('loginfail:ip:' . Util::ipHash($this->secret));
        return $recent >= 5 ? $this->pow['login_hard'] : $this->pow['login'];
    }

    /**
     * Verifies a solved challenge and burns the salt so it cannot be replayed.
     *
     * @param array<string, mixed> $solution
     */
    public function verifyChallenge(string $purpose, array $solution): void
    {
        $salt    = is_string($solution['salt'] ?? null) ? $solution['salt'] : '';
        $bits    = (int) ($solution['bits'] ?? 0);
        $expires = (int) ($solution['expires'] ?? 0);
        $sig     = is_string($solution['sig'] ?? null) ? $solution['sig'] : '';
        $nonce   = is_string($solution['nonce'] ?? null) ? $solution['nonce'] : '';

        if ($salt === '' || $sig === '' || $nonce === '' || strlen($salt) !== 32) {
            Http::fail(400, 'pow_missing', 'Verification is missing. Please reload the page.');
        }
        if (!preg_match('/^[0-9a-f]{32}$/', $salt) || !preg_match('/^[0-9]{1,20}$/', $nonce)) {
            Http::fail(400, 'pow_invalid', 'Verification failed. Please reload the page.');
        }
        if (!Util::hashEquals($this->sign($salt, $bits, $expires, $purpose), $sig)) {
            Http::fail(400, 'pow_invalid', 'Verification failed. Please reload the page.');
        }
        if ($expires < Util::now()) {
            Http::fail(400, 'pow_expired', 'Verification timed out. Please try again.');
        }
        if ($bits < 8 || $bits > 28) {
            Http::fail(400, 'pow_invalid', 'Verification failed. Please reload the page.');
        }
        if (!self::meetsDifficulty($salt, $nonce, $bits)) {
            Http::fail(400, 'pow_invalid', 'Verification failed. Please try again.');
        }

        // Single use. The primary key makes the race safe across processes.
        try {
            Db::run(
                'INSERT INTO sl_pow_used (salt, used_at) VALUES (:s, :t)',
                ['s' => $salt, 't' => Util::now()],
            );
        } catch (\PDOException) {
            Http::fail(400, 'pow_replay', 'That verification was already used. Please try again.');
        }

        if (random_int(1, 50) === 1) {
            Db::run('DELETE FROM sl_pow_used WHERE used_at < :t', ['t' => Util::now() - 3600]);
        }
    }

    public static function meetsDifficulty(string $salt, string $nonce, int $bits): bool
    {
        $digest = hash('sha256', $salt . ':' . $nonce, true);
        $full   = intdiv($bits, 8);
        for ($i = 0; $i < $full; $i++) {
            if ($digest[$i] !== "\0") {
                return false;
            }
        }
        $rest = $bits % 8;
        if ($rest === 0) {
            return true;
        }
        $mask = 0xFF << (8 - $rest) & 0xFF;
        return (ord($digest[$full]) & $mask) === 0;
    }

    private function sign(string $salt, int $bits, int $expires, string $purpose): string
    {
        return hash_hmac('sha256', "$salt|$bits|$expires|$purpose", $this->secret);
    }

    // ── Rate limiting ───────────────────────────────────────────────────────

    /**
     * Counts a hit against a bucket and fails the request once the allowance
     * for the current window is gone.
     */
    public function limit(string $bucket, int $max, int $windowSeconds, string $message): void
    {
        $now = Util::now();
        Db::run(
            'INSERT INTO sl_limits (bucket, hits, reset_at) VALUES (:b, 1, :reset)
             ON DUPLICATE KEY UPDATE
                hits     = IF(reset_at <= :now2, 1, hits + 1),
                reset_at = IF(reset_at <= :now3, :reset2, reset_at)',
            [
                'b'      => $bucket,
                'reset'  => $now + $windowSeconds,
                'reset2' => $now + $windowSeconds,
                'now2'   => $now,
                'now3'   => $now,
            ],
        );

        $row = Db::one('SELECT hits, reset_at FROM sl_limits WHERE bucket = :b', ['b' => $bucket]);
        if ($row !== null && (int) $row['hits'] > $max) {
            $retry = max(1, (int) $row['reset_at'] - $now);
            header('Retry-After: ' . $retry);
            Http::fail(429, 'rate_limited', $message, ['retryAfter' => $retry]);
        }

        if (random_int(1, 100) === 1) {
            Db::run('DELETE FROM sl_limits WHERE reset_at < :t', ['t' => $now - 86400]);
        }
    }

    /** Reads a bucket's current count without consuming any allowance. */
    public function peek(string $bucket): int
    {
        $row = Db::one(
            'SELECT hits FROM sl_limits WHERE bucket = :b AND reset_at > :now',
            ['b' => $bucket, 'now' => Util::now()],
        );
        return $row === null ? 0 : (int) $row['hits'];
    }

    public function note(string $bucket, int $windowSeconds): void
    {
        $now = Util::now();
        Db::run(
            'INSERT INTO sl_limits (bucket, hits, reset_at) VALUES (:b, 1, :reset)
             ON DUPLICATE KEY UPDATE
                hits     = IF(reset_at <= :now2, 1, hits + 1),
                reset_at = IF(reset_at <= :now3, :reset2, reset_at)',
            [
                'b'      => $bucket,
                'reset'  => $now + $windowSeconds,
                'reset2' => $now + $windowSeconds,
                'now2'   => $now,
                'now3'   => $now,
            ],
        );
    }

    public function clear(string $bucket): void
    {
        Db::run('DELETE FROM sl_limits WHERE bucket = :b', ['b' => $bucket]);
    }

    // ── Form forensics ──────────────────────────────────────────────────────

    /** @param array<string, mixed> $body */
    public function checkForm(array $body, int $minimumFillMs = 1200): void
    {
        // A hidden field a human never sees and therefore never fills in.
        $trap = $body['website'] ?? '';
        if (is_string($trap) && trim($trap) !== '') {
            Http::fail(400, 'bot', 'Something went wrong. Please reload the page and try again.');
        }
        $elapsed = (int) ($body['elapsedMs'] ?? 0);
        if ($elapsed > 0 && $elapsed < $minimumFillMs) {
            Http::fail(400, 'too_fast', 'That was a little too quick — give it another go.');
        }
    }

    public function log(?int $userId, string $action, string $detail = ''): void
    {
        Db::run(
            'INSERT INTO sl_audit (user_id, action, detail, ip, created_at)
             VALUES (:u, :a, :d, :ip, :t)',
            [
                'u'  => $userId,
                'a'  => $action,
                'd'  => mb_substr($detail, 0, 500, 'UTF-8'),
                'ip' => Util::ipHash($this->secret),
                't'  => Util::now(),
            ],
        );
    }
}

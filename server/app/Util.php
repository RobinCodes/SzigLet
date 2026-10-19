<?php
declare(strict_types=1);

namespace SzigLet;

final class Util
{
    /** Hungarian/Italian diacritics folded to ASCII, for comparisons only. */
    private const FOLD = [
        'á'=>'a','à'=>'a','â'=>'a','ä'=>'a','ã'=>'a','å'=>'a','ā'=>'a',
        'é'=>'e','è'=>'e','ê'=>'e','ë'=>'e','ē'=>'e',
        'í'=>'i','ì'=>'i','î'=>'i','ï'=>'i','ī'=>'i',
        'ó'=>'o','ò'=>'o','ô'=>'o','ö'=>'o','ő'=>'o','õ'=>'o','ō'=>'o','ø'=>'o',
        'ú'=>'u','ù'=>'u','û'=>'u','ü'=>'u','ű'=>'u','ū'=>'u',
        'ý'=>'y','ÿ'=>'y','ñ'=>'n','ç'=>'c','ß'=>'ss','œ'=>'oe','æ'=>'ae',
    ];

    public static function fold(string $s): string
    {
        $s = mb_strtolower(trim($s), 'UTF-8');
        return strtr($s, self::FOLD);
    }

    /**
     * Canonical form of a username: case-folded and diacritic-folded, so that
     * "Robin", "robin" and "róbin" cannot coexist as look-alike accounts.
     */
    public static function usernameKey(string $s): string
    {
        return self::fold($s);
    }

    public static function slugify(string $s): string
    {
        $s = self::fold($s);
        $s = preg_replace('/[^a-z0-9]+/u', '-', $s) ?? '';
        $s = trim($s, '-');
        if ($s === '') {
            $s = 'set';
        }
        return mb_substr($s, 0, 60, 'UTF-8');
    }

    /**
     * A slug not yet taken in `$table`. The table name is always a literal
     * from the caller, never input.
     */
    public static function uniqueSlug(string $table, string $base): string
    {
        $slug = $base;
        $n    = 2;
        while ((int) Db::value("SELECT COUNT(*) FROM $table WHERE slug = :s", ['s' => $slug]) > 0) {
            $slug = $base . '-' . $n;
            $n++;
            if ($n > 500) {
                $slug = $base . '-' . bin2hex(random_bytes(3));
                break;
            }
        }
        return $slug;
    }

    public static function now(): int
    {
        return time();
    }

    public static function clientIp(): string
    {
        // Shared hosting sits behind the host's own proxy often enough that we
        // check the usual forwarding headers, but only trust the left-most hop
        // for rate-limiting buckets (never for authorisation).
        foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP'] as $h) {
            if (!empty($_SERVER[$h])) {
                $first = trim(explode(',', (string) $_SERVER[$h])[0]);
                if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
                    return $first;
                }
            }
        }
        $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        return is_string($ip) ? $ip : '0.0.0.0';
    }

    /** IPs are only ever stored hashed, so the database holds no raw addresses. */
    public static function ipHash(string $secret): string
    {
        return hash_hmac('sha256', self::clientIp(), $secret);
    }

    public static function randomToken(int $bytes = 32): string
    {
        return self::b64url(random_bytes($bytes));
    }

    public static function b64url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    public static function hashEquals(string $a, string $b): bool
    {
        return hash_equals($a, $b);
    }

    /** Levenshtein that tolerates multi-byte input (PHP's is byte-based). */
    public static function levenshtein(string $a, string $b): int
    {
        $x = self::toCodepoints($a);
        $y = self::toCodepoints($b);
        $n = count($x);
        $m = count($y);
        if ($n === 0) {
            return $m;
        }
        if ($m === 0) {
            return $n;
        }
        $prev = range(0, $m);
        for ($i = 1; $i <= $n; $i++) {
            $cur = [$i];
            for ($j = 1; $j <= $m; $j++) {
                $cost = $x[$i - 1] === $y[$j - 1] ? 0 : 1;
                $cur[$j] = min($prev[$j] + 1, $cur[$j - 1] + 1, $prev[$j - 1] + $cost);
            }
            $prev = $cur;
        }
        return $prev[$m];
    }

    /** @return list<string> */
    private static function toCodepoints(string $s): array
    {
        $out = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
        return $out === false ? [] : $out;
    }
}

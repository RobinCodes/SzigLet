<?php
declare(strict_types=1);

namespace SzigLet;

/** Per-account study state, kept per direction so IT→HU and HU→IT differ. */
final class Progress
{
    /**
     * @param array<string, mixed> $body
     * @return array{updated:int}
     */
    public function save(int $userId, array $body): array
    {
        $dir     = self::direction($body['dir'] ?? '');
        $updates = $body['updates'] ?? null;
        if (!is_array($updates)) {
            Http::fail(422, 'missing_field', 'Nothing to save.');
        }
        if (count($updates) > 2000) {
            Http::fail(422, 'too_large', 'Too many cards in one go.');
        }

        $count = Db::transaction(static function () use ($userId, $dir, $updates): int {
            $n   = 0;
            $now = Util::now();
            foreach ($updates as $raw) {
                if (!is_array($raw)) {
                    continue;
                }
                $cardId = (int) ($raw['cardId'] ?? 0);
                $state  = is_string($raw['state'] ?? null) ? $raw['state'] : '';
                if ($cardId <= 0 || !in_array($state, ['new', 'rehearse', 'known'], true)) {
                    continue;
                }
                $right = isset($raw['right']) ? (int) (bool) $raw['right'] : 0;
                $wrong = isset($raw['wrong']) ? (int) (bool) $raw['wrong'] : 0;

                Db::run(
                    'INSERT INTO sl_progress (user_id, card_id, dir, state, seen, right_count, wrong_count, updated_at)
                     VALUES (:u, :c, :d, :s, 1, :r, :w, :t)
                     ON DUPLICATE KEY UPDATE
                        state       = VALUES(state),
                        seen        = seen + 1,
                        right_count = right_count + VALUES(right_count),
                        wrong_count = wrong_count + VALUES(wrong_count),
                        updated_at  = VALUES(updated_at)',
                    [
                        'u' => $userId,
                        'c' => $cardId,
                        'd' => $dir,
                        's' => $state,
                        'r' => $right,
                        'w' => $wrong,
                        't' => $now,
                    ],
                );
                $n++;
            }
            return $n;
        });

        return ['updated' => (int) $count];
    }

    /** @param array<string, mixed> $body */
    public function reset(int $userId, array $body): void
    {
        $setId = (int) ($body['setId'] ?? 0);
        if ($setId <= 0) {
            Http::fail(422, 'missing_field', 'Which set should be reset?');
        }
        $dir = isset($body['dir']) && $body['dir'] !== null && $body['dir'] !== 'both'
            ? self::direction($body['dir'])
            : null;

        if ($dir === null) {
            Db::run(
                'DELETE p FROM sl_progress p JOIN sl_cards c ON c.id = p.card_id
                  WHERE p.user_id = :u AND c.set_id = :s',
                ['u' => $userId, 's' => $setId],
            );
        } else {
            Db::run(
                'DELETE p FROM sl_progress p JOIN sl_cards c ON c.id = p.card_id
                  WHERE p.user_id = :u AND c.set_id = :s AND p.dir = :d',
                ['u' => $userId, 's' => $setId, 'd' => $dir],
            );
        }
    }

    /**
     * @param array<string, mixed> $body
     * @return array{id:int}
     */
    public function recordResult(int $userId, array $body): array
    {
        $setId = (int) ($body['setId'] ?? 0);
        $mode  = is_string($body['mode'] ?? null) ? $body['mode'] : '';
        if ($setId <= 0 || !in_array($mode, ['flashcards', 'choice', 'write'], true)) {
            Http::fail(422, 'missing_field', 'That result is incomplete.');
        }

        $total   = max(0, min(5000, (int) ($body['total'] ?? 0)));
        $correct = max(0, min($total, (int) ($body['correct'] ?? 0)));

        Db::run(
            'INSERT INTO sl_results (user_id, set_id, dir, mode, total, correct, duration_ms, created_at)
             VALUES (:u, :s, :d, :m, :total, :correct, :ms, :t)',
            [
                'u'       => $userId,
                's'       => $setId,
                'd'       => self::direction($body['dir'] ?? ''),
                'm'       => $mode,
                'total'   => $total,
                'correct' => $correct,
                'ms'      => max(0, min(86400000, (int) ($body['durationMs'] ?? 0))),
                't'       => Util::now(),
            ],
        );

        return ['id' => Db::lastId()];
    }

    /** @return array<string, mixed> */
    public function stats(int $userId): array
    {
        // Accuracy only means something for tests: a flashcard round records
        // how many cards were swiped to known, which is not a score.
        $tests = Db::one(
            'SELECT COUNT(*) AS runs,
                    COALESCE(SUM(total), 0) AS answered,
                    COALESCE(SUM(correct), 0) AS correct
               FROM sl_results WHERE user_id = :u AND mode <> \'flashcards\'',
            ['u' => $userId],
        ) ?? [];

        // Time studied, on the other hand, is every minute spent in the app.
        // Counting only tests was why it kept reading as zero: the deck has to
        // be cleared with flashcards before a test even unlocks.
        $all = Db::one(
            'SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_ms), 0) AS ms
               FROM sl_results WHERE user_id = :u',
            ['u' => $userId],
        ) ?? [];

        $known = Db::one(
            'SELECT
                 SUM(state = \'known\') AS known,
                 SUM(state = \'rehearse\') AS rehearse
               FROM sl_progress WHERE user_id = :u',
            ['u' => $userId],
        ) ?? [];

        $recent = Db::all(
            'SELECT r.created_at, r.mode, r.dir, r.total, r.correct, s.title, s.slug
               FROM sl_results r JOIN sl_sets s ON s.id = r.set_id
              WHERE r.user_id = :u AND r.mode <> \'flashcards\'
              ORDER BY r.created_at DESC LIMIT 12',
            ['u' => $userId],
        );

        $days = Db::all(
            'SELECT FLOOR(created_at / 86400) AS day, COUNT(*) AS runs
               FROM sl_results WHERE user_id = :u AND created_at > :since
              GROUP BY day ORDER BY day ASC',
            ['u' => $userId, 'since' => Util::now() - 30 * 86400],
        );

        return [
            'runs'         => (int) ($tests['runs'] ?? 0),
            'sessions'     => (int) ($all['sessions'] ?? 0),
            'answered'     => (int) ($tests['answered'] ?? 0),
            'correct'      => (int) ($tests['correct'] ?? 0),
            'studyMs'      => (int) ($all['ms'] ?? 0),
            'known'        => (int) ($known['known'] ?? 0),
            'rehearse'     => (int) ($known['rehearse'] ?? 0),
            'streak'       => self::dayStreak($userId),
            'weekStreak'   => self::weekStreak($userId),
            'activeDays30' => count($days),
            'recent'       => array_map(static fn (array $r): array => [
                'at'      => (int) $r['created_at'],
                'mode'    => (string) $r['mode'],
                'dir'     => (string) $r['dir'],
                'total'   => (int) $r['total'],
                'correct' => (int) $r['correct'],
                'title'   => (string) $r['title'],
                'slug'    => (string) $r['slug'],
            ], $recent),
            'activity'     => array_map(static fn (array $r): array => [
                'day'  => (int) $r['day'],
                'runs' => (int) $r['runs'],
            ], $days),
        ];
    }

    /** Consecutive days with at least one study run, counting back from today. */
    private static function dayStreak(int $userId): int
    {
        return self::runLength($userId, 86400, 0, 400);
    }

    /**
     * Consecutive weeks with at least one study run.
     *
     * This is the figure the app leads with. Vocabulary does not need a daily
     * appointment, and a day streak punishes one busy Tuesday by throwing away
     * months of work -- which made it something to protect rather than a
     * reflection of how the app is actually used.
     */
    private static function weekStreak(int $userId): int
    {
        // The epoch began on a Thursday; shifting by three days puts the week
        // boundary on a Monday.
        return self::runLength($userId, 604800, 259200, 200);
    }

    /**
     * How many consecutive buckets of `$size` seconds, ending with the current
     * one or the one before it, contain a run. Allowing the previous bucket
     * means a streak does not appear to break just because today is young.
     */
    private static function runLength(int $userId, int $size, int $offset, int $lookback): int
    {
        // $size and $offset are constants from the two callers above, never
        // input, and PDO would bind them as strings into the arithmetic.
        $bucket = sprintf('FLOOR((created_at - %d) / %d)', $offset, $size);

        $rows = Db::all(
            "SELECT DISTINCT $bucket AS bucket
               FROM sl_results WHERE user_id = :u AND created_at > :since
              ORDER BY bucket DESC",
            ['u' => $userId, 'since' => max(0, Util::now() - $lookback * $size)],
        );
        if ($rows === []) {
            return 0;
        }

        $buckets = array_map(static fn (array $r): int => (int) $r['bucket'], $rows);
        $current = intdiv(Util::now() - $offset, $size);

        $cursor = match (true) {
            $buckets[0] === $current     => $current,
            $buckets[0] === $current - 1 => $current - 1,
            default                      => null,
        };
        if ($cursor === null) {
            return 0;
        }

        $length = 0;
        foreach ($buckets as $bucket) {
            if ($bucket === $cursor) {
                $length++;
                $cursor--;
            } elseif ($bucket < $cursor) {
                break;
            }
        }
        return $length;
    }

    private static function direction(mixed $value): string
    {
        return $value === 'ba' ? 'ba' : 'ab';
    }
}

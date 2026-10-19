<?php
declare(strict_types=1);

namespace SzigLet;

/**
 * What a learner has done with single cards and questions inside lessons:
 * how often seen, how often solved, and whether the last attempt was right.
 * Node completion and prerequisites are worked out from exactly this.
 */
final class Items
{
    private const PATTERN = '/^[cq]:[1-9][0-9]{0,9}$/';

    /**
     * @param list<string> $items
     * @return array<string, array{seen:int, solved:int, wrong:int, lastOk:bool}>
     */
    public static function progress(int $userId, array $items): array
    {
        $items = array_values(array_unique(array_filter(
            $items,
            static fn (string $item): bool => preg_match(self::PATTERN, $item) === 1,
        )));
        if ($items === []) {
            return [];
        }
        $out = [];
        // Chunked: a big course can reference a few thousand items.
        foreach (array_chunk($items, 400) as $chunk) {
            $marks  = implode(',', array_fill(0, count($chunk), '?'));
            $rows   = Db::all(
                "SELECT item, seen, solved, wrong, last_ok FROM sl_item_progress
                  WHERE user_id = ? AND item IN ($marks)",
                array_merge([$userId], $chunk),
            );
            foreach ($rows as $r) {
                $out[(string) $r['item']] = [
                    'seen'   => (int) $r['seen'],
                    'solved' => (int) $r['solved'],
                    'wrong'  => (int) $r['wrong'],
                    'lastOk' => (bool) $r['last_ok'],
                ];
            }
        }
        return $out;
    }

    /**
     * Records a batch of attempts. Each is `{item, ok}`, where `ok` is null
     * for a word that was only shown, not asked.
     *
     * @param array<string, mixed> $body
     * @return array{updated:int}
     */
    public static function save(int $userId, array $body): array
    {
        $updates = $body['updates'] ?? null;
        if (!is_array($updates)) {
            Http::fail(422, 'missing_field', 'Nothing to save.');
        }
        if (count($updates) > 2000) {
            Http::fail(422, 'too_large', 'Too many items in one go.');
        }

        $count = Db::transaction(static function () use ($userId, $updates): int {
            $n   = 0;
            $now = Util::now();
            foreach ($updates as $raw) {
                if (!is_array($raw) || !is_string($raw['item'] ?? null)
                    || preg_match(self::PATTERN, $raw['item']) !== 1) {
                    continue;
                }
                $ok     = $raw['ok'] ?? null;
                $asked  = $ok !== null;
                $solved = $asked && (bool) $ok ? 1 : 0;
                $wrong  = $asked && !(bool) $ok ? 1 : 0;

                // A word that was only shown keeps whatever its last answer was.
                Db::run(
                    'INSERT INTO sl_item_progress (user_id, item, seen, solved, wrong, last_ok, updated_at)
                     VALUES (:u, :i, 1, :s, :w, :l, :t)
                     ON DUPLICATE KEY UPDATE
                        seen       = seen + 1,
                        solved     = solved + VALUES(solved),
                        wrong      = wrong + VALUES(wrong),
                        last_ok    = IF(:asked = 1, VALUES(last_ok), last_ok),
                        updated_at = VALUES(updated_at)',
                    [
                        'u'     => $userId,
                        'i'     => $raw['item'],
                        's'     => $solved,
                        'w'     => $wrong,
                        'l'     => $solved,
                        't'     => $now,
                        'asked' => $asked ? 1 : 0,
                    ],
                );
                $n++;
            }
            return $n;
        });

        return ['updated' => (int) $count];
    }

    /**
     * Forgets a learner's lesson record for some items: "start this node
     * over".
     *
     * @param list<string> $items
     */
    public static function reset(int $userId, array $items): void
    {
        $items = array_values(array_filter(
            $items,
            static fn (mixed $item): bool => is_string($item) && preg_match(self::PATTERN, $item) === 1,
        ));
        foreach (array_chunk($items, 400) as $chunk) {
            $marks = implode(',', array_fill(0, count($chunk), '?'));
            Db::run(
                "DELETE FROM sl_item_progress WHERE user_id = ? AND item IN ($marks)",
                array_merge([$userId], $chunk),
            );
        }
    }
}

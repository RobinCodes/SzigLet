<?php
declare(strict_types=1);

namespace SzigLet;

/**
 * Reports on a card or question that looks wrong.
 *
 * A report goes to the authors of whatever holds the item. The person who
 * filed it can ask not to see the item again until somebody has looked —
 * there is no point drilling a word you believe is mistranslated.
 */
final class Flags
{
    private const PATTERN = '/^[cq]:[1-9][0-9]{0,9}$/';

    /**
     * Items this reader has hidden pending review.
     *
     * @return list<string>
     */
    public static function hiddenFor(int $userId): array
    {
        return array_map(static fn (array $r): string => (string) $r['item'], Db::all(
            "SELECT DISTINCT item FROM sl_flags WHERE user_id = :u AND hide = 1 AND status = 'open'",
            ['u' => $userId],
        ));
    }

    /**
     * @param array<string, mixed> $body
     * @return array{id:int}
     */
    public static function create(int $userId, array $body): array
    {
        $item = is_string($body['item'] ?? null) ? $body['item'] : '';
        if (preg_match(self::PATTERN, $item) !== 1 || self::describe($item) === null) {
            Http::fail(422, 'bad_item', 'There is nothing to report there.');
        }
        $reason = Sets::text($body['reason'] ?? '', 500, 'reason');

        // One open report per person and item: a second one updates the first.
        $open = Db::value(
            "SELECT id FROM sl_flags WHERE user_id = :u AND item = :i AND status = 'open'",
            ['u' => $userId, 'i' => $item],
        );
        if ($open !== null) {
            Db::run(
                'UPDATE sl_flags SET reason = :r, hide = :h, created_at = :t WHERE id = :id',
                ['r' => $reason === '' ? null : $reason, 'h' => !empty($body['hide']) ? 1 : 0,
                 't' => Util::now(), 'id' => $open],
            );
            return ['id' => (int) $open];
        }

        Db::run(
            'INSERT INTO sl_flags (user_id, item, reason, hide, created_at) VALUES (:u, :i, :r, :h, :t)',
            [
                'u' => $userId,
                'i' => $item,
                'r' => $reason === '' ? null : $reason,
                'h' => !empty($body['hide']) ? 1 : 0,
                't' => Util::now(),
            ],
        );
        return ['id' => Db::lastId()];
    }

    /**
     * Open reports for what this editor wrote; for an owner, all of them.
     * Reporters stay anonymous.
     *
     * @return list<array<string, mixed>>
     */
    public static function inbox(int $userId, bool $isOwner): array
    {
        $rows = Db::all(
            "SELECT item, COUNT(*) AS reports, MAX(created_at) AS latest,
                    GROUP_CONCAT(reason ORDER BY created_at DESC SEPARATOR '\n') AS reasons
               FROM sl_flags WHERE status = 'open'
              GROUP BY item ORDER BY latest DESC LIMIT 300",
        );

        $out = [];
        foreach ($rows as $r) {
            $info = self::describe((string) $r['item']);
            if ($info === null) {
                continue;
            }
            if (!$isOwner && !Authors::isAuthor($info['ownerKind'], $info['ownerId'], $userId)) {
                continue;
            }
            unset($info['ownerKind'], $info['ownerId']);
            $out[] = $info + [
                'item'    => (string) $r['item'],
                'reports' => (int) $r['reports'],
                'latest'  => (int) $r['latest'],
                'reasons' => array_values(array_filter(explode("\n", (string) ($r['reasons'] ?? '')))),
            ];
        }
        return $out;
    }

    public static function count(int $userId, bool $isOwner): int
    {
        return count(self::inbox($userId, $isOwner));
    }

    /** Closes every open report on one item. Hidden copies come back. */
    public static function settle(string $item, string $status, int $userId, bool $isOwner): void
    {
        if (preg_match(self::PATTERN, $item) !== 1 || !in_array($status, ['resolved', 'dismissed'], true)) {
            Http::fail(422, 'bad_request', 'That is not something a report can be set to.');
        }
        $info = self::describe($item);
        if ($info !== null && !$isOwner && !Authors::isAuthor($info['ownerKind'], $info['ownerId'], $userId)) {
            Http::fail(403, 'forbidden', 'Only the authors can close these reports.');
        }
        Db::run(
            "UPDATE sl_flags SET status = :s, resolved_by = :u, resolved_at = :t
              WHERE item = :i AND status = 'open'",
            ['s' => $status, 'u' => $userId, 't' => Util::now(), 'i' => $item],
        );
    }

    /**
     * What an item is and where it lives, or null when it no longer exists.
     *
     * @return array<string, mixed>|null
     */
    private static function describe(string $item): ?array
    {
        [$type, $id] = explode(':', $item);
        $id = (int) $id;

        if ($type === 'c') {
            $row = Db::one(
                'SELECT c.side_a, c.side_b, s.id AS set_id, s.slug, s.title
                   FROM sl_cards c JOIN sl_sets s ON s.id = c.set_id WHERE c.id = :id',
                ['id' => $id],
            );
            if ($row === null) {
                return null;
            }
            return [
                'kind'      => 'card',
                'text'      => trim($row['side_a'] . ' — ' . $row['side_b'], ' —'),
                'where'     => (string) $row['title'],
                'link'      => '/s/' . $row['slug'] . '/edit',
                'ownerKind' => 'set',
                'ownerId'   => (int) $row['set_id'],
            ];
        }

        $row = Db::one(
            'SELECT q.body, q.set_id, q.node_id, s.slug AS set_slug, s.title AS set_title,
                    n.title AS node_title, n.course_id
               FROM sl_questions q
               LEFT JOIN sl_sets s ON s.id = q.set_id
               LEFT JOIN sl_nodes n ON n.id = q.node_id
              WHERE q.id = :id',
            ['id' => $id],
        );
        if ($row === null) {
            return null;
        }
        $inSet = $row['set_id'] !== null;
        return [
            'kind'      => 'question',
            'text'      => (string) $row['body'],
            'where'     => (string) ($inSet ? $row['set_title'] : $row['node_title']),
            'link'      => $inSet ? '/s/' . $row['set_slug'] . '/edit' : '/n/' . $row['node_id'] . '/edit',
            'ownerKind' => $inSet ? 'set' : 'course',
            'ownerId'   => (int) ($inSet ? $row['set_id'] : $row['course_id']),
        ];
    }
}

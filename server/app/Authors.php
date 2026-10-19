<?php
declare(strict_types=1);

namespace SzigLet;

/**
 * Who wrote a set or a course. Any editor may still change anything — the
 * library is shared — but the authors are who it is credited to, who hears
 * about flagged cards, and who gets to see how it is used.
 */
final class Authors
{
    /**
     * @param 'set'|'course' $kind
     * @param list<int> $ids
     * @return array<int, list<string>>
     */
    public static function namesFor(string $kind, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $rows = Db::all(
            'SELECT a.entity_id, u.username FROM sl_authors a
               JOIN sl_users u ON u.id = a.user_id
              WHERE a.kind = :k
              ORDER BY a.position ASC, u.username ASC',
            ['k' => $kind],
        );
        $out    = [];
        $wanted = array_flip($ids);
        foreach ($rows as $r) {
            $id = (int) $r['entity_id'];
            if (isset($wanted[$id])) {
                $out[$id][] = (string) $r['username'];
            }
        }
        return $out;
    }

    /**
     * @param 'set'|'course' $kind
     * @return list<array{id:int, username:string}>
     */
    public static function listFor(string $kind, int $id): array
    {
        return array_map(static fn (array $r): array => [
            'id'       => (int) $r['id'],
            'username' => (string) $r['username'],
        ], Db::all(
            'SELECT u.id, u.username FROM sl_authors a
               JOIN sl_users u ON u.id = a.user_id
              WHERE a.kind = :k AND a.entity_id = :e
              ORDER BY a.position ASC, u.username ASC',
            ['k' => $kind, 'e' => $id],
        ));
    }

    /**
     * Replaces the author list. Only editors and owners can be authors; an
     * empty list falls back to whoever is saving, so nothing is orphaned.
     *
     * @param 'set'|'course' $kind
     * @param array<int, mixed> $userIds
     */
    public static function save(string $kind, int $id, array $userIds, int $actorId): void
    {
        $ids = [];
        foreach ($userIds as $raw) {
            $uid = (int) $raw;
            if ($uid > 0 && !in_array($uid, $ids, true)) {
                $ids[] = $uid;
            }
        }
        if (count($ids) > 12) {
            Http::fail(422, 'too_many_authors', 'At most 12 authors.');
        }
        $valid = [];
        foreach ($ids as $uid) {
            $role = Db::value('SELECT role FROM sl_users WHERE id = :id', ['id' => $uid]);
            if (in_array($role, ['editor', 'owner'], true)) {
                $valid[] = $uid;
            }
        }
        if ($valid === []) {
            $valid = [$actorId];
        }

        Db::transaction(static function () use ($kind, $id, $valid): void {
            Db::run('DELETE FROM sl_authors WHERE kind = :k AND entity_id = :e', ['k' => $kind, 'e' => $id]);
            foreach ($valid as $position => $uid) {
                Db::run(
                    'INSERT INTO sl_authors (kind, entity_id, user_id, position) VALUES (:k, :e, :u, :p)',
                    ['k' => $kind, 'e' => $id, 'u' => $uid, 'p' => $position],
                );
            }
        });
    }

    /** @param 'set'|'course' $kind */
    public static function isAuthor(string $kind, int $id, int $userId): bool
    {
        return (int) (Db::value(
            'SELECT COUNT(*) FROM sl_authors WHERE kind = :k AND entity_id = :e AND user_id = :u',
            ['k' => $kind, 'e' => $id, 'u' => $userId],
        ) ?? 0) > 0;
    }

    /** Authors see their own numbers; owners see everyone's. */
    public static function canSeeStats(string $kind, int $id, int $userId): bool
    {
        if (Db::value('SELECT role FROM sl_users WHERE id = :id', ['id' => $userId]) === 'owner') {
            return true;
        }
        return self::isAuthor($kind, $id, $userId);
    }

    /**
     * Editors and owners: the people an author list can be picked from.
     *
     * @return list<array{id:int, username:string}>
     */
    public static function candidates(): array
    {
        return array_map(static fn (array $r): array => [
            'id'       => (int) $r['id'],
            'username' => (string) $r['username'],
        ], Db::all(
            "SELECT id, username FROM sl_users WHERE role IN ('editor','owner') ORDER BY username ASC",
        ));
    }
}

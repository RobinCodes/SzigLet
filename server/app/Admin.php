<?php
declare(strict_types=1);

namespace SzigLet;

final class Admin
{
    public function __construct(private readonly Security $security)
    {
    }

    /** @return list<array<string, mixed>> */
    public function users(): array
    {
        $rows = Db::all(
            'SELECT u.id, u.username, u.role, u.created_at, u.last_seen_at,
                    (SELECT COUNT(*) FROM sl_progress p
                      WHERE p.user_id = u.id AND p.state = \'known\') AS known,
                    (SELECT COUNT(*) FROM sl_results r WHERE r.user_id = u.id) AS runs,
                    (SELECT COUNT(*) FROM sl_sessions s WHERE s.user_id = u.id
                        AND s.expires_at > UNIX_TIMESTAMP()) AS devices
               FROM sl_users u
              ORDER BY FIELD(u.role, \'owner\', \'editor\', \'viewer\'), u.username ASC',
        );

        return array_map(static fn (array $r): array => [
            'id'         => (int) $r['id'],
            'username'   => (string) $r['username'],
            'role'       => (string) $r['role'],
            'createdAt'  => (int) $r['created_at'],
            'lastSeenAt' => $r['last_seen_at'] === null ? null : (int) $r['last_seen_at'],
            'known'      => (int) $r['known'],
            'runs'       => (int) $r['runs'],
            'devices'    => (int) $r['devices'],
        ], $rows);
    }

    public function setRole(int $actorId, int $targetId, string $role): void
    {
        if (!in_array($role, ['viewer', 'editor', 'owner'], true)) {
            Http::fail(422, 'bad_role', 'That is not a role.');
        }
        if ($targetId === $actorId) {
            Http::fail(422, 'self', 'You cannot change your own role.');
        }
        $target = Db::one('SELECT username, role FROM sl_users WHERE id = :id', ['id' => $targetId]);
        if ($target === null) {
            Http::fail(404, 'not_found', 'No such account.');
        }

        Db::run('UPDATE sl_users SET role = :r WHERE id = :id', ['r' => $role, 'id' => $targetId]);
        $this->security->log($actorId, 'role_change',
            sprintf('%s: %s -> %s', $target['username'], $target['role'], $role));
    }

    public function deleteUser(int $actorId, int $targetId): void
    {
        if ($targetId === $actorId) {
            Http::fail(422, 'self', 'You cannot delete your own account here.');
        }
        $target = Db::one('SELECT username, role FROM sl_users WHERE id = :id', ['id' => $targetId]);
        if ($target === null) {
            Http::fail(404, 'not_found', 'No such account.');
        }
        if ($target['role'] === 'owner') {
            Http::fail(422, 'owner', 'Demote the owner before deleting that account.');
        }
        Db::run('DELETE FROM sl_users WHERE id = :id', ['id' => $targetId]);
        $this->security->log($actorId, 'user_delete', (string) $target['username']);
    }

    /** @return array<string, mixed> */
    public function overview(): array
    {
        return [
            'users'    => (int) (Db::value('SELECT COUNT(*) FROM sl_users') ?? 0),
            'editors'  => (int) (Db::value("SELECT COUNT(*) FROM sl_users WHERE role IN ('editor','owner')") ?? 0),
            'sets'     => (int) (Db::value('SELECT COUNT(*) FROM sl_sets') ?? 0),
            'cards'    => (int) (Db::value('SELECT COUNT(*) FROM sl_cards') ?? 0),
            'runs'     => (int) (Db::value('SELECT COUNT(*) FROM sl_results') ?? 0),
            'active7d' => (int) (Db::value(
                'SELECT COUNT(DISTINCT user_id) FROM sl_results WHERE created_at > :t',
                ['t' => Util::now() - 7 * 86400],
            ) ?? 0),
            'audit'    => array_map(static fn (array $r): array => [
                'at'     => (int) $r['created_at'],
                'action' => (string) $r['action'],
                'detail' => (string) ($r['detail'] ?? ''),
                'by'     => $r['username'] === null ? null : (string) $r['username'],
            ], Db::all(
                'SELECT a.created_at, a.action, a.detail, u.username
                   FROM sl_audit a LEFT JOIN sl_users u ON u.id = a.user_id
                  ORDER BY a.id DESC LIMIT 40',
            )),
        ];
    }
}

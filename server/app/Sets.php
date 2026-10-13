<?php
declare(strict_types=1);

namespace SzigLet;

/** The shared library: sets, their cards, and who may change them. */
final class Sets
{
    public function __construct(private readonly Security $security)
    {
    }

    /**
     * The library index. Every signed-in account sees the same sets; the
     * numbers attached to each one are the reader's own progress.
     *
     * @return list<array<string, mixed>>
     */
    public function index(int $userId, bool $canSeeDrafts): array
    {
        $rows = Db::all(
            'SELECT s.id, s.slug, s.title, s.description, s.lang_a, s.lang_b,
                    s.is_published, s.sort_order, s.updated_at,
                    u.username AS author,
                    (SELECT COUNT(*) FROM sl_cards c WHERE c.set_id = s.id) AS card_count,
                    (SELECT COUNT(*) FROM sl_progress p
                       JOIN sl_cards c2 ON c2.id = p.card_id
                      WHERE c2.set_id = s.id AND p.user_id = :u1
                        AND p.dir = \'ab\' AND p.state = \'known\') AS known_ab,
                    (SELECT COUNT(*) FROM sl_progress p
                       JOIN sl_cards c3 ON c3.id = p.card_id
                      WHERE c3.set_id = s.id AND p.user_id = :u2
                        AND p.dir = \'ba\' AND p.state = \'known\') AS known_ba,
                    EXISTS(SELECT 1 FROM sl_results r WHERE r.user_id = :u3
                             AND r.set_id = s.id AND r.dir = \'ab\' AND r.mode = \'choice\') AS ab_choice,
                    EXISTS(SELECT 1 FROM sl_results r WHERE r.user_id = :u4
                             AND r.set_id = s.id AND r.dir = \'ab\' AND r.mode = \'write\') AS ab_write,
                    EXISTS(SELECT 1 FROM sl_results r WHERE r.user_id = :u5
                             AND r.set_id = s.id AND r.dir = \'ba\' AND r.mode = \'choice\') AS ba_choice,
                    EXISTS(SELECT 1 FROM sl_results r WHERE r.user_id = :u6
                             AND r.set_id = s.id AND r.dir = \'ba\' AND r.mode = \'write\') AS ba_write
               FROM sl_sets s
               LEFT JOIN sl_users u ON u.id = s.created_by
              WHERE (s.is_published = 1 OR :drafts = 1)
              ORDER BY s.sort_order ASC, s.updated_at DESC',
            [
                'u1'     => $userId,
                'u2'     => $userId,
                'u3'     => $userId,
                'u4'     => $userId,
                'u5'     => $userId,
                'u6'     => $userId,
                'drafts' => $canSeeDrafts ? 1 : 0,
            ],
        );

        return array_map(static fn (array $r): array => [
            'id'          => (int) $r['id'],
            'slug'        => (string) $r['slug'],
            'title'       => (string) $r['title'],
            'description' => $r['description'] === null ? null : (string) $r['description'],
            'langA'       => (string) $r['lang_a'],
            'langB'       => (string) $r['lang_b'],
            'published'   => (bool) $r['is_published'],
            'author'      => $r['author'] === null ? null : (string) $r['author'],
            'cardCount'   => (int) $r['card_count'],
            'updatedAt'   => (int) $r['updated_at'],
            'known'       => ['ab' => (int) $r['known_ab'], 'ba' => (int) $r['known_ba']],
            'tests'       => [
                'ab' => ['choice' => (bool) $r['ab_choice'], 'write' => (bool) $r['ab_write']],
                'ba' => ['choice' => (bool) $r['ba_choice'], 'write' => (bool) $r['ba_write']],
            ],
        ], $rows);
    }

    /** @return array<string, mixed> */
    public function show(string $slug, int $userId, bool $canSeeDrafts): array
    {
        $set = Db::one(
            'SELECT s.*, u.username AS author
               FROM sl_sets s
               LEFT JOIN sl_users u ON u.id = s.created_by
              WHERE s.slug = :slug',
            ['slug' => $slug],
        );
        if ($set === null || (!(bool) $set['is_published'] && !$canSeeDrafts)) {
            Http::fail(404, 'not_found', 'That set does not exist.');
        }

        $tests = Db::one(
            'SELECT
                 EXISTS(SELECT 1 FROM sl_results r WHERE r.user_id = :u1 AND r.set_id = :s1
                          AND r.dir = \'ab\' AND r.mode = \'choice\') AS ab_choice,
                 EXISTS(SELECT 1 FROM sl_results r WHERE r.user_id = :u2 AND r.set_id = :s2
                          AND r.dir = \'ab\' AND r.mode = \'write\')  AS ab_write,
                 EXISTS(SELECT 1 FROM sl_results r WHERE r.user_id = :u3 AND r.set_id = :s3
                          AND r.dir = \'ba\' AND r.mode = \'choice\') AS ba_choice,
                 EXISTS(SELECT 1 FROM sl_results r WHERE r.user_id = :u4 AND r.set_id = :s4
                          AND r.dir = \'ba\' AND r.mode = \'write\')  AS ba_write',
            [
                'u1' => $userId, 's1' => $set['id'],
                'u2' => $userId, 's2' => $set['id'],
                'u3' => $userId, 's3' => $set['id'],
                'u4' => $userId, 's4' => $set['id'],
            ],
        ) ?? [];

        $cards = Db::all(
            'SELECT c.id, c.side_a, c.side_b, c.note, c.extras, c.position,
                    MAX(CASE WHEN p.dir = \'ab\' THEN p.state END) AS state_ab,
                    MAX(CASE WHEN p.dir = \'ba\' THEN p.state END) AS state_ba
               FROM sl_cards c
               LEFT JOIN sl_progress p ON p.card_id = c.id AND p.user_id = :u
              WHERE c.set_id = :s
              GROUP BY c.id, c.side_a, c.side_b, c.note, c.extras, c.position
              ORDER BY c.position ASC, c.id ASC',
            ['u' => $userId, 's' => $set['id']],
        );

        return [
            'id'          => (int) $set['id'],
            'slug'        => (string) $set['slug'],
            'title'       => (string) $set['title'],
            'description' => $set['description'] === null ? null : (string) $set['description'],
            'langA'       => (string) $set['lang_a'],
            'langB'       => (string) $set['lang_b'],
            'published'   => (bool) $set['is_published'],
            'author'      => $set['author'] === null ? null : (string) $set['author'],
            'updatedAt'   => (int) $set['updated_at'],
            'tests'       => [
                'ab' => [
                    'choice' => (bool) ($tests['ab_choice'] ?? false),
                    'write'  => (bool) ($tests['ab_write'] ?? false),
                ],
                'ba' => [
                    'choice' => (bool) ($tests['ba_choice'] ?? false),
                    'write'  => (bool) ($tests['ba_write'] ?? false),
                ],
            ],
            'cards'       => array_map(static fn (array $c): array => [
                'id'    => (int) $c['id'],
                'a'     => (string) $c['side_a'],
                'b'     => (string) $c['side_b'],
                'note'   => $c['note'] === null ? null : (string) $c['note'],
                'extras' => self::decodeExtras($c['extras'] ?? null),
                'state'  => [
                    'ab' => (string) ($c['state_ab'] ?? 'new'),
                    'ba' => (string) ($c['state_ba'] ?? 'new'),
                ],
            ], $cards),
        ];
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    public function create(array $body, int $userId): array
    {
        $title = self::text($body['title'] ?? '', 120, 'title', required: true);
        $langA = self::text($body['langA'] ?? '', 40, 'langA', required: true);
        $langB = self::text($body['langB'] ?? '', 40, 'langB', required: true);
        $desc  = self::text($body['description'] ?? '', 500, 'description');

        $slug = $this->uniqueSlug(Util::slugify($title));
        $now  = Util::now();

        Db::run(
            'INSERT INTO sl_sets (slug, title, description, lang_a, lang_b, is_published,
                                  sort_order, created_by, created_at, updated_at)
             VALUES (:slug, :title, :desc, :a, :b, :pub, :order, :by, :t, :t2)',
            [
                'slug'  => $slug,
                'title' => $title,
                'desc'  => $desc === '' ? null : $desc,
                'a'     => $langA,
                'b'     => $langB,
                'pub'   => !empty($body['published']) ? 1 : 0,
                'order' => (int) (Db::value('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sl_sets') ?? 1),
                'by'    => $userId,
                't'     => $now,
                't2'    => $now,
            ],
        );
        $id = Db::lastId();

        if (isset($body['cards']) && is_array($body['cards'])) {
            $this->replaceCards($id, $body['cards']);
        }

        $this->security->log($userId, 'set_create', "slug=$slug");
        return $this->show($slug, $userId, true);
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    public function update(int $setId, array $body, int $userId): array
    {
        $set = Db::one('SELECT id, slug FROM sl_sets WHERE id = :id', ['id' => $setId]);
        if ($set === null) {
            Http::fail(404, 'not_found', 'That set does not exist.');
        }

        $fields = [];
        $params = ['id' => $setId];

        if (array_key_exists('title', $body)) {
            $fields['title'] = self::text($body['title'], 120, 'title', required: true);
        }
        if (array_key_exists('description', $body)) {
            $d = self::text($body['description'] ?? '', 500, 'description');
            $fields['description'] = $d === '' ? null : $d;
        }
        if (array_key_exists('langA', $body)) {
            $fields['lang_a'] = self::text($body['langA'], 40, 'langA', required: true);
        }
        if (array_key_exists('langB', $body)) {
            $fields['lang_b'] = self::text($body['langB'], 40, 'langB', required: true);
        }
        if (array_key_exists('published', $body)) {
            $fields['is_published'] = !empty($body['published']) ? 1 : 0;
        }
        if (array_key_exists('sortOrder', $body)) {
            $fields['sort_order'] = (int) $body['sortOrder'];
        }

        if ($fields !== []) {
            $assignments = [];
            foreach ($fields as $column => $value) {
                $assignments[]    = "$column = :$column";
                $params[$column]  = $value;
            }
            $assignments[]      = 'updated_at = :updated';
            $params['updated']  = Util::now();
            Db::run('UPDATE sl_sets SET ' . implode(', ', $assignments) . ' WHERE id = :id', $params);
        }

        if (isset($body['cards']) && is_array($body['cards'])) {
            $this->replaceCards($setId, $body['cards']);
            Db::run('UPDATE sl_sets SET updated_at = :t WHERE id = :id',
                ['t' => Util::now(), 'id' => $setId]);
        }

        $this->security->log($userId, 'set_update', 'slug=' . $set['slug']);
        $slug = (string) (Db::value('SELECT slug FROM sl_sets WHERE id = :id', ['id' => $setId]) ?? '');
        return $this->show($slug, $userId, true);
    }

    public function destroy(int $setId, int $userId): void
    {
        $slug = Db::value('SELECT slug FROM sl_sets WHERE id = :id', ['id' => $setId]);
        if ($slug === null) {
            Http::fail(404, 'not_found', 'That set does not exist.');
        }
        Db::run('DELETE FROM sl_sets WHERE id = :id', ['id' => $setId]);
        $this->security->log($userId, 'set_delete', "slug=$slug");
    }

    /**
     * Cards are replaced wholesale, which keeps the editor simple. Rows that
     * arrive with their existing id keep that id, so progress survives edits.
     *
     * @param array<int, mixed> $cards
     */
    private function replaceCards(int $setId, array $cards): void
    {
        if (count($cards) > 2000) {
            Http::fail(422, 'too_many_cards', 'A set can hold at most 2000 cards.');
        }

        Db::transaction(static function () use ($setId, $cards): void {
            $existing = Db::all('SELECT id FROM sl_cards WHERE set_id = :s', ['s' => $setId]);
            $keep     = [];
            $position = 0;

            foreach ($cards as $raw) {
                if (!is_array($raw)) {
                    continue;
                }
                $a = self::text($raw['a'] ?? '', 300, 'card', required: true);
                $b = self::text($raw['b'] ?? '', 300, 'card', required: true);
                $n = self::text($raw['note'] ?? '', 300, 'note');
                $x = self::encodeExtras($raw['extras'] ?? null);
                $id = isset($raw['id']) ? (int) $raw['id'] : 0;

                if ($id > 0) {
                    $owned = Db::value('SELECT COUNT(*) FROM sl_cards WHERE id = :id AND set_id = :s',
                        ['id' => $id, 's' => $setId]);
                    if ((int) $owned === 1) {
                        Db::run(
                            'UPDATE sl_cards
                                SET side_a = :a, side_b = :b, note = :n, extras = :x, position = :p
                              WHERE id = :id',
                            [
                                'a'  => $a,
                                'b'  => $b,
                                'n'  => $n === '' ? null : $n,
                                'x'  => $x,
                                'p'  => $position,
                                'id' => $id,
                            ],
                        );
                        $keep[] = $id;
                        $position++;
                        continue;
                    }
                }

                Db::run(
                    'INSERT INTO sl_cards (set_id, side_a, side_b, note, extras, position, created_at)
                     VALUES (:s, :a, :b, :n, :x, :p, :t)',
                    [
                        's' => $setId,
                        'a' => $a,
                        'b' => $b,
                        'n' => $n === '' ? null : $n,
                        'x' => $x,
                        'p' => $position,
                        't' => Util::now(),
                    ],
                );
                $keep[] = Db::lastId();
                $position++;
            }

            foreach ($existing as $row) {
                if (!in_array((int) $row['id'], $keep, true)) {
                    Db::run('DELETE FROM sl_cards WHERE id = :id', ['id' => $row['id']]);
                }
            }
        });
    }

    private function uniqueSlug(string $base): string
    {
        $slug = $base;
        $n    = 2;
        while ((int) Db::value('SELECT COUNT(*) FROM sl_sets WHERE slug = :s', ['s' => $slug]) > 0) {
            $slug = $base . '-' . $n;
            $n++;
            if ($n > 500) {
                $slug = $base . '-' . bin2hex(random_bytes(3));
                break;
            }
        }
        return $slug;
    }

    /**
     * The grammar hanging off a card, as JSON.
     *
     * Rebuilt field by field rather than stored as it arrived: this column is
     * whatever an editor's browser posted, and it comes back out into every
     * other reader's app.
     *
     * @return string|null JSON, or null when the card has no extras at all
     */
    private static function encodeExtras(mixed $value): ?string
    {
        if (!is_array($value)) {
            return null;
        }
        $out = [];

        foreach (['article' => 80, 'plural' => 160] as $field => $max) {
            $part = is_array($value[$field] ?? null) ? $value[$field] : [];
            $sides = [];
            foreach (['a', 'b'] as $side) {
                $text = self::text($part[$side] ?? '', $max, $field);
                if ($text !== '') {
                    $sides[$side] = $text;
                }
            }
            if ($sides !== []) {
                $out[$field] = $sides;
            }
        }

        $genders = is_array($value['gender'] ?? null) ? $value['gender'] : [];
        $gender  = [];
        foreach (['a', 'b'] as $side) {
            if (in_array($genders[$side] ?? null, ['m', 'f'], true)) {
                $gender[$side] = $genders[$side];
            }
        }
        if ($gender !== []) {
            $out['gender'] = $gender;
        }

        $forms = is_array($value['conj'] ?? null) ? $value['conj'] : [];
        $conj  = [];
        foreach (['io', 'tu', 'lui', 'noi', 'voi', 'loro'] as $person) {
            $text = self::text($forms[$person] ?? '', 160, 'conjugation');
            if ($text !== '') {
                $conj[$person] = $text;
            }
        }
        if ($conj !== []) {
            $out['conj'] = $conj;
        }

        if ($out === []) {
            return null;
        }
        $json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return $json === false ? null : $json;
    }

    /** Always an object in the response, never an empty JSON array. */
    private static function decodeExtras(mixed $raw): object
    {
        if (!is_string($raw) || $raw === '') {
            return (object) [];
        }
        $decoded = json_decode($raw, true);
        return (object) (is_array($decoded) ? $decoded : []);
    }

    private static function text(mixed $value, int $max, string $field, bool $required = false): string
    {
        $s = is_string($value) ? trim(preg_replace('/\s+/u', ' ', $value) ?? '') : '';
        if ($required && $s === '') {
            Http::fail(422, 'missing_field', "The $field cannot be empty.");
        }
        if (mb_strlen($s, 'UTF-8') > $max) {
            Http::fail(422, 'too_long', "That $field is too long (max $max characters).");
        }
        return $s;
    }
}

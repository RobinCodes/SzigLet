<?php
declare(strict_types=1);

namespace SzigLet;

/**
 * The shared library: word sets and question sets, their contents, and who
 * may change them.
 */
final class Sets
{
    /** The persons of a verb's present tense. They double as variation keys. */
    public const PERSONS = ['io', 'tu', 'lui', 'noi', 'voi', 'loro'];

    public function __construct(private readonly Security $security)
    {
    }

    /**
     * The library index. Every signed-in account sees the same sets; the
     * numbers attached to each one are the reader's own progress.
     *
     * Mastery in the index is the two base directions only. Other pairs of
     * variations are scored on the set's own page.
     *
     * @return list<array<string, mixed>>
     */
    public function index(int $userId, bool $canSeeDrafts): array
    {
        $tested = static fn (string $dir, string $modes, string $u): string =>
            "EXISTS(SELECT 1 FROM sl_results r WHERE r.user_id = :$u AND r.set_id = s.id
                      AND r.dir = '$dir' AND r.partial = 0 AND r.mode IN ($modes))";

        $rows = Db::all(
            'SELECT s.id, s.slug, s.title, s.description, s.lang_a, s.lang_b, s.kind,
                    s.is_published, s.sort_order, s.updated_at,
                    (SELECT COUNT(*) FROM sl_cards c WHERE c.set_id = s.id) AS card_count,
                    (SELECT COUNT(*) FROM sl_questions q WHERE q.set_id = s.id) AS question_count,
                    (SELECT COUNT(*) FROM sl_progress p
                       JOIN sl_cards c2 ON c2.id = p.card_id
                      WHERE c2.set_id = s.id AND p.user_id = :u1
                        AND p.dir = \'ab\' AND p.state = \'known\') AS known_ab,
                    (SELECT COUNT(*) FROM sl_progress p
                       JOIN sl_cards c3 ON c3.id = p.card_id
                      WHERE c3.set_id = s.id AND p.user_id = :u2
                        AND p.dir = \'ba\' AND p.state = \'known\') AS known_ba,
                    ' . $tested('ab', "'choice','mixed'", 'u3') . ' AS ab_choice,
                    ' . $tested('ab', "'write'", 'u4') . ' AS ab_write,
                    ' . $tested('ba', "'choice','mixed'", 'u5') . ' AS ba_choice,
                    ' . $tested('ba', "'write'", 'u6') . ' AS ba_write,
                    (SELECT COUNT(*) FROM sl_item_progress ip
                       JOIN sl_questions q2 ON ip.item = CONCAT(\'q:\', q2.id)
                      WHERE q2.set_id = s.id AND ip.user_id = :u7 AND ip.last_ok = 1) AS questions_solved
               FROM sl_sets s
              WHERE (s.is_published = 1 OR :drafts = 1)
              ORDER BY s.sort_order ASC, s.updated_at DESC',
            [
                'u1'     => $userId,
                'u2'     => $userId,
                'u3'     => $userId,
                'u4'     => $userId,
                'u5'     => $userId,
                'u6'     => $userId,
                'u7'     => $userId,
                'drafts' => $canSeeDrafts ? 1 : 0,
            ],
        );

        $authors = Authors::namesFor('set', array_map(static fn (array $r): int => (int) $r['id'], $rows));

        return array_map(static fn (array $r): array => [
            'id'              => (int) $r['id'],
            'slug'            => (string) $r['slug'],
            'title'           => (string) $r['title'],
            'description'     => $r['description'] === null ? null : (string) $r['description'],
            'langA'           => (string) $r['lang_a'],
            'langB'           => (string) $r['lang_b'],
            'kind'            => (string) $r['kind'],
            'published'       => (bool) $r['is_published'],
            'author'          => $authors[(int) $r['id']][0] ?? null,
            'authors'         => $authors[(int) $r['id']] ?? [],
            'cardCount'       => (int) $r['card_count'],
            'questionCount'   => (int) $r['question_count'],
            'questionsSolved' => (int) $r['questions_solved'],
            'updatedAt'       => (int) $r['updated_at'],
            'known'           => ['ab' => (int) $r['known_ab'], 'ba' => (int) $r['known_ba']],
            'tests'           => [
                'ab' => ['choice' => (bool) $r['ab_choice'], 'write' => (bool) $r['ab_write']],
                'ba' => ['choice' => (bool) $r['ba_choice'], 'write' => (bool) $r['ba_write']],
            ],
        ], $rows);
    }

    /** @return array<string, mixed> */
    public function show(string $slug, int $userId, bool $canSeeDrafts): array
    {
        $set = Db::one('SELECT * FROM sl_sets WHERE slug = :slug', ['slug' => $slug]);
        if ($set === null || (!(bool) $set['is_published'] && !$canSeeDrafts)) {
            Http::fail(404, 'not_found', 'That set does not exist.');
        }
        $setId = (int) $set['id'];

        // Finished tests, per pair of variations. A mixed test is scored as
        // multiple choice: half of its questions were.
        $tests = [];
        foreach (Db::all(
            'SELECT DISTINCT dir, mode FROM sl_results
              WHERE user_id = :u AND set_id = :s AND partial = 0 AND mode <> \'flashcards\'',
            ['u' => $userId, 's' => $setId],
        ) as $row) {
            $dir = (string) $row['dir'];
            $tests[$dir] ??= ['choice' => false, 'write' => false];
            $tests[$dir][$row['mode'] === 'write' ? 'write' : 'choice'] = true;
        }

        $states = [];
        foreach (Db::all(
            'SELECT p.card_id, p.dir, p.state FROM sl_progress p
               JOIN sl_cards c ON c.id = p.card_id
              WHERE c.set_id = :s AND p.user_id = :u',
            ['s' => $setId, 'u' => $userId],
        ) as $row) {
            $states[(int) $row['card_id']][(string) $row['dir']] = (string) $row['state'];
        }

        $cards = Db::all(
            'SELECT id, side_a, side_b, note, extras FROM sl_cards
              WHERE set_id = :s ORDER BY position ASC, id ASC',
            ['s' => $setId],
        );

        $questions = Questions::forSet($setId);
        $solved    = Questions::progressFor($userId, array_map(static fn (array $q): int => $q['id'], $questions));
        $config    = self::variantConfig($set['variants'] ?? null);
        $authors   = Authors::listFor('set', $setId);

        return [
            'id'          => $setId,
            'slug'        => (string) $set['slug'],
            'title'       => (string) $set['title'],
            'description' => $set['description'] === null ? null : (string) $set['description'],
            'langA'       => (string) $set['lang_a'],
            'langB'       => (string) $set['lang_b'],
            'kind'        => (string) $set['kind'],
            'published'   => (bool) $set['is_published'],
            'author'      => $authors[0]['username'] ?? null,
            'authors'     => $authors,
            'updatedAt'   => (int) $set['updated_at'],
            'variants'    => array_merge(
                [
                    ['key' => 'a', 'name' => (string) $set['lang_a'], 'side' => 'a'],
                    ['key' => 'b', 'name' => (string) $set['lang_b'], 'side' => 'b'],
                ],
                $config['extra'],
            ),
            'defaults'    => $config['defaults'],
            'tests'       => (object) $tests,
            'cards'       => array_map(static fn (array $c): array => [
                'id'     => (int) $c['id'],
                'a'      => (string) $c['side_a'],
                'b'      => (string) $c['side_b'],
                'note'   => $c['note'] === null ? null : (string) $c['note'],
                'extras' => self::decodeExtras($c['extras'] ?? null),
                'state'  => (object) ($states[(int) $c['id']] ?? []),
            ], $cards),
            'questions'   => $questions,
            'progress'    => (object) $solved,
            'hidden'      => Flags::hiddenFor($userId),
            'canSeeStats' => Authors::canSeeStats('set', $setId, $userId),
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
        $kind  = ($body['kind'] ?? 'words') === 'questions' ? 'questions' : 'words';

        $slug = Util::uniqueSlug('sl_sets', Util::slugify($title));
        $now  = Util::now();

        Db::run(
            'INSERT INTO sl_sets (slug, title, description, lang_a, lang_b, kind, variants, is_published,
                                  sort_order, created_by, created_at, updated_at)
             VALUES (:slug, :title, :desc, :a, :b, :kind, :variants, :pub, :order, :by, :t, :t2)',
            [
                'slug'     => $slug,
                'title'    => $title,
                'desc'     => $desc === '' ? null : $desc,
                'a'        => $langA,
                'b'        => $langB,
                'kind'     => $kind,
                'variants' => self::encodeVariantConfig($body['variants'] ?? null, $body['defaults'] ?? null),
                'pub'      => !empty($body['published']) ? 1 : 0,
                'order'    => (int) (Db::value('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sl_sets') ?? 1),
                'by'       => $userId,
                't'        => $now,
                't2'       => $now,
            ],
        );
        $id = Db::lastId();

        Authors::save('set', $id, is_array($body['authors'] ?? null) ? $body['authors'] : [$userId], $userId);

        if (isset($body['cards']) && is_array($body['cards'])) {
            $this->replaceCards($id, $body['cards']);
        }
        if (isset($body['questions']) && is_array($body['questions'])) {
            Questions::replace('set', $id, $body['questions']);
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
        if (array_key_exists('variants', $body) || array_key_exists('defaults', $body)) {
            $fields['variants'] = self::encodeVariantConfig($body['variants'] ?? null, $body['defaults'] ?? null);
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

        if (isset($body['authors']) && is_array($body['authors'])) {
            Authors::save('set', $setId, $body['authors'], $userId);
        }

        $touched = false;
        if (isset($body['cards']) && is_array($body['cards'])) {
            $this->replaceCards($setId, $body['cards']);
            $touched = true;
        }
        if (isset($body['questions']) && is_array($body['questions'])) {
            Questions::replace('set', $setId, $body['questions']);
            $touched = true;
        }
        if ($touched) {
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
        Db::run("DELETE FROM sl_authors WHERE kind = 'set' AND entity_id = :id", ['id' => $setId]);
        $this->security->log($userId, 'set_delete', "slug=$slug");
    }

    /**
     * What the authors of a set get to see: how many people use it and how it
     * goes for them, with nobody named.
     *
     * @return array<string, mixed>
     */
    public function stats(int $setId, int $userId): array
    {
        $set = Db::one('SELECT id, title, slug, kind FROM sl_sets WHERE id = :id', ['id' => $setId]);
        if ($set === null) {
            Http::fail(404, 'not_found', 'That set does not exist.');
        }
        if (!Authors::canSeeStats('set', $setId, $userId)) {
            Http::fail(403, 'forbidden', 'Only the authors of this set can see its statistics.');
        }

        $cardCount = (int) (Db::value('SELECT COUNT(*) FROM sl_cards WHERE set_id = :s', ['s' => $setId]) ?? 0);

        $learners = (int) (Db::value(
            'SELECT COUNT(*) FROM (
                SELECT p.user_id FROM sl_progress p JOIN sl_cards c ON c.id = p.card_id WHERE c.set_id = :s1
                UNION
                SELECT r.user_id FROM sl_results r WHERE r.set_id = :s2
                UNION
                SELECT ip.user_id FROM sl_item_progress ip
                  JOIN sl_questions q ON ip.item = CONCAT(\'q:\', q.id) WHERE q.set_id = :s3
             ) people',
            ['s1' => $setId, 's2' => $setId, 's3' => $setId],
        ) ?? 0);

        // Somebody "cleared" the deck once every card is known in one direction.
        $cleared = $cardCount === 0 ? 0 : (int) (Db::value(
            'SELECT COUNT(DISTINCT user_id) FROM (
                SELECT p.user_id, p.dir FROM sl_progress p JOIN sl_cards c ON c.id = p.card_id
                 WHERE c.set_id = :s AND p.state = \'known\'
                 GROUP BY p.user_id, p.dir HAVING COUNT(*) >= :n
             ) done',
            ['s' => $setId, 'n' => $cardCount],
        ) ?? 0);

        $tests = Db::one(
            'SELECT COUNT(*) AS runs, COUNT(DISTINCT user_id) AS people,
                    COALESCE(SUM(total), 0) AS answered, COALESCE(SUM(correct), 0) AS correct
               FROM sl_results WHERE set_id = :s AND mode <> \'flashcards\' AND partial = 0',
            ['s' => $setId],
        ) ?? [];

        $hardest = Db::all(
            'SELECT c.id, c.side_a, c.side_b,
                    SUM(p.right_count) AS r, SUM(p.wrong_count) AS w
               FROM sl_progress p JOIN sl_cards c ON c.id = p.card_id
              WHERE c.set_id = :s
              GROUP BY c.id, c.side_a, c.side_b
             HAVING r + w >= 3
              ORDER BY w / (r + w) DESC, w DESC
              LIMIT 10',
            ['s' => $setId],
        );

        $questions = Db::all(
            'SELECT q.id, q.body, COUNT(ip.user_id) AS people,
                    COALESCE(SUM(ip.solved), 0) AS r, COALESCE(SUM(ip.wrong), 0) AS w
               FROM sl_questions q
               LEFT JOIN sl_item_progress ip ON ip.item = CONCAT(\'q:\', q.id)
              WHERE q.set_id = :s
              GROUP BY q.id, q.body, q.position
              ORDER BY q.position ASC, q.id ASC',
            ['s' => $setId],
        );

        $flags = (int) (Db::value(
            'SELECT COUNT(*) FROM sl_flags f
              WHERE f.status = \'open\' AND (
                    f.item IN (SELECT CONCAT(\'c:\', id) FROM sl_cards WHERE set_id = :s1)
                 OR f.item IN (SELECT CONCAT(\'q:\', id) FROM sl_questions WHERE set_id = :s2))',
            ['s1' => $setId, 's2' => $setId],
        ) ?? 0);

        return [
            'id'        => $setId,
            'title'     => (string) $set['title'],
            'slug'      => (string) $set['slug'],
            'kind'      => (string) $set['kind'],
            'cardCount' => $cardCount,
            'learners'  => $learners,
            'cleared'   => $cleared,
            'tests'     => [
                'runs'     => (int) ($tests['runs'] ?? 0),
                'people'   => (int) ($tests['people'] ?? 0),
                'answered' => (int) ($tests['answered'] ?? 0),
                'correct'  => (int) ($tests['correct'] ?? 0),
            ],
            'hardest'   => array_map(static fn (array $r): array => [
                'id'    => (int) $r['id'],
                'a'     => (string) $r['side_a'],
                'b'     => (string) $r['side_b'],
                'right' => (int) $r['r'],
                'wrong' => (int) $r['w'],
            ], $hardest),
            'questions' => array_map(static fn (array $r): array => [
                'id'     => (int) $r['id'],
                'body'   => (string) $r['body'],
                'people' => (int) $r['people'],
                'right'  => (int) $r['r'],
                'wrong'  => (int) $r['w'],
            ], $questions),
            'openFlags' => $flags,
        ];
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

        $config  = self::variantConfig(Db::value('SELECT variants FROM sl_sets WHERE id = :id', ['id' => $setId]));
        $allowed = array_column($config['extra'], 'key');

        Db::transaction(static function () use ($setId, $cards, $allowed): void {
            $existing = Db::all('SELECT id FROM sl_cards WHERE set_id = :s', ['s' => $setId]);
            $keep     = [];
            $position = 0;

            foreach ($cards as $raw) {
                if (!is_array($raw)) {
                    continue;
                }
                $a = self::text($raw['a'] ?? '', 300, 'card');
                $b = self::text($raw['b'] ?? '', 300, 'card');
                $n = self::text($raw['note'] ?? '', 300, 'note');
                [$x, $filled] = self::encodeExtras($raw['extras'] ?? null, $allowed);

                // A card is any two forms of a word: Italian and Hungarian as
                // ever, but just as well a singular and its plural.
                if (($a !== '' ? 1 : 0) + ($b !== '' ? 1 : 0) + $filled < 2) {
                    Http::fail(422, 'incomplete_card', 'Every card needs at least two sides filled in.');
                }

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

    /**
     * The variations a set offers beyond its two languages, and which of
     * them a new card starts with.
     *
     * @return array{extra: list<array{key:string,name:string,side:string}>, defaults: list<string>}
     */
    public static function variantConfig(mixed $raw): array
    {
        $decoded = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
        $decoded = is_array($decoded) ? $decoded : [];
        $extra   = [];
        foreach (is_array($decoded['extra'] ?? null) ? $decoded['extra'] : [] as $v) {
            if (is_array($v) && is_string($v['key'] ?? null) && is_string($v['name'] ?? null)) {
                $extra[] = [
                    'key'  => $v['key'],
                    'name' => $v['name'],
                    'side' => ($v['side'] ?? 'a') === 'b' ? 'b' : 'a',
                ];
            }
        }
        $defaults = array_values(array_filter(
            is_array($decoded['defaults'] ?? null) ? $decoded['defaults'] : ['a', 'b'],
            'is_string',
        ));
        return ['extra' => $extra, 'defaults' => $defaults === [] ? ['a', 'b'] : $defaults];
    }

    /**
     * Rebuilt from what the editor posted, never stored as it arrived.
     *
     * @param mixed $variants the full list, including the base `a` and `b`, which are skipped
     */
    private static function encodeVariantConfig(mixed $variants, mixed $defaults): ?string
    {
        $extra = [];
        $keys  = ['a', 'b'];
        foreach (is_array($variants) ? $variants : [] as $v) {
            if (!is_array($v)) {
                continue;
            }
            $key = is_string($v['key'] ?? null) ? $v['key'] : '';
            if (in_array($key, ['a', 'b'], true)) {
                continue;
            }
            if (preg_match('/^[a-z][a-z0-9_]{0,9}$/', $key) !== 1 || in_array($key, self::PERSONS, true)) {
                Http::fail(422, 'bad_variant', 'A variation has an invalid key.');
            }
            if (in_array($key, $keys, true)) {
                continue;
            }
            $extra[] = [
                'key'  => $key,
                'name' => self::text($v['name'] ?? '', 40, 'variation name', required: true),
                'side' => ($v['side'] ?? 'a') === 'b' ? 'b' : 'a',
            ];
            $keys[] = $key;
        }
        if (count($extra) > 24) {
            Http::fail(422, 'too_many_variants', 'A set can have at most 24 variations.');
        }

        $chosen = [];
        foreach (is_array($defaults) ? $defaults : ['a', 'b'] as $key) {
            if (is_string($key) && (in_array($key, $keys, true) || in_array($key, self::PERSONS, true))
                && !in_array($key, $chosen, true)) {
                $chosen[] = $key;
            }
        }

        $json = json_encode(['extra' => $extra, 'defaults' => $chosen],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return $json === false ? null : $json;
    }

    /**
     * Everything hanging off a card beyond its two base sides, as JSON.
     *
     * Rebuilt field by field rather than stored as it arrived: this column is
     * whatever an editor's browser posted, and it comes back out into every
     * other reader's app.
     *
     * @param list<string> $allowed the set's own variation keys
     * @return array{0: string|null, 1: int} the JSON, and how many forms it fills
     */
    private static function encodeExtras(mixed $value, array $allowed): array
    {
        if (!is_array($value)) {
            return [null, 0];
        }
        $out    = [];
        $filled = 0;

        $forms = is_array($value['v'] ?? null) ? $value['v'] : [];
        $v     = [];
        foreach ($forms as $key => $text) {
            if (!is_string($key) || !in_array($key, $allowed, true)) {
                continue;
            }
            $text = self::text($text, 300, 'variation');
            if ($text !== '') {
                $v[$key] = $text;
                $filled++;
            }
        }
        if ($v !== []) {
            $out['v'] = $v;
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

        $persons = is_array($value['conj'] ?? null) ? $value['conj'] : [];
        $conj    = [];
        foreach (self::PERSONS as $person) {
            $text = self::text($persons[$person] ?? '', 160, 'conjugation');
            if ($text !== '') {
                $conj[$person] = $text;
                $filled++;
            }
        }
        if ($conj !== []) {
            $out['conj'] = $conj;
        }

        // Which of a side's alternatives ("ház; épület") the app shows when
        // that side is the question. Absent means the first one.
        $prefs = is_array($value['pref'] ?? null) ? $value['pref'] : [];
        $pref  = [];
        foreach ($prefs as $key => $indices) {
            if (!is_string($key) || !is_array($indices)
                || !(in_array($key, ['a', 'b'], true) || in_array($key, $allowed, true) || in_array($key, self::PERSONS, true))) {
                continue;
            }
            $clean = array_values(array_unique(array_filter(
                array_map('intval', $indices),
                static fn (int $i): bool => $i >= 0 && $i < 20,
            )));
            sort($clean);
            if ($clean !== [] && $clean !== [0]) {
                $pref[$key] = $clean;
            }
        }
        if ($pref !== []) {
            $out['pref'] = $pref;
        }

        if (in_array($value['only'] ?? null, ['a', 'b'], true)) {
            $out['only'] = $value['only'];
        }
        if (($value['type'] ?? null) === 'verb') {
            $out['type'] = 'verb';
        }

        if ($out === []) {
            return [null, $filled];
        }
        $json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return [$json === false ? null : $json, $filled];
    }

    /** Always an object in the response, never an empty JSON array. */
    private static function decodeExtras(mixed $raw): object
    {
        if (!is_string($raw) || $raw === '') {
            return (object) [];
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return (object) [];
        }
        foreach (['v', 'pref'] as $map) {
            if (isset($decoded[$map]) && is_array($decoded[$map])) {
                $decoded[$map] = (object) $decoded[$map];
            }
        }
        return (object) $decoded;
    }

    public static function text(mixed $value, int $max, string $field, bool $required = false): string
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

<?php
declare(strict_types=1);

namespace SzigLet;

/**
 * Courses: an ordered path of nodes, plus the word and question sets that go
 * with it. A node is a handful of sub-nodes, each a list of parts — vocabulary,
 * matching, questions — that lessons are drawn from.
 *
 * The rules for lessons (what is unlocked, what counts as done) run in the
 * browser, which has the whole node in hand anyway. The server stores the
 * structure and the learner's record, and checks that what it is given is
 * well-formed.
 */
final class Courses
{
    private const PART_KINDS = ['vocab', 'match', 'question', 'compare'];
    private const MODES      = ['choice', 'write', 'both'];
    private const NEEDS      = ['none', 'seen', 'times', 'solved'];

    public function __construct(private readonly Security $security)
    {
    }

    /** @return list<array<string, mixed>> */
    public function index(int $userId, bool $canSeeDrafts): array
    {
        $rows = Db::all(
            'SELECT c.id, c.slug, c.title, c.description, c.is_published, c.updated_at,
                    (SELECT COUNT(*) FROM sl_nodes n WHERE n.course_id = c.id) AS node_count,
                    (SELECT COUNT(DISTINCT r.node_id) FROM sl_lesson_runs r
                       JOIN sl_nodes n2 ON n2.id = r.node_id
                      WHERE n2.course_id = c.id AND r.user_id = :u1 AND r.completed_node = 1) AS nodes_done,
                    (SELECT COUNT(*) FROM sl_lesson_runs r2
                       JOIN sl_nodes n3 ON n3.id = r2.node_id
                      WHERE n3.course_id = c.id AND r2.user_id = :u2) AS lessons
               FROM sl_courses c
              WHERE (c.is_published = 1 OR :drafts = 1)
              ORDER BY c.sort_order ASC, c.updated_at DESC',
            ['u1' => $userId, 'u2' => $userId, 'drafts' => $canSeeDrafts ? 1 : 0],
        );
        $authors = Authors::namesFor('course', array_map(static fn (array $r): int => (int) $r['id'], $rows));

        return array_map(static fn (array $r): array => [
            'id'          => (int) $r['id'],
            'slug'        => (string) $r['slug'],
            'title'       => (string) $r['title'],
            'description' => $r['description'] === null ? null : (string) $r['description'],
            'published'   => (bool) $r['is_published'],
            'authors'     => $authors[(int) $r['id']] ?? [],
            'nodeCount'   => (int) $r['node_count'],
            'nodesDone'   => (int) $r['nodes_done'],
            'lessons'     => (int) $r['lessons'],
            'updatedAt'   => (int) $r['updated_at'],
        ], $rows);
    }

    /** @return array<string, mixed> */
    public function show(string $slug, int $userId, bool $canSeeDrafts): array
    {
        $course = Db::one('SELECT * FROM sl_courses WHERE slug = :s', ['s' => $slug]);
        if ($course === null || (!(bool) $course['is_published'] && !$canSeeDrafts)) {
            Http::fail(404, 'not_found', 'That course does not exist.');
        }
        $id = (int) $course['id'];

        $nodes = self::pruneMissing(array_map(fn (array $n): array => $this->nodeRow($n), Db::all(
            'SELECT * FROM sl_nodes WHERE course_id = :c ORDER BY position ASC, id ASC',
            ['c' => $id],
        )));

        $items = [];
        foreach ($nodes as $node) {
            array_push($items, ...self::itemsIn($node['content']));
        }

        $sets = Db::all(
            'SELECT s.id, s.slug, s.title, s.kind, s.lang_a, s.lang_b, s.is_published,
                    (SELECT COUNT(*) FROM sl_cards c WHERE c.set_id = s.id) AS card_count,
                    (SELECT COUNT(*) FROM sl_questions q WHERE q.set_id = s.id) AS question_count
               FROM sl_course_sets cs JOIN sl_sets s ON s.id = cs.set_id
              WHERE cs.course_id = :c AND (s.is_published = 1 OR :drafts = 1)
              ORDER BY cs.position ASC',
            ['c' => $id, 'drafts' => $canSeeDrafts ? 1 : 0],
        );

        return [
            'id'          => $id,
            'slug'        => (string) $course['slug'],
            'title'       => (string) $course['title'],
            'description' => $course['description'] === null ? null : (string) $course['description'],
            'published'   => (bool) $course['is_published'],
            'authors'     => Authors::listFor('course', $id),
            'updatedAt'   => (int) $course['updated_at'],
            'sets'        => array_map(static fn (array $s): array => [
                'id'            => (int) $s['id'],
                'slug'          => (string) $s['slug'],
                'title'         => (string) $s['title'],
                'kind'          => (string) $s['kind'],
                'langA'         => (string) $s['lang_a'],
                'langB'         => (string) $s['lang_b'],
                'published'     => (bool) $s['is_published'],
                'cardCount'     => (int) $s['card_count'],
                'questionCount' => (int) $s['question_count'],
            ], $sets),
            'nodes'       => $nodes,
            'progress'    => (object) Items::progress($userId, $items),
            'hidden'      => Flags::hiddenFor($userId),
            'canSeeStats' => Authors::canSeeStats('course', $id, $userId),
        ];
    }

    /**
     * One node with everything a lesson or the node editor needs: the cards
     * and questions it points at, and the learner's record for each.
     *
     * @return array<string, mixed>
     */
    public function node(int $nodeId, int $userId, bool $canSeeDrafts): array
    {
        $row = Db::one(
            'SELECT n.*, c.slug AS course_slug, c.title AS course_title, c.is_published
               FROM sl_nodes n JOIN sl_courses c ON c.id = n.course_id
              WHERE n.id = :id',
            ['id' => $nodeId],
        );
        if ($row === null || (!(bool) $row['is_published'] && !$canSeeDrafts)) {
            Http::fail(404, 'not_found', 'That node does not exist.');
        }
        $node = self::pruneMissing([$this->nodeRow($row)])[0];

        $cardIds     = [];
        $questionIds = [];
        foreach ($node['content']['subnodes'] as $sub) {
            foreach ($sub['parts'] as $part) {
                array_push($cardIds, ...$part['cards']);
                foreach ($part['questions'] as $q) {
                    if (is_int($q)) {
                        $questionIds[] = $q;
                    }
                }
            }
        }

        return [
            'node'         => $node + [
                'courseId'    => (int) $row['course_id'],
                'courseSlug'  => (string) $row['course_slug'],
                'courseTitle' => (string) $row['course_title'],
            ],
            'cards'        => self::cardsByIds($cardIds),
            'questions'    => Questions::byIds($questionIds),
            'ownQuestions' => Questions::forNode($nodeId),
            'progress'     => (object) Items::progress($userId, self::itemsIn($node['content'])),
            'hidden'       => Flags::hiddenFor($userId),
        ];
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    public function create(array $body, int $userId): array
    {
        $title = Sets::text($body['title'] ?? '', 120, 'title', required: true);
        $desc  = Sets::text($body['description'] ?? '', 500, 'description');
        $slug  = Util::uniqueSlug('sl_courses', Util::slugify($title));
        $now   = Util::now();

        Db::run(
            'INSERT INTO sl_courses (slug, title, description, is_published, sort_order, created_by, created_at, updated_at)
             VALUES (:slug, :title, :desc, :pub, :order, :by, :t, :t2)',
            [
                'slug'  => $slug,
                'title' => $title,
                'desc'  => $desc === '' ? null : $desc,
                'pub'   => !empty($body['published']) ? 1 : 0,
                'order' => (int) (Db::value('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sl_courses') ?? 1),
                'by'    => $userId,
                't'     => $now,
                't2'    => $now,
            ],
        );
        $id = Db::lastId();
        Authors::save('course', $id, is_array($body['authors'] ?? null) ? $body['authors'] : [$userId], $userId);
        if (isset($body['sets']) && is_array($body['sets'])) {
            self::saveSets($id, $body['sets']);
        }

        $this->security->log($userId, 'course_create', "slug=$slug");
        return $this->show($slug, $userId, true);
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    public function update(int $courseId, array $body, int $userId): array
    {
        $course = Db::one('SELECT id, slug FROM sl_courses WHERE id = :id', ['id' => $courseId]);
        if ($course === null) {
            Http::fail(404, 'not_found', 'That course does not exist.');
        }

        $fields = [];
        if (array_key_exists('title', $body)) {
            $fields['title'] = Sets::text($body['title'], 120, 'title', required: true);
        }
        if (array_key_exists('description', $body)) {
            $d = Sets::text($body['description'] ?? '', 500, 'description');
            $fields['description'] = $d === '' ? null : $d;
        }
        if (array_key_exists('published', $body)) {
            $fields['is_published'] = !empty($body['published']) ? 1 : 0;
        }
        $fields['updated_at'] = Util::now();

        $assignments = [];
        $params      = ['id' => $courseId];
        foreach ($fields as $column => $value) {
            $assignments[]   = "$column = :$column";
            $params[$column] = $value;
        }
        Db::run('UPDATE sl_courses SET ' . implode(', ', $assignments) . ' WHERE id = :id', $params);

        if (isset($body['authors']) && is_array($body['authors'])) {
            Authors::save('course', $courseId, $body['authors'], $userId);
        }
        if (isset($body['sets']) && is_array($body['sets'])) {
            self::saveSets($courseId, $body['sets']);
        }
        if (isset($body['nodeOrder']) && is_array($body['nodeOrder'])) {
            foreach (array_values($body['nodeOrder']) as $position => $nodeId) {
                Db::run('UPDATE sl_nodes SET position = :p WHERE id = :id AND course_id = :c',
                    ['p' => $position, 'id' => (int) $nodeId, 'c' => $courseId]);
            }
        }

        $this->security->log($userId, 'course_update', 'slug=' . $course['slug']);
        $slug = (string) Db::value('SELECT slug FROM sl_courses WHERE id = :id', ['id' => $courseId]);
        return $this->show($slug, $userId, true);
    }

    public function destroy(int $courseId, int $userId): void
    {
        $slug = Db::value('SELECT slug FROM sl_courses WHERE id = :id', ['id' => $courseId]);
        if ($slug === null) {
            Http::fail(404, 'not_found', 'That course does not exist.');
        }
        Db::run('DELETE FROM sl_courses WHERE id = :id', ['id' => $courseId]);
        Db::run("DELETE FROM sl_authors WHERE kind = 'course' AND entity_id = :id", ['id' => $courseId]);
        $this->security->log($userId, 'course_delete', "slug=$slug");
    }

    /**
     * @param array<string, mixed> $body
     * @return array{id:int}
     */
    public function createNode(int $courseId, array $body, int $userId): array
    {
        if (Db::value('SELECT id FROM sl_courses WHERE id = :id', ['id' => $courseId]) === null) {
            Http::fail(404, 'not_found', 'That course does not exist.');
        }
        $count = (int) (Db::value('SELECT COUNT(*) FROM sl_nodes WHERE course_id = :c', ['c' => $courseId]) ?? 0);
        if ($count >= 200) {
            Http::fail(422, 'too_many_nodes', 'A course can have at most 200 nodes.');
        }
        $now = Util::now();
        Db::run(
            'INSERT INTO sl_nodes (course_id, title, description, content, position, created_at, updated_at)
             VALUES (:c, :title, NULL, :content, :p, :t, :t2)',
            [
                'c'       => $courseId,
                'title'   => Sets::text($body['title'] ?? '', 120, 'title', required: true),
                'content' => json_encode(['subnodes' => [['id' => 's1', 'title' => '', 'parts' => []]]]),
                'p'       => (int) (Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM sl_nodes WHERE course_id = :c',
                    ['c' => $courseId]) ?? 0),
                't'       => $now,
                't2'      => $now,
            ],
        );
        $id = Db::lastId();
        Db::run('UPDATE sl_courses SET updated_at = :t WHERE id = :id', ['t' => $now, 'id' => $courseId]);
        $this->security->log($userId, 'node_create', "id=$id");
        return ['id' => $id];
    }

    /**
     * Saves a node whole: its title, its structure, and the questions that
     * were written inside it. New questions arrive with a temporary key, and
     * the parts that point at them are rewritten to the real ids.
     *
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    public function updateNode(int $nodeId, array $body, int $userId): array
    {
        $row = Db::one('SELECT id, course_id FROM sl_nodes WHERE id = :id', ['id' => $nodeId]);
        if ($row === null) {
            Http::fail(404, 'not_found', 'That node does not exist.');
        }

        $assigned = [];
        if (isset($body['questions']) && is_array($body['questions'])) {
            $assigned = Questions::replace('node', $nodeId, $body['questions']);
        }

        $fields = ['updated_at' => Util::now()];
        if (array_key_exists('title', $body)) {
            $fields['title'] = Sets::text($body['title'], 120, 'title', required: true);
        }
        if (array_key_exists('description', $body)) {
            $d = Sets::text($body['description'] ?? '', 500, 'description');
            $fields['description'] = $d === '' ? null : $d;
        }
        if (array_key_exists('content', $body)) {
            $content = self::cleanContent($body['content'], $assigned);
            $fields['content'] = json_encode($content, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        $assignments = [];
        $params      = ['id' => $nodeId];
        foreach ($fields as $column => $value) {
            $assignments[]   = "$column = :$column";
            $params[$column] = $value;
        }
        Db::run('UPDATE sl_nodes SET ' . implode(', ', $assignments) . ' WHERE id = :id', $params);
        Db::run('UPDATE sl_courses SET updated_at = :t WHERE id = :id',
            ['t' => Util::now(), 'id' => $row['course_id']]);

        $this->security->log($userId, 'node_update', "id=$nodeId");
        return $this->node($nodeId, $userId, true);
    }

    public function destroyNode(int $nodeId, int $userId): void
    {
        if (Db::value('SELECT id FROM sl_nodes WHERE id = :id', ['id' => $nodeId]) === null) {
            Http::fail(404, 'not_found', 'That node does not exist.');
        }
        Db::run('DELETE FROM sl_nodes WHERE id = :id', ['id' => $nodeId]);
        $this->security->log($userId, 'node_delete', "id=$nodeId");
    }

    /**
     * @param array<string, mixed> $body
     * @return array{id:int}
     */
    public function recordLesson(int $userId, array $body): array
    {
        $nodeId = (int) ($body['nodeId'] ?? 0);
        if ($nodeId <= 0 || Db::value('SELECT id FROM sl_nodes WHERE id = :id', ['id' => $nodeId]) === null) {
            Http::fail(422, 'missing_field', 'That lesson result is incomplete.');
        }
        $subnode = is_string($body['subnode'] ?? null) ? mb_substr($body['subnode'], 0, 16) : '';
        $total   = max(0, min(5000, (int) ($body['total'] ?? 0)));

        Db::run(
            'INSERT INTO sl_lesson_runs (user_id, node_id, subnode, total, correct, duration_ms,
                                         completed_sub, completed_node, created_at)
             VALUES (:u, :n, :s, :total, :correct, :ms, :cs, :cn, :t)',
            [
                'u'       => $userId,
                'n'       => $nodeId,
                's'       => $subnode,
                'total'   => $total,
                'correct' => max(0, min($total, (int) ($body['correct'] ?? 0))),
                'ms'      => max(0, min(86400000, (int) ($body['durationMs'] ?? 0))),
                'cs'      => !empty($body['completedSub']) ? 1 : 0,
                'cn'      => !empty($body['completedNode']) ? 1 : 0,
                't'       => Util::now(),
            ],
        );
        return ['id' => Db::lastId()];
    }

    /** @return array<string, mixed> */
    public function stats(int $courseId, int $userId): array
    {
        $course = Db::one('SELECT id, slug, title FROM sl_courses WHERE id = :id', ['id' => $courseId]);
        if ($course === null) {
            Http::fail(404, 'not_found', 'That course does not exist.');
        }
        if (!Authors::canSeeStats('course', $courseId, $userId)) {
            Http::fail(403, 'forbidden', 'Only the authors of this course can see its statistics.');
        }

        $nodes = Db::all(
            'SELECT n.id, n.title,
                    COUNT(r.id) AS lessons,
                    COUNT(DISTINCT r.user_id) AS people,
                    COUNT(DISTINCT CASE WHEN r.completed_node = 1 THEN r.user_id END) AS completed,
                    COALESCE(SUM(r.total), 0) AS answered,
                    COALESCE(SUM(r.correct), 0) AS correct
               FROM sl_nodes n
               LEFT JOIN sl_lesson_runs r ON r.node_id = n.id
              WHERE n.course_id = :c
              GROUP BY n.id, n.title, n.position
              ORDER BY n.position ASC, n.id ASC',
            ['c' => $courseId],
        );

        $learners = (int) (Db::value(
            'SELECT COUNT(DISTINCT r.user_id) FROM sl_lesson_runs r
               JOIN sl_nodes n ON n.id = r.node_id WHERE n.course_id = :c',
            ['c' => $courseId],
        ) ?? 0);

        return [
            'id'       => $courseId,
            'slug'     => (string) $course['slug'],
            'title'    => (string) $course['title'],
            'learners' => $learners,
            'nodes'    => array_map(static fn (array $r): array => [
                'id'        => (int) $r['id'],
                'title'     => (string) $r['title'],
                'lessons'   => (int) $r['lessons'],
                'people'    => (int) $r['people'],
                'completed' => (int) $r['completed'],
                'answered'  => (int) $r['answered'],
                'correct'   => (int) $r['correct'],
            ], $nodes),
        ];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * @param array<string, mixed> $n
     * @return array<string, mixed>
     */
    private function nodeRow(array $n): array
    {
        $content = json_decode((string) ($n['content'] ?? ''), true);
        return [
            'id'          => (int) $n['id'],
            'title'       => (string) $n['title'],
            'description' => $n['description'] === null ? null : (string) $n['description'],
            'position'    => (int) $n['position'],
            // Stored content was cleaned on the way in; this only guards
            // against a row edited by hand.
            'content'     => self::cleanContent(is_array($content) ? $content : [], [], strict: false),
        ];
    }

    /**
     * Drops references to cards and questions that have since been deleted,
     * so a learner is never held up by a word that no longer exists.
     *
     * @param list<array<string, mixed>> $nodes
     * @return list<array<string, mixed>>
     */
    private static function pruneMissing(array $nodes): array
    {
        $cards     = [];
        $questions = [];
        foreach ($nodes as $node) {
            foreach ($node['content']['subnodes'] as $sub) {
                foreach ($sub['parts'] as $part) {
                    array_push($cards, ...$part['cards']);
                    array_push($questions, ...$part['questions']);
                }
            }
        }
        $existing = static function (string $table, array $ids): array {
            $ids = array_values(array_unique(array_filter($ids, 'is_int')));
            if ($ids === []) {
                return [];
            }
            return array_flip(array_map(
                static fn (array $r): int => (int) $r['id'],
                Db::all("SELECT id FROM $table WHERE id IN (" . implode(',', $ids) . ')'),
            ));
        };
        $haveCards     = $existing('sl_cards', $cards);
        $haveQuestions = $existing('sl_questions', $questions);
        $keepRef = static fn (array $req): bool => match (true) {
            str_starts_with($req['ref'], 'c:') => isset($haveCards[(int) substr($req['ref'], 2)]),
            str_starts_with($req['ref'], 'q:') => isset($haveQuestions[(int) substr($req['ref'], 2)]),
            default                            => true,
        };

        foreach ($nodes as &$node) {
            foreach ($node['content']['subnodes'] as &$sub) {
                foreach ($sub['parts'] as &$part) {
                    $part['cards']     = array_values(array_filter($part['cards'], static fn (int $c): bool => isset($haveCards[$c])));
                    $part['questions'] = array_values(array_filter($part['questions'], static fn (int $q): bool => isset($haveQuestions[$q])));
                    $part['requires']  = array_values(array_filter($part['requires'], $keepRef));
                }
                unset($part);
            }
            unset($sub);
        }
        unset($node);
        return $nodes;
    }

    /** @param array<int, mixed> $setIds */
    private static function saveSets(int $courseId, array $setIds): void
    {
        Db::transaction(static function () use ($courseId, $setIds): void {
            Db::run('DELETE FROM sl_course_sets WHERE course_id = :c', ['c' => $courseId]);
            $position = 0;
            foreach (array_unique(array_map('intval', $setIds)) as $setId) {
                if ($setId > 0 && Db::value('SELECT id FROM sl_sets WHERE id = :id', ['id' => $setId]) !== null) {
                    Db::run('INSERT INTO sl_course_sets (course_id, set_id, position) VALUES (:c, :s, :p)',
                        ['c' => $courseId, 's' => $setId, 'p' => $position++]);
                }
            }
        });
    }

    /**
     * @param list<int> $ids
     * @return list<array<string, mixed>>
     */
    private static function cardsByIds(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids, static fn (int $id): bool => $id > 0)));
        if ($ids === []) {
            return [];
        }
        $rows = Db::all(
            'SELECT c.id, c.side_a, c.side_b, c.note, c.extras, s.id AS set_id, s.title, s.lang_a, s.lang_b
               FROM sl_cards c JOIN sl_sets s ON s.id = c.set_id
              WHERE c.id IN (' . implode(',', $ids) . ')',
        );
        return array_map(static function (array $c): array {
            $extras = json_decode((string) ($c['extras'] ?? ''), true);
            return [
                'id'       => (int) $c['id'],
                'a'        => (string) $c['side_a'],
                'b'        => (string) $c['side_b'],
                'note'     => $c['note'] === null ? null : (string) $c['note'],
                'extras'   => (object) (is_array($extras) ? $extras : []),
                'state'    => (object) [],
                'setId'    => (int) $c['set_id'],
                'setTitle' => (string) $c['title'],
                'langA'    => (string) $c['lang_a'],
                'langB'    => (string) $c['lang_b'],
            ];
        }, $rows);
    }

    /**
     * Every card and question a node's content points at, as item keys.
     *
     * @param array<string, mixed> $content
     * @return list<string>
     */
    private static function itemsIn(array $content): array
    {
        $items = [];
        foreach ($content['subnodes'] ?? [] as $sub) {
            foreach ($sub['parts'] ?? [] as $part) {
                foreach ($part['cards'] ?? [] as $card) {
                    $items[] = "c:$card";
                }
                foreach ($part['questions'] ?? [] as $q) {
                    if (is_int($q)) {
                        $items[] = "q:$q";
                    }
                }
                foreach ($part['requires'] ?? [] as $req) {
                    if (preg_match('/^[cq]:\d+$/', $req['ref'] ?? '') === 1) {
                        $items[] = $req['ref'];
                    }
                }
            }
        }
        return $items;
    }

    /**
     * The node structure, rebuilt from what was posted.
     *
     * @param array<string, int> $assigned new question ids by temporary key
     * @return array{subnodes: list<array<string, mixed>>}
     */
    private static function cleanContent(mixed $raw, array $assigned, bool $strict = true): array
    {
        $fail = static function (string $message) use ($strict): void {
            if ($strict) {
                Http::fail(422, 'bad_node', $message);
            }
        };
        $id = static fn (mixed $v): ?string =>
            is_string($v) && preg_match('/^[a-z0-9]{1,12}$/', $v) === 1 ? $v : null;
        $question = static function (mixed $v) use ($assigned): ?int {
            if (is_int($v) && $v > 0) {
                return $v;
            }
            if (is_string($v) && str_starts_with($v, 'new:')) {
                return $assigned[substr($v, 4)] ?? null;
            }
            return null;
        };

        $subnodes = [];
        $raw      = is_array($raw) ? $raw : [];
        foreach (is_array($raw['subnodes'] ?? null) ? $raw['subnodes'] : [] as $sub) {
            if (!is_array($sub) || ($subId = $id($sub['id'] ?? null)) === null) {
                $fail('A sub-node is missing its id.');
                continue;
            }
            $parts = [];
            foreach (is_array($sub['parts'] ?? null) ? $sub['parts'] : [] as $part) {
                if (!is_array($part) || ($partId = $id($part['id'] ?? null)) === null
                    || !in_array($part['kind'] ?? null, self::PART_KINDS, true)) {
                    $fail('A part is malformed.');
                    continue;
                }
                $cards = array_values(array_unique(array_filter(
                    array_map('intval', is_array($part['cards'] ?? null) ? $part['cards'] : []),
                    static fn (int $c): bool => $c > 0,
                )));
                $questions = [];
                foreach (is_array($part['questions'] ?? null) ? $part['questions'] : [] as $q) {
                    $resolved = $question($q);
                    if ($resolved !== null && !in_array($resolved, $questions, true)) {
                        $questions[] = $resolved;
                    }
                }
                if (count($cards) > 500 || count($questions) > 200) {
                    $fail('A part can hold at most 500 cards or 200 questions.');
                }

                $requires = [];
                foreach (is_array($part['requires'] ?? null) ? $part['requires'] : [] as $req) {
                    if (!is_array($req)) {
                        continue;
                    }
                    $ref = is_string($req['ref'] ?? null) ? $req['ref'] : '';
                    if (str_starts_with($ref, 'q:new:')) {
                        $resolved = $question(substr($ref, 2));
                        $ref      = $resolved === null ? '' : "q:$resolved";
                    }
                    if (preg_match('/^(part:[a-z0-9]{1,12}|[cq]:[1-9]\d{0,9})$/', $ref) !== 1) {
                        continue;
                    }
                    $requires[] = ['ref' => $ref, 'need' => ($req['need'] ?? '') === 'seen' ? 'seen' : 'solved'];
                }

                $complete = is_array($part['complete'] ?? null) ? $part['complete'] : [];
                $need     = in_array($complete['need'] ?? null, self::NEEDS, true) ? $complete['need'] : 'times';

                $parts[] = [
                    'id'        => $partId,
                    'kind'      => $part['kind'],
                    'title'     => mb_substr(is_string($part['title'] ?? null) ? trim($part['title']) : '', 0, 80),
                    'mode'      => in_array($part['mode'] ?? null, self::MODES, true) ? $part['mode'] : 'both',
                    'dirs'      => in_array($part['dirs'] ?? null, ['ab', 'ba', 'both'], true) ? $part['dirs'] : 'ab',
                    'cards'     => $cards,
                    'questions' => $questions,
                    'requires'  => array_slice($requires, 0, 60),
                    'complete'  => [
                        'need'  => $need,
                        'times' => max(1, min(20, (int) ($complete['times'] ?? 1))),
                    ],
                ];
            }
            if (count($parts) > 60) {
                $fail('A sub-node can hold at most 60 parts.');
            }
            $subnodes[] = [
                'id'    => $subId,
                'title' => mb_substr(is_string($sub['title'] ?? null) ? trim($sub['title']) : '', 0, 80),
                'parts' => $parts,
            ];
        }
        if (count($subnodes) > 40) {
            $fail('A node can have at most 40 sub-nodes.');
        }
        if ($subnodes === []) {
            $subnodes[] = ['id' => 's1', 'title' => '', 'parts' => []];
        }
        return ['subnodes' => $subnodes];
    }
}

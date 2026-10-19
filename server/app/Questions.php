<?php
declare(strict_types=1);

namespace SzigLet;

/**
 * Questions: a text, an optional instruction, and answers marked right or
 * wrong. They live in question sets, or in the node they were written in.
 */
final class Questions
{
    /** Where a gap question puts the chosen answer. */
    public const GAP = '___';

    /** @return list<array<string, mixed>> */
    public static function forSet(int $setId): array
    {
        return self::rows(Db::all(
            'SELECT * FROM sl_questions WHERE set_id = :s ORDER BY position ASC, id ASC',
            ['s' => $setId],
        ));
    }

    /** @return list<array<string, mixed>> */
    public static function forNode(int $nodeId): array
    {
        return self::rows(Db::all(
            'SELECT * FROM sl_questions WHERE node_id = :n ORDER BY position ASC, id ASC',
            ['n' => $nodeId],
        ));
    }

    /**
     * @param list<int> $ids
     * @return list<array<string, mixed>>
     */
    public static function byIds(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids, static fn (int $id): bool => $id > 0)));
        if ($ids === []) {
            return [];
        }
        // Integers only, so they can be inlined without a placeholder each.
        return self::rows(Db::all(
            'SELECT * FROM sl_questions WHERE id IN (' . implode(',', $ids) . ')',
        ));
    }

    /**
     * A learner's record for a list of questions, keyed "q:12".
     *
     * @param list<int> $ids
     * @return array<string, array{seen:int, solved:int, wrong:int, lastOk:bool}>
     */
    public static function progressFor(int $userId, array $ids): array
    {
        return Items::progress($userId, array_map(static fn (int $id): string => "q:$id", $ids));
    }

    /**
     * Replaces the questions of a set or node, keeping the ids of those that
     * arrive with one so their progress survives the edit.
     *
     * @param 'set'|'node' $owner
     * @param array<int, mixed> $questions
     * @return array<string, int> the id each `tempKey` was given
     */
    public static function replace(string $owner, int $ownerId, array $questions): array
    {
        if (count($questions) > 1000) {
            Http::fail(422, 'too_many_questions', 'At most 1000 questions in one place.');
        }
        $column = $owner === 'set' ? 'set_id' : 'node_id';

        return Db::transaction(static function () use ($column, $ownerId, $questions): array {
            $existing = array_map(
                static fn (array $r): int => (int) $r['id'],
                Db::all("SELECT id FROM sl_questions WHERE $column = :o", ['o' => $ownerId]),
            );
            $keep     = [];
            $assigned = [];
            $position = 0;

            foreach ($questions as $raw) {
                if (!is_array($raw)) {
                    continue;
                }
                $q  = self::validate($raw);
                $id = isset($raw['id']) ? (int) $raw['id'] : 0;

                $params = [
                    'kind' => $q['kind'],
                    'i'    => $q['instruction'],
                    'b'    => $q['body'],
                    'ans'  => $q['answers'],
                    'n'    => $q['note'],
                    'p'    => $position,
                ];

                if ($id > 0 && in_array($id, $existing, true)) {
                    Db::run(
                        'UPDATE sl_questions
                            SET kind = :kind, instruction = :i, body = :b, answers = :ans, note = :n, position = :p
                          WHERE id = :id',
                        $params + ['id' => $id],
                    );
                } else {
                    Db::run(
                        "INSERT INTO sl_questions ($column, kind, instruction, body, answers, note, position, created_at)
                         VALUES (:o, :kind, :i, :b, :ans, :n, :p, :t)",
                        $params + ['o' => $ownerId, 't' => Util::now()],
                    );
                    $id = Db::lastId();
                }
                if (is_string($raw['tempKey'] ?? null) && $raw['tempKey'] !== '') {
                    $assigned[$raw['tempKey']] = $id;
                }
                $keep[] = $id;
                $position++;
            }

            foreach (array_diff($existing, $keep) as $gone) {
                Db::run('DELETE FROM sl_questions WHERE id = :id', ['id' => $gone]);
            }
            return $assigned;
        });
    }

    /**
     * @param array<string, mixed> $raw
     * @return array{kind:string, instruction:?string, body:string, answers:string, note:?string}
     */
    private static function validate(array $raw): array
    {
        $kind        = ($raw['kind'] ?? 'answer') === 'gap' ? 'gap' : 'answer';
        $instruction = Sets::text($raw['instruction'] ?? '', 300, 'instruction');
        $note        = Sets::text($raw['note'] ?? '', 300, 'note');
        // The body keeps its line breaks: a question can be a short dialogue.
        $body = is_string($raw['body'] ?? null) ? trim(str_replace("\r\n", "\n", $raw['body'])) : '';
        if ($body === '') {
            Http::fail(422, 'missing_field', 'Every question needs a text.');
        }
        if (mb_strlen($body, 'UTF-8') > 1000) {
            Http::fail(422, 'too_long', 'A question can be at most 1000 characters.');
        }
        if ($kind === 'gap' && !str_contains($body, self::GAP)) {
            Http::fail(422, 'missing_gap', 'A missing-word question needs a gap: ' . self::GAP);
        }

        $answers = [];
        foreach (is_array($raw['answers'] ?? null) ? $raw['answers'] : [] as $answer) {
            if (!is_array($answer)) {
                continue;
            }
            $text = Sets::text($answer['t'] ?? '', 300, 'answer');
            if ($text !== '') {
                $answers[] = ['t' => $text, 'ok' => !empty($answer['ok'])];
            }
        }
        if (count($answers) > 200) {
            Http::fail(422, 'too_many_answers', 'A question can have at most 200 answers.');
        }
        if (!in_array(true, array_column($answers, 'ok'), true)) {
            Http::fail(422, 'no_right_answer', 'Every question needs at least one right answer.');
        }

        return [
            'kind'        => $kind,
            'instruction' => $instruction === '' ? null : $instruction,
            'body'        => $body,
            'answers'     => (string) json_encode($answers, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'note'        => $note === '' ? null : $note,
        ];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function rows(array $rows): array
    {
        return array_map(static function (array $r): array {
            $answers = json_decode((string) $r['answers'], true);
            return [
                'id'          => (int) $r['id'],
                'setId'       => $r['set_id'] === null ? null : (int) $r['set_id'],
                'nodeId'      => $r['node_id'] === null ? null : (int) $r['node_id'],
                'kind'        => (string) $r['kind'],
                'instruction' => $r['instruction'] === null ? null : (string) $r['instruction'],
                'body'        => (string) $r['body'],
                'answers'     => is_array($answers) ? $answers : [],
                'note'        => $r['note'] === null ? null : (string) $r['note'],
            ];
        }, $rows);
    }
}

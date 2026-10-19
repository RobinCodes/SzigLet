<?php
declare(strict_types=1);

namespace SzigLet;

/**
 * Migrations run themselves. There is no install wizard and no SQL to paste:
 * the first request after an upload brings the database up to date.
 */
final class Schema
{
    public const VERSION = 3;

    public static function ensure(): void
    {
        $have = self::currentVersion();
        if ($have >= self::VERSION) {
            return;
        }
        if ($have < 1) {
            self::v1();
        }
        if ($have < 2) {
            self::v2();
        }
        if ($have < 3) {
            self::v3();
        }
        Db::run(
            'INSERT INTO sl_meta (k, v) VALUES (:k, :v)
             ON DUPLICATE KEY UPDATE v = VALUES(v)',
            ['k' => 'schema_version', 'v' => (string) self::VERSION],
        );
    }

    private static function currentVersion(): int
    {
        try {
            $v = Db::value("SELECT v FROM sl_meta WHERE k = 'schema_version'");
            return is_string($v) ? (int) $v : 0;
        } catch (\PDOException) {
            return 0; // sl_meta does not exist yet
        }
    }

    private static function v1(): void
    {
        $t = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

        Db::run("CREATE TABLE IF NOT EXISTS sl_meta (
            k VARCHAR(40) NOT NULL PRIMARY KEY,
            v VARCHAR(190) NOT NULL
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_users (
            id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username      VARCHAR(32) NOT NULL,
            username_key  VARCHAR(32) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role          ENUM('viewer','editor','owner') NOT NULL DEFAULT 'viewer',
            created_at    INT UNSIGNED NOT NULL,
            last_seen_at  INT UNSIGNED NULL,
            failed_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            locked_until  INT UNSIGNED NULL,
            signup_ip     CHAR(64) NULL,
            UNIQUE KEY uk_users_key (username_key),
            KEY k_users_signup_ip (signup_ip, created_at)
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_sessions (
            id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id      INT UNSIGNED NOT NULL,
            token_hash   CHAR(64) NOT NULL,
            csrf         CHAR(43) NOT NULL,
            created_at   INT UNSIGNED NOT NULL,
            expires_at   INT UNSIGNED NOT NULL,
            last_used_at INT UNSIGNED NOT NULL,
            ua           VARCHAR(190) NULL,
            ip           CHAR(64) NULL,
            UNIQUE KEY uk_sessions_token (token_hash),
            KEY k_sessions_user (user_id),
            KEY k_sessions_expiry (expires_at),
            CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
                REFERENCES sl_users (id) ON DELETE CASCADE
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_sets (
            id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            slug         VARCHAR(80) NOT NULL,
            title        VARCHAR(120) NOT NULL,
            description  VARCHAR(500) NULL,
            lang_a       VARCHAR(40) NOT NULL,
            lang_b       VARCHAR(40) NOT NULL,
            is_published TINYINT(1) NOT NULL DEFAULT 1,
            sort_order   INT NOT NULL DEFAULT 0,
            created_by   INT UNSIGNED NULL,
            created_at   INT UNSIGNED NOT NULL,
            updated_at   INT UNSIGNED NOT NULL,
            UNIQUE KEY uk_sets_slug (slug),
            KEY k_sets_order (is_published, sort_order),
            CONSTRAINT fk_sets_author FOREIGN KEY (created_by)
                REFERENCES sl_users (id) ON DELETE SET NULL
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_cards (
            id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            set_id     INT UNSIGNED NOT NULL,
            side_a     VARCHAR(300) NOT NULL,
            side_b     VARCHAR(300) NOT NULL,
            note       VARCHAR(300) NULL,
            extras     TEXT NULL,
            position   INT NOT NULL DEFAULT 0,
            created_at INT UNSIGNED NOT NULL,
            KEY k_cards_set (set_id, position),
            CONSTRAINT fk_cards_set FOREIGN KEY (set_id)
                REFERENCES sl_sets (id) ON DELETE CASCADE
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_progress (
            user_id     INT UNSIGNED NOT NULL,
            card_id     INT UNSIGNED NOT NULL,
            dir         ENUM('ab','ba') NOT NULL,
            state       ENUM('new','rehearse','known') NOT NULL DEFAULT 'new',
            seen        INT UNSIGNED NOT NULL DEFAULT 0,
            right_count INT UNSIGNED NOT NULL DEFAULT 0,
            wrong_count INT UNSIGNED NOT NULL DEFAULT 0,
            updated_at  INT UNSIGNED NOT NULL,
            PRIMARY KEY (user_id, card_id, dir),
            KEY k_progress_card (card_id),
            CONSTRAINT fk_progress_user FOREIGN KEY (user_id)
                REFERENCES sl_users (id) ON DELETE CASCADE,
            CONSTRAINT fk_progress_card FOREIGN KEY (card_id)
                REFERENCES sl_cards (id) ON DELETE CASCADE
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_results (
            id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id     INT UNSIGNED NOT NULL,
            set_id      INT UNSIGNED NOT NULL,
            dir         ENUM('ab','ba') NOT NULL,
            mode        ENUM('flashcards','choice','write') NOT NULL,
            total       SMALLINT UNSIGNED NOT NULL,
            correct     SMALLINT UNSIGNED NOT NULL,
            duration_ms INT UNSIGNED NOT NULL,
            created_at  INT UNSIGNED NOT NULL,
            KEY k_results_user (user_id, created_at),
            KEY k_results_set (set_id),
            CONSTRAINT fk_results_user FOREIGN KEY (user_id)
                REFERENCES sl_users (id) ON DELETE CASCADE,
            CONSTRAINT fk_results_set FOREIGN KEY (set_id)
                REFERENCES sl_sets (id) ON DELETE CASCADE
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_limits (
            bucket   VARCHAR(190) NOT NULL PRIMARY KEY,
            hits     INT UNSIGNED NOT NULL DEFAULT 0,
            reset_at INT UNSIGNED NOT NULL,
            KEY k_limits_reset (reset_at)
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_pow_used (
            salt    CHAR(32) NOT NULL PRIMARY KEY,
            used_at INT UNSIGNED NOT NULL,
            KEY k_pow_used (used_at)
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_audit (
            id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id    INT UNSIGNED NULL,
            action     VARCHAR(40) NOT NULL,
            detail     VARCHAR(500) NULL,
            ip         CHAR(64) NULL,
            created_at INT UNSIGNED NOT NULL,
            KEY k_audit_created (created_at)
        ) $t");
    }

    /**
     * Articles, plurals, genders and verb tables, as JSON in one column.
     *
     * TEXT rather than a JSON column: MariaDB only aliases JSON to LONGTEXT
     * anyway, and shared hosting is not somewhere to find out the hard way
     * which version you were given.
     */
    private static function v2(): void
    {
        if (self::hasColumn('sl_cards', 'extras')) {
            return;
        }
        Db::run('ALTER TABLE sl_cards ADD COLUMN extras TEXT NULL AFTER note');
    }

    /**
     * Courses, nodes and questions; card variations; flags; co-authors.
     *
     * Every step checks before it acts, because a shared host can time a
     * request out halfway through and the next one has to be able to finish
     * the job rather than trip over what the first one already did.
     */
    private static function v3(): void
    {
        $t = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

        if (!self::hasColumn('sl_sets', 'kind')) {
            Db::run("ALTER TABLE sl_sets
                ADD COLUMN kind ENUM('words','questions') NOT NULL DEFAULT 'words' AFTER lang_b");
        }
        if (!self::hasColumn('sl_sets', 'variants')) {
            Db::run('ALTER TABLE sl_sets ADD COLUMN variants TEXT NULL AFTER kind');
        }

        // A study direction used to be one of two values. With variations it
        // is any pair of them ("a>v1"), and the two old values keep meaning
        // what they always meant, so existing progress needs no rewriting.
        Db::run('ALTER TABLE sl_progress MODIFY dir VARCHAR(24) NOT NULL');
        Db::run("ALTER TABLE sl_results
            MODIFY dir VARCHAR(24) NOT NULL,
            MODIFY mode ENUM('flashcards','choice','write','mixed') NOT NULL");
        if (!self::hasColumn('sl_results', 'partial')) {
            Db::run('ALTER TABLE sl_results ADD COLUMN partial TINYINT(1) NOT NULL DEFAULT 0 AFTER correct');
        }

        Db::run("CREATE TABLE IF NOT EXISTS sl_courses (
            id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            slug         VARCHAR(80) NOT NULL,
            title        VARCHAR(120) NOT NULL,
            description  VARCHAR(500) NULL,
            is_published TINYINT(1) NOT NULL DEFAULT 1,
            sort_order   INT NOT NULL DEFAULT 0,
            created_by   INT UNSIGNED NULL,
            created_at   INT UNSIGNED NOT NULL,
            updated_at   INT UNSIGNED NOT NULL,
            UNIQUE KEY uk_courses_slug (slug),
            CONSTRAINT fk_courses_author FOREIGN KEY (created_by)
                REFERENCES sl_users (id) ON DELETE SET NULL
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_course_sets (
            course_id INT UNSIGNED NOT NULL,
            set_id    INT UNSIGNED NOT NULL,
            position  INT NOT NULL DEFAULT 0,
            PRIMARY KEY (course_id, set_id),
            CONSTRAINT fk_course_sets_course FOREIGN KEY (course_id)
                REFERENCES sl_courses (id) ON DELETE CASCADE,
            CONSTRAINT fk_course_sets_set FOREIGN KEY (set_id)
                REFERENCES sl_sets (id) ON DELETE CASCADE
        ) $t");

        // A node's sub-nodes and parts live in one JSON document: they are
        // only ever edited, saved and read as a whole.
        Db::run("CREATE TABLE IF NOT EXISTS sl_nodes (
            id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            course_id   INT UNSIGNED NOT NULL,
            title       VARCHAR(120) NOT NULL,
            description VARCHAR(500) NULL,
            content     MEDIUMTEXT NULL,
            position    INT NOT NULL DEFAULT 0,
            created_at  INT UNSIGNED NOT NULL,
            updated_at  INT UNSIGNED NOT NULL,
            KEY k_nodes_course (course_id, position),
            CONSTRAINT fk_nodes_course FOREIGN KEY (course_id)
                REFERENCES sl_courses (id) ON DELETE CASCADE
        ) $t");

        // A question belongs to a question set, or to the node it was written
        // in. Exactly one of the two is set.
        Db::run("CREATE TABLE IF NOT EXISTS sl_questions (
            id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            set_id      INT UNSIGNED NULL,
            node_id     INT UNSIGNED NULL,
            kind        ENUM('answer','gap') NOT NULL DEFAULT 'answer',
            instruction VARCHAR(300) NULL,
            body        VARCHAR(1000) NOT NULL,
            answers     TEXT NOT NULL,
            note        VARCHAR(300) NULL,
            position    INT NOT NULL DEFAULT 0,
            created_at  INT UNSIGNED NOT NULL,
            KEY k_questions_set (set_id, position),
            KEY k_questions_node (node_id, position),
            CONSTRAINT fk_questions_set FOREIGN KEY (set_id)
                REFERENCES sl_sets (id) ON DELETE CASCADE,
            CONSTRAINT fk_questions_node FOREIGN KEY (node_id)
                REFERENCES sl_nodes (id) ON DELETE CASCADE
        ) $t");

        // What a learner has done with one card or question inside lessons.
        // `item` is "c:12" or "q:7": lessons mix the two freely.
        Db::run("CREATE TABLE IF NOT EXISTS sl_item_progress (
            user_id    INT UNSIGNED NOT NULL,
            item       VARCHAR(16) NOT NULL,
            seen       INT UNSIGNED NOT NULL DEFAULT 0,
            solved     INT UNSIGNED NOT NULL DEFAULT 0,
            wrong      INT UNSIGNED NOT NULL DEFAULT 0,
            last_ok    TINYINT(1) NOT NULL DEFAULT 0,
            updated_at INT UNSIGNED NOT NULL,
            PRIMARY KEY (user_id, item),
            KEY k_item_progress_item (item),
            CONSTRAINT fk_item_progress_user FOREIGN KEY (user_id)
                REFERENCES sl_users (id) ON DELETE CASCADE
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_lesson_runs (
            id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id        INT UNSIGNED NOT NULL,
            node_id        INT UNSIGNED NOT NULL,
            subnode        VARCHAR(16) NOT NULL,
            total          SMALLINT UNSIGNED NOT NULL,
            correct        SMALLINT UNSIGNED NOT NULL,
            duration_ms    INT UNSIGNED NOT NULL,
            completed_sub  TINYINT(1) NOT NULL DEFAULT 0,
            completed_node TINYINT(1) NOT NULL DEFAULT 0,
            created_at     INT UNSIGNED NOT NULL,
            KEY k_lesson_runs_user (user_id, created_at),
            KEY k_lesson_runs_node (node_id),
            CONSTRAINT fk_lesson_runs_user FOREIGN KEY (user_id)
                REFERENCES sl_users (id) ON DELETE CASCADE,
            CONSTRAINT fk_lesson_runs_node FOREIGN KEY (node_id)
                REFERENCES sl_nodes (id) ON DELETE CASCADE
        ) $t");

        Db::run("CREATE TABLE IF NOT EXISTS sl_flags (
            id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id     INT UNSIGNED NOT NULL,
            item        VARCHAR(16) NOT NULL,
            reason      VARCHAR(500) NULL,
            hide        TINYINT(1) NOT NULL DEFAULT 0,
            status      ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
            created_at  INT UNSIGNED NOT NULL,
            resolved_by INT UNSIGNED NULL,
            resolved_at INT UNSIGNED NULL,
            KEY k_flags_item (item, status),
            KEY k_flags_user (user_id, status),
            CONSTRAINT fk_flags_user FOREIGN KEY (user_id)
                REFERENCES sl_users (id) ON DELETE CASCADE
        ) $t");

        // Sets and courses alike: one table, so "everything I wrote" is one
        // query. No foreign key on entity_id for the same reason; deleting a
        // set or a course removes its rows explicitly.
        Db::run("CREATE TABLE IF NOT EXISTS sl_authors (
            kind      ENUM('set','course') NOT NULL,
            entity_id INT UNSIGNED NOT NULL,
            user_id   INT UNSIGNED NOT NULL,
            position  SMALLINT NOT NULL DEFAULT 0,
            PRIMARY KEY (kind, entity_id, user_id),
            KEY k_authors_user (user_id),
            CONSTRAINT fk_authors_user FOREIGN KEY (user_id)
                REFERENCES sl_users (id) ON DELETE CASCADE
        ) $t");

        Db::run("INSERT IGNORE INTO sl_authors (kind, entity_id, user_id, position)
                 SELECT 'set', id, created_by, 0 FROM sl_sets WHERE created_by IS NOT NULL");

        self::articlesToVariants();
    }

    /**
     * Articles and plurals used to be fields of their own. They are
     * variations now — "il gesso" and "i gessi" are just other ways the card
     * can be shown — so each set that used them gets a variation per side
     * that had any, and the cards carry the full form. Gender and verb tables
     * stay where they are.
     */
    private static function articlesToVariants(): void
    {
        $sets = Db::all('SELECT id, lang_a, lang_b, variants FROM sl_sets');
        foreach ($sets as $set) {
            $cards = Db::all(
                'SELECT id, side_a, side_b, extras FROM sl_cards
                  WHERE set_id = :s AND extras IS NOT NULL',
                ['s' => $set['id']],
            );
            $decoded = [];
            $used    = [];
            foreach ($cards as $card) {
                $extras = json_decode((string) $card['extras'], true);
                if (!is_array($extras) || (!isset($extras['article']) && !isset($extras['plural']))) {
                    continue;
                }
                $decoded[(int) $card['id']] = [$card, $extras];
                foreach (['article', 'plural'] as $field) {
                    foreach (['a', 'b'] as $side) {
                        if (($extras[$field][$side] ?? '') !== '') {
                            $used[$field . $side] = true;
                        }
                    }
                }
            }
            if ($decoded === []) {
                continue;
            }

            $config = json_decode((string) ($set['variants'] ?? ''), true);
            $config = is_array($config) ? $config : [];
            $extra  = is_array($config['extra'] ?? null) ? $config['extra'] : [];
            $names  = ['article' => 'article', 'plural' => 'plural'];
            $keys   = [];
            foreach (['article' => 'art', 'plural' => 'pl'] as $field => $prefix) {
                foreach (['a', 'b'] as $side) {
                    if (!isset($used[$field . $side])) {
                        continue;
                    }
                    $key = $prefix . $side;
                    $keys[$field . $side] = $key;
                    if (!in_array($key, array_column($extra, 'key'), true)) {
                        $lang = (string) ($side === 'a' ? $set['lang_a'] : $set['lang_b']);
                        $extra[] = ['key' => $key, 'name' => mb_substr($lang . ' — ' . $names[$field], 0, 40), 'side' => $side];
                    }
                }
            }
            $config['extra'] = $extra;
            Db::run('UPDATE sl_sets SET variants = :v WHERE id = :id', [
                'v'  => json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'id' => $set['id'],
            ]);

            foreach ($decoded as $id => [$card, $extras]) {
                $v = is_array($extras['v'] ?? null) ? $extras['v'] : [];
                foreach (['a', 'b'] as $side) {
                    $term    = (string) ($side === 'a' ? $card['side_a'] : $card['side_b']);
                    $article = trim((string) ($extras['article'][$side] ?? ''));
                    $plural  = trim((string) ($extras['plural'][$side] ?? ''));
                    if ($article !== '') {
                        // "l'" is written against the word; everything else takes a space.
                        $joined = preg_match("/['’]$/u", $article) === 1 ? $article . $term : "$article $term";
                        $v[$keys['article' . $side]] = mb_substr($joined, 0, 300);
                    }
                    if ($plural !== '') {
                        $v[$keys['plural' . $side]] = mb_substr($plural, 0, 300);
                    }
                }
                unset($extras['article'], $extras['plural']);
                if ($v !== []) {
                    $extras['v'] = $v;
                }
                Db::run('UPDATE sl_cards SET extras = :x WHERE id = :id', [
                    'x'  => $extras === [] ? null : json_encode($extras, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'id' => $id,
                ]);
            }
        }
    }

    private static function hasColumn(string $table, string $column): bool
    {
        $found = Db::value(
            'SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c',
            ['t' => $table, 'c' => $column],
        );
        return (int) $found > 0;
    }
}

<?php
declare(strict_types=1);

namespace SzigLet;

/**
 * Migrations run themselves. There is no install wizard and no SQL to paste:
 * the first request after an upload brings the database up to date.
 */
final class Schema
{
    public const VERSION = 2;

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

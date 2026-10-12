<?php
/**
 * Weekly SzigLet backup — run from cron, lives OUTSIDE public_html.
 *
 * Writes ~/backups/sziglet-YYYY-MM-DD.sql.gz and a dated copy of config.php,
 * then deletes anything in there older than a year.
 *
 * The dump is built with PDO rather than mysqldump, because shared hosting
 * does not reliably have mysqldump on PATH and a backup that silently stops
 * working is worse than no backup at all.
 *
 * Restore:  gunzip -c sziglet-DATE.sql.gz | mysql -u USER -p DBNAME
 */

$home      = '/cphome/rh77027';
$configPhp = $home . '/public_html/api/app/config.php';
$outDir    = $home . '/backups';
$keepDays  = 365;

function say(string $line): void
{
    echo '[' . date('Y-m-d H:i:s') . '] ' . $line . "\n";
}

if (!is_dir($outDir) && !mkdir($outDir, 0700, true)) {
    say('FAILED: cannot create ' . $outDir);
    exit(1);
}

if (!is_file($configPhp)) {
    say('FAILED: no config at ' . $configPhp);
    exit(1);
}

try {
    $cfg = require $configPhp;
    $db  = $cfg['db'];

    // "localhost" makes PDO reach for a Unix socket, and cron's PHP CLI looks
    // for it somewhere the web PHP does not — it fails with a bare "No such
    // file or directory". 127.0.0.1 forces TCP, which works from both.
    $host = $db['host'] === 'localhost' ? '127.0.0.1' : $db['host'];

    $pdo = new PDO(
        sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $host,
            $db['port'] ?? 3306,
            $db['name'],
        ),
        $db['user'],
        $db['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
    );

    $sql = "-- SzigLet backup, " . date('c') . "\n"
         . "-- database: " . $db['name'] . "\n\n"
         . "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n";

    $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    $rowTotal = 0;

    foreach ($tables as $table) {
        $create = $pdo->query('SHOW CREATE TABLE `' . $table . '`')->fetch(PDO::FETCH_NUM)[1];
        $sql .= "DROP TABLE IF EXISTS `$table`;\n$create;\n\n";

        $rows = $pdo->query('SELECT * FROM `' . $table . '`');
        while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
            $values = [];
            foreach ($row as $value) {
                $values[] = $value === null ? 'NULL' : $pdo->quote((string) $value);
            }
            $sql .= 'INSERT INTO `' . $table . '` (`'
                  . implode('`, `', array_keys($row)) . '`) VALUES ('
                  . implode(', ', $values) . ");\n";
            $rowTotal++;
        }
        $sql .= "\n";
    }

    $sql .= "SET FOREIGN_KEY_CHECKS = 1;\n";

    $stamp = date('Y-m-d');
    $dump  = $outDir . '/sziglet-' . $stamp . '.sql.gz';

    if (file_put_contents($dump, gzencode($sql, 9)) === false) {
        say('FAILED: could not write ' . $dump);
        exit(1);
    }
    chmod($dump, 0600);

    // The secret in config.php signs every session; restoring the database
    // without it logs everyone out, so it travels with the dump.
    $configCopy = $outDir . '/config-' . $stamp . '.php';
    copy($configPhp, $configCopy);
    chmod($configCopy, 0600);

    say(sprintf(
        'OK: %d tables, %d rows, %s (%.0f KB)',
        count($tables),
        $rowTotal,
        basename($dump),
        filesize($dump) / 1024,
    ));
} catch (Throwable $e) {
    say('FAILED: ' . $e->getMessage());
    exit(1);
}

// Prune. Matched by name so the log itself is never a candidate.
$cutoff  = time() - ($keepDays * 86400);
$removed = 0;
foreach (glob($outDir . '/{sziglet-*.sql.gz,config-*.php}', GLOB_BRACE) ?: [] as $old) {
    if (is_file($old) && filemtime($old) < $cutoff && unlink($old)) {
        $removed++;
    }
}
if ($removed > 0) {
    say(sprintf('pruned %d file(s) older than %d days', $removed, $keepDays));
}

<?php
/**
 * SzigLet configuration.
 *
 * Copy this file to  config.php  and fill it in. config.php is never served
 * (see .htaccess in this directory) and is not tracked by git.
 */

return [
    // ── Database ────────────────────────────────────────────────────────────
    // In cPanel: "MySQL® Database Wizard" creates the database and the user.
    // cPanel prefixes both with your account name, e.g. "myacct_sziglet".
    'db' => [
        'host'     => 'localhost',
        'name'     => 'REPLACE_db_name',
        'user'     => 'REPLACE_db_user',
        'password' => 'REPLACE_db_password',
        'port'     => 3306,
    ],

    // ── Secret ──────────────────────────────────────────────────────────────
    // Signs proof-of-work challenges and hashes IPs. Generate a fresh one, e.g.
    //   php -r "echo bin2hex(random_bytes(32));"
    // or just mash 64+ random characters. Changing it logs everyone out.
    'secret' => 'REPLACE_with_64_random_characters',

    // ── Ownership ───────────────────────────────────────────────────────────
    // The username that becomes the owner when it registers. Register this
    // account first, then you can hand out "editor" from the admin page.
    'owner_username' => 'robin',

    // ── Registration ────────────────────────────────────────────────────────
    'registration_open'      => true,
    'max_signups_per_ip_day' => 5,

    // ── Bot protection ──────────────────────────────────────────────────────
    // Proof-of-work difficulty in leading zero bits. Each +1 doubles the work.
    //   16 ≈ 0.1s   18 ≈ 0.3s   20 ≈ 1.2s   22 ≈ 5s   (on a mid-range phone)
    'pow' => [
        'register'   => 19,
        'login'      => 13,
        'login_hard' => 20, // after repeated failures from the same IP
        'ttl'        => 600,
    ],

    // Set to a non-empty string to require it as a ?key= on /api/_health.
    'health_key' => '',
];

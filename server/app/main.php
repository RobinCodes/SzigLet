<?php
declare(strict_types=1);

/**
 * SzigLet API — every route, and the only file that wires them together.
 *
 * Reached only through ../index.php, which checks the PHP version first. This
 * file is free to use PHP 8 syntax; index.php deliberately is not.
 */

namespace SzigLet;

use Throwable;

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
mb_internal_encoding('UTF-8');


require __DIR__ . '/Util.php';
require __DIR__ . '/Db.php';
require __DIR__ . '/Http.php';
require __DIR__ . '/Schema.php';
require __DIR__ . '/Security.php';
require __DIR__ . '/Auth.php';
require __DIR__ . '/Sets.php';
require __DIR__ . '/Questions.php';
require __DIR__ . '/Items.php';
require __DIR__ . '/Authors.php';
require __DIR__ . '/Flags.php';
require __DIR__ . '/Courses.php';
require __DIR__ . '/Progress.php';
require __DIR__ . '/Admin.php';

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    Http::json([
        'error'   => 'not_configured',
        'message' => 'SzigLet is not configured yet: copy app/config.sample.php to '
                   . 'app/config.php and fill in your database details.',
    ], 503);
}

/** @var array<string, mixed> $config */
$config = require $configPath;

try {
    Db::boot($config['db']);
    Schema::ensure();
} catch (Throwable $e) {
    error_log('[SzigLet] boot failed: ' . $e->getMessage());
    Http::json([
        'error'   => 'database_unavailable',
        'message' => 'The database could not be reached. Check app/config.php.',
    ], 503);
}

$secret = (string) ($config['secret'] ?? '');
if (strlen($secret) < 32) {
    Http::json([
        'error'   => 'weak_secret',
        'message' => 'Set a long random "secret" in app/config.php before using SzigLet.',
    ], 503);
}

$security = new Security($secret, $config['pow']);
$auth     = new Auth($secret, $security);
$sets     = new Sets($security);
$courses  = new Courses($security);
$progress = new Progress();
$admin    = new Admin($security);

$method = Http::method();
$path   = Http::path();

try {
    // Every state-changing request from a signed-in browser carries the CSRF
    // header. Unauthenticated posts are covered by proof of work instead.
    if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)
        && !in_array($path, ['/auth/login', '/auth/register', '/auth/challenge', '/auth/logout'], true)
    ) {
        $auth->checkCsrf();
    }

    $route = "$method $path";

    switch (true) {
        // ── Health ──────────────────────────────────────────────────────────
        case $route === 'GET /' || $route === 'GET /_health':
            $key = (string) ($config['health_key'] ?? '');
            if ($key !== '' && !hash_equals($key, Http::query('key', '') ?? '')) {
                Http::fail(404, 'not_found', 'Not found.');
            }
            Http::json([
                'ok'      => true,
                'app'     => 'SzigLet',
                'schema'  => Schema::VERSION,
                'php'     => PHP_VERSION,
                'argon2'  => defined('PASSWORD_ARGON2ID'),
                'claimed' => (int) (Db::value("SELECT COUNT(*) FROM sl_users WHERE role = 'owner'") ?? 0) > 0,
            ]);

        // ── Proof-of-work challenges ────────────────────────────────────────
        case $route === 'POST /auth/challenge':
            $purpose = Http::body()['purpose'] ?? '';
            if (!in_array($purpose, ['register', 'login'], true)) {
                Http::fail(422, 'bad_purpose', 'Unknown challenge.');
            }
            $security->limit('challenge:ip:' . Util::ipHash($secret), 120, 3600,
                'Too many requests. Please try again later.');
            Http::json($security->issueChallenge($purpose));

        // ── Accounts ────────────────────────────────────────────────────────
        case $route === 'POST /auth/register':
            $body = Http::body();
            $security->checkForm($body, 1500);
            $security->verifyChallenge('register', is_array($body['pow'] ?? null) ? $body['pow'] : []);
            $result = $auth->register(
                is_string($body['username'] ?? null) ? trim($body['username']) : '',
                is_string($body['password'] ?? null) ? $body['password'] : '',
                (bool) ($config['registration_open'] ?? true),
                (int) ($config['max_signups_per_ip_day'] ?? 5),
                (string) ($config['owner_username'] ?? ''),
            );
            Http::json($result, 201);

        case $route === 'POST /auth/login':
            $body = Http::body();
            $security->checkForm($body, 600);
            $security->verifyChallenge('login', is_array($body['pow'] ?? null) ? $body['pow'] : []);
            Http::json($auth->login(
                is_string($body['username'] ?? null) ? trim($body['username']) : '',
                is_string($body['password'] ?? null) ? $body['password'] : '',
            ));

        case $route === 'POST /auth/logout':
            $auth->logout();
            Http::json(['ok' => true]);

        case $route === 'GET /auth/me':
            $user = $auth->user();
            Http::json([
                'user'             => $user,
                'registrationOpen' => (bool) ($config['registration_open'] ?? true),
                'canEdit'          => $user !== null && in_array($user['role'], ['editor', 'owner'], true),
            ]);

        case $route === 'POST /auth/password':
            $me   = $auth->require();
            $body = Http::body();
            $auth->changePassword(
                (int) $me['id'],
                is_string($body['current'] ?? null) ? $body['current'] : '',
                is_string($body['next'] ?? null) ? $body['next'] : '',
            );
            Http::json(['ok' => true]);

        case $route === 'POST /auth/logout-everywhere':
            $me = $auth->require();
            $auth->logoutEverywhere((int) $me['id']);
            Http::json(['ok' => true]);

        // ── Library ─────────────────────────────────────────────────────────
        case $route === 'GET /sets':
            $me = $auth->require();
            Http::json(['sets' => $sets->index(
                (int) $me['id'],
                in_array($me['role'], ['editor', 'owner'], true),
            )]);

        case $method === 'GET' && preg_match('#^/sets/([a-z0-9][a-z0-9\-]{0,79})$#', $path, $m) === 1:
            $me = $auth->require();
            Http::json($sets->show($m[1], (int) $me['id'], in_array($me['role'], ['editor', 'owner'], true)));

        case $route === 'POST /sets':
            $me = $auth->requireEditor();
            $security->limit('write:user:' . $me['id'], 240, 3600, 'Slow down a moment.');
            Http::json($sets->create(Http::body(), (int) $me['id']), 201);

        case $method === 'PATCH' && preg_match('#^/sets/(\d+)$#', $path, $m) === 1:
            $me = $auth->requireEditor();
            $security->limit('write:user:' . $me['id'], 240, 3600, 'Slow down a moment.');
            Http::json($sets->update((int) $m[1], Http::body(), (int) $me['id']));

        case $method === 'DELETE' && preg_match('#^/sets/(\d+)$#', $path, $m) === 1:
            $me = $auth->requireEditor();
            $sets->destroy((int) $m[1], (int) $me['id']);
            Http::json(['ok' => true]);

        case $method === 'GET' && preg_match('#^/sets/(\d+)/stats$#', $path, $m) === 1:
            $me = $auth->requireEditor();
            Http::json($sets->stats((int) $m[1], (int) $me['id']));

        case $route === 'GET /editors':
            $auth->requireEditor();
            Http::json(['editors' => Authors::candidates()]);

        // ── Courses and nodes ───────────────────────────────────────────────
        case $route === 'GET /courses':
            $me = $auth->require();
            Http::json(['courses' => $courses->index(
                (int) $me['id'],
                in_array($me['role'], ['editor', 'owner'], true),
            )]);

        case $method === 'GET' && preg_match('#^/courses/([a-z0-9][a-z0-9\-]{0,79})$#', $path, $m) === 1:
            $me = $auth->require();
            Http::json($courses->show($m[1], (int) $me['id'], in_array($me['role'], ['editor', 'owner'], true)));

        case $route === 'POST /courses':
            $me = $auth->requireEditor();
            $security->limit('write:user:' . $me['id'], 240, 3600, 'Slow down a moment.');
            Http::json($courses->create(Http::body(), (int) $me['id']), 201);

        case $method === 'PATCH' && preg_match('#^/courses/(\d+)$#', $path, $m) === 1:
            $me = $auth->requireEditor();
            $security->limit('write:user:' . $me['id'], 240, 3600, 'Slow down a moment.');
            Http::json($courses->update((int) $m[1], Http::body(), (int) $me['id']));

        case $method === 'DELETE' && preg_match('#^/courses/(\d+)$#', $path, $m) === 1:
            $me = $auth->requireEditor();
            $courses->destroy((int) $m[1], (int) $me['id']);
            Http::json(['ok' => true]);

        case $method === 'GET' && preg_match('#^/courses/(\d+)/stats$#', $path, $m) === 1:
            $me = $auth->requireEditor();
            Http::json($courses->stats((int) $m[1], (int) $me['id']));

        case $method === 'POST' && preg_match('#^/courses/(\d+)/nodes$#', $path, $m) === 1:
            $me = $auth->requireEditor();
            $security->limit('write:user:' . $me['id'], 240, 3600, 'Slow down a moment.');
            Http::json($courses->createNode((int) $m[1], Http::body(), (int) $me['id']), 201);

        case $method === 'GET' && preg_match('#^/nodes/(\d+)$#', $path, $m) === 1:
            $me = $auth->require();
            Http::json($courses->node((int) $m[1], (int) $me['id'], in_array($me['role'], ['editor', 'owner'], true)));

        case $method === 'PATCH' && preg_match('#^/nodes/(\d+)$#', $path, $m) === 1:
            $me = $auth->requireEditor();
            $security->limit('write:user:' . $me['id'], 240, 3600, 'Slow down a moment.');
            Http::json($courses->updateNode((int) $m[1], Http::body(), (int) $me['id']));

        case $method === 'DELETE' && preg_match('#^/nodes/(\d+)$#', $path, $m) === 1:
            $me = $auth->requireEditor();
            $courses->destroyNode((int) $m[1], (int) $me['id']);
            Http::json(['ok' => true]);

        case $route === 'POST /items':
            $me = $auth->require();
            Http::json(Items::save((int) $me['id'], Http::body()));

        case $route === 'POST /lessons':
            $me = $auth->require();
            Http::json($courses->recordLesson((int) $me['id'], Http::body()), 201);

        // ── Reports ─────────────────────────────────────────────────────────
        case $route === 'POST /flags':
            $me = $auth->require();
            $security->limit('flag:user:' . $me['id'], 60, 3600, 'That is a lot of reports. Try again later.');
            Http::json(Flags::create((int) $me['id'], Http::body()), 201);

        case $route === 'GET /flags':
            $me = $auth->requireEditor();
            Http::json(['flags' => Flags::inbox((int) $me['id'], $me['role'] === 'owner')]);

        case $route === 'POST /flags/settle':
            $me   = $auth->requireEditor();
            $body = Http::body();
            Flags::settle(
                is_string($body['item'] ?? null) ? $body['item'] : '',
                is_string($body['status'] ?? null) ? $body['status'] : '',
                (int) $me['id'],
                $me['role'] === 'owner',
            );
            Http::json(['ok' => true]);

        // ── Study state ─────────────────────────────────────────────────────
        case $route === 'POST /progress':
            $me = $auth->require();
            Http::json($progress->save((int) $me['id'], Http::body()));

        case $route === 'POST /progress/reset':
            $me = $auth->require();
            $progress->reset((int) $me['id'], Http::body());
            Http::json(['ok' => true]);

        case $route === 'POST /results':
            $me = $auth->require();
            Http::json($progress->recordResult((int) $me['id'], Http::body()), 201);

        case $route === 'GET /me/stats':
            $me = $auth->require();
            Http::json($progress->stats((int) $me['id']));

        // ── Administration ──────────────────────────────────────────────────
        case $route === 'GET /admin/users':
            $auth->requireOwner();
            Http::json(['users' => $admin->users()]);

        case $method === 'PATCH' && preg_match('#^/admin/users/(\d+)$#', $path, $m) === 1:
            $me   = $auth->requireOwner();
            $body = Http::body();
            $admin->setRole((int) $me['id'], (int) $m[1],
                is_string($body['role'] ?? null) ? $body['role'] : '');
            Http::json(['ok' => true]);

        case $method === 'DELETE' && preg_match('#^/admin/users/(\d+)$#', $path, $m) === 1:
            $me = $auth->requireOwner();
            $admin->deleteUser((int) $me['id'], (int) $m[1]);
            Http::json(['ok' => true]);

        case $route === 'GET /admin/overview':
            $auth->requireOwner();
            Http::json($admin->overview());

        default:
            Http::fail(404, 'not_found', 'No such endpoint.');
    }
} catch (ApiError $e) {
    Http::json(array_merge(
        ['error' => $e->errorCode, 'message' => $e->getMessage()],
        $e->extra,
    ), $e->status);
} catch (Throwable $e) {
    error_log('[SzigLet] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Http::json([
        'error'   => 'server_error',
        'message' => 'Something went wrong on our side. Please try again.',
    ], 500);
}

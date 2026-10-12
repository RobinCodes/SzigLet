<?php
/**
 * Dev-only router for PHP's built-in server:
 *
 *   php -S 127.0.0.1:8787 -t server server/router.php
 *
 * It mimics the .htaccess rules so local development matches cPanel.
 */
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (preg_match('#^/(api/)?app/#', $path) === 1) {
    http_response_code(403);
    exit;
}

require __DIR__ . '/index.php';

<?php
/**
 * SzigLet API entry point.
 *
 * Deliberately written in PHP 5 syntax, with no PHP 8 features anywhere in it.
 * That is the whole point of this file: PHP parses a file completely before it
 * runs a single line, so a version check sitting next to a match() or a
 * readonly property can never fire on the very versions it is meant to catch.
 * It dies as a blank 500 instead. Keep this file boring.
 */

if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array(
        'error'   => 'php_too_old',
        'message' => 'SzigLet needs PHP 8.1 or newer. Switch this domain to PHP 8.1+ '
                   . 'in your hosting control panel (8.2 or newer is ideal).',
        'running' => PHP_VERSION,
    ));
    exit;
}

require __DIR__ . '/app/main.php';

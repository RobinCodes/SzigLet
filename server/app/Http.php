<?php
declare(strict_types=1);

namespace SzigLet;

final class ApiError extends \RuntimeException
{
    /** @param array<string, mixed> $extra */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $extra = [],
    ) {
        parent::__construct($message);
    }
}

final class Http
{
    /** @var array<string, mixed>|null */
    private static ?array $body = null;

    public static function method(): string
    {
        $m = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        // Some shared hosts mangle DELETE/PATCH; allow an explicit override.
        $override = strtoupper((string) ($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? ''));
        if ($m === 'POST' && in_array($override, ['PATCH', 'PUT', 'DELETE'], true)) {
            return $override;
        }
        return $m;
    }

    public static function path(): string
    {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = parse_url($uri, PHP_URL_PATH);
        $path = is_string($path) ? $path : '/';
        // Strip the mount point so routes are declared without the /api prefix.
        $path = preg_replace('#^.*?/api#', '', $path) ?? $path;
        $path = '/' . trim($path, '/');
        return $path === '/index.php' ? '/' : $path;
    }

    /** @return array<string, mixed> */
    public static function body(): array
    {
        if (self::$body !== null) {
            return self::$body;
        }
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return self::$body = [];
        }
        if (strlen($raw) > 2 * 1024 * 1024) {
            throw new ApiError(413, 'too_large', 'That request is too large.');
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new ApiError(400, 'bad_json', 'The request body was not valid JSON.');
        }
        /** @var array<string, mixed> $decoded */
        return self::$body = $decoded;
    }

    public static function query(string $key, ?string $default = null): ?string
    {
        $v = $_GET[$key] ?? null;
        return is_string($v) ? $v : $default;
    }

    public static function header(string $name): ?string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        $v = $_SERVER[$key] ?? null;
        return is_string($v) ? $v : null;
    }

    public static function json(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, private');
        header('Pragma: no-cache');
        header('X-Content-Type-Options: nosniff');
        echo json_encode(
            $data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE,
        );
        exit;
    }

    public static function noContent(): never
    {
        http_response_code(204);
        header('Cache-Control: no-store');
        exit;
    }

    public static function fail(int $status, string $code, string $message, array $extra = []): never
    {
        throw new ApiError($status, $code, $message, $extra);
    }
}

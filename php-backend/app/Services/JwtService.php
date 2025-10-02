<?php

namespace App\Services;

use App\Models\RefreshToken;
use App\Models\User;
use Carbon\CarbonImmutable;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Str;
use RuntimeException;

class JwtService
{
    private string $secret;

    private string $audience;

    private string $issuer;

    public function __construct()
    {
        $this->secret = config('app.jwt_secret', env('JWT_SECRET'));
        if (!$this->secret) {
            throw new RuntimeException('JWT secret is not configured');
        }

        $this->audience = config('services.jwt.audience', config('app.url'));
        $this->issuer = config('app.url');
    }

    public function issueTokens(User $user): array
    {
        $now = CarbonImmutable::now();

        $accessExpiresAt = $now->addMinutes(config('services.jwt.access_ttl', 5));
        $accessPayload = [
            'iss' => $this->issuer,
            'aud' => $this->audience,
            'iat' => $now->timestamp,
            'nbf' => $now->timestamp,
            'exp' => $accessExpiresAt->timestamp,
            'sub' => (string) $user->getKey(),
            'jti' => (string) Str::uuid(),
            'type' => 'access',
            'role' => $user->role,
        ];

        $accessToken = JWT::encode($accessPayload, $this->secret, 'HS256');

        $refreshExpiresAt = $now->addDays(config('services.jwt.refresh_ttl_days', 7));
        $refreshJti = (string) Str::uuid();

        $refreshPayload = [
            'iss' => $this->issuer,
            'aud' => $this->audience,
            'iat' => $now->timestamp,
            'nbf' => $now->timestamp,
            'exp' => $refreshExpiresAt->timestamp,
            'sub' => (string) $user->getKey(),
            'jti' => $refreshJti,
            'type' => 'refresh',
        ];

        $refreshToken = JWT::encode($refreshPayload, $this->secret, 'HS256');

        RefreshToken::create([
            'user_id' => (string) $user->getKey(),
            'jti' => $refreshJti,
            'expires_at' => $refreshExpiresAt,
            'revoked' => false,
        ]);

        return [
            'access' => $accessToken,
            'refresh' => $refreshToken,
        ];
    }

    public function decode(string $token)
    {
        return JWT::decode($token, new Key($this->secret, 'HS256'));
    }

    public function rotateRefreshToken(string $token): array
    {
        $decoded = $this->decode($token);

        if (($decoded->type ?? null) !== 'refresh') {
            throw new RuntimeException('Invalid token type');
        }

        $tokenRecord = RefreshToken::where('jti', $decoded->jti ?? null)
            ->where('user_id', $decoded->sub ?? null)
            ->first();

        if (!$tokenRecord || $tokenRecord->revoked) {
            throw new RuntimeException('Refresh token is invalid or revoked');
        }

        if ($tokenRecord->expires_at->isPast()) {
            throw new RuntimeException('Refresh token has expired');
        }

        $tokenRecord->update(['revoked' => true]);

        $user = User::findOrFail($decoded->sub);

        return $this->issueTokens($user);
    }

    public function verifyAccessToken(string $token): array
    {
        $decoded = $this->decode($token);

        if (($decoded->type ?? null) !== 'access') {
            throw new RuntimeException('Invalid token type');
        }

        return [
            'sub' => $decoded->sub,
            'role' => $decoded->role ?? null,
            'exp' => $decoded->exp,
            'jti' => $decoded->jti ?? null,
        ];
    }
}

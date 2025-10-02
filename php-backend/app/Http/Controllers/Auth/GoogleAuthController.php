<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\JwtService;
use Google\Client as GoogleClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class GoogleAuthController extends Controller
{
    public function __construct(private readonly JwtService $jwtService)
    {
    }

    public function __invoke(Request $request): JsonResponse
    {
        $credential = $request->input('credential');

        if (!$credential) {
            return response()->json(['message' => 'Missing Google credential'], Response::HTTP_BAD_REQUEST);
        }

        $clientId = config('services.google.client_id');

        if (!$clientId) {
            return response()->json(['message' => 'Google client ID is not configured'], Response::HTTP_INTERNAL_SERVER_ERROR);
        }

        try {
            $client = new GoogleClient(['client_id' => $clientId]);
            $payload = $client->verifyIdToken($credential);
        } catch (\Throwable $exception) {
            Log::warning('Failed verifying Google credential', [
                'error' => $exception->getMessage(),
            ]);
            return response()->json([
                'message' => 'Invalid Google credential',
                'detail' => $exception->getMessage(),
            ], Response::HTTP_UNAUTHORIZED);
        }

        if (!$payload || !isset($payload['email'])) {
            return response()->json([
                'message' => 'Google account is missing an email address',
            ], Response::HTTP_UNAUTHORIZED);
        }

        $email = strtolower($payload['email']);
        $user = User::firstOrNew(['email' => $email]);

        $defaults = [
            'username' => $user->username ?: Str::before($email, '@'),
            'first_name' => Arr::get($payload, 'given_name', $user->first_name),
            'last_name' => Arr::get($payload, 'family_name', $user->last_name),
            'picture' => Arr::get($payload, 'picture', $user->picture),
            'google_sub' => Arr::get($payload, 'sub'),
        ];

        foreach ($defaults as $field => $value) {
            if ($value !== null) {
                $user->{$field} = $value;
            }
        }

        $user->role = $this->resolveRole($email, $user->role);
        $user->save();

        $tokens = $this->jwtService->issueTokens($user);

        return response()->json([
            'user' => UserResource::make($user),
            'access' => $tokens['access'],
            'refresh' => $tokens['refresh'],
        ]);
    }

    private function resolveRole(string $email, ?string $currentRole): string
    {
        if ($currentRole === User::ROLE_ADMIN) {
            return $currentRole;
        }

        $admins = collect(explode(',', (string) env('ADMIN_EMAILS', '')))
            ->map(fn ($value) => strtolower(trim($value)))
            ->filter()
            ->values();

        return $admins->contains($email) ? User::ROLE_ADMIN : User::ROLE_CONSUMER;
    }
}

<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Services\JwtService;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateWithJwt
{
    public function __construct(private readonly JwtService $jwtService)
    {
    }

    public function handle(Request $request, Closure $next): JsonResponse|mixed
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json(['message' => 'Authentication token missing'], Response::HTTP_UNAUTHORIZED);
        }

        try {
            $payload = $this->jwtService->verifyAccessToken($token);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => 'Invalid token',
                'detail' => $exception->getMessage(),
            ], Response::HTTP_UNAUTHORIZED);
        }

        $user = User::find($payload['sub']);
        if (!$user) {
            return response()->json(['message' => 'User not found'], Response::HTTP_UNAUTHORIZED);
        }

        $request->setUserResolver(fn () => $user);

        return $next($request);
    }
}

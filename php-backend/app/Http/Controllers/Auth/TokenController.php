<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\JwtService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

class TokenController extends Controller
{
    public function __construct(private readonly JwtService $jwtService)
    {
    }

    public function refresh(Request $request): JsonResponse
    {
        $refreshToken = $request->input('refresh');

        if (!$refreshToken) {
            return response()->json(['message' => 'Missing refresh token'], Response::HTTP_BAD_REQUEST);
        }

        try {
            $tokens = $this->jwtService->rotateRefreshToken($refreshToken);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => 'Unable to refresh token',
                'detail' => $exception->getMessage(),
            ], Response::HTTP_UNAUTHORIZED);
        }

        $decoded = $this->jwtService->decode($tokens['access']);
        $user = User::findOrFail($decoded->sub);

        return response()->json([
            'user' => UserResource::make($user),
            'access' => $tokens['access'],
            'refresh' => $tokens['refresh'],
        ]);
    }

    public function verify(Request $request): JsonResponse
    {
        $token = $request->input('token') ?? $request->bearerToken();

        if (!$token) {
            return response()->json(['message' => 'Missing token'], Response::HTTP_BAD_REQUEST);
        }

        try {
            $payload = $this->jwtService->verifyAccessToken($token);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => 'Invalid token',
                'detail' => $exception->getMessage(),
            ], Response::HTTP_UNAUTHORIZED);
        }

        return response()->json([
            'valid' => true,
            'sub' => $payload['sub'],
            'role' => $payload['role'],
            'exp' => $payload['exp'],
        ]);
    }
}

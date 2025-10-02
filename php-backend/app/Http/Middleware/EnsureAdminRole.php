<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdminRole
{
    public function handle(Request $request, Closure $next): JsonResponse|mixed
    {
        /** @var User|null $user */
        $user = $request->user();

        if (!$user || $user->role !== User::ROLE_ADMIN) {
            return response()->json(['message' => 'Admin role required'], Response::HTTP_FORBIDDEN);
        }

        return $next($request);
    }
}

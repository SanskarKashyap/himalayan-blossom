<?php

use App\Http\Controllers\Auth\GoogleAuthController;
use App\Http\Controllers\Auth\TokenController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api" middleware group. Make something great!
|
*/

Route::post('auth/google', GoogleAuthController::class);
Route::post('auth/token/refresh', [TokenController::class, 'refresh']);
Route::post('auth/token/verify', [TokenController::class, 'verify']);

Route::middleware(['jwt.auth', 'jwt.admin'])->get('users', [UserController::class, 'index']);

Route::get('public-config', function () {
    $apiBaseUrl = rtrim(env('PUBLIC_API_BASE_URL', config('app.url').'/api'), '/');
    $redirectUri = rtrim(env('GOOGLE_REDIRECT_URI', $apiBaseUrl.'/auth/google/'), '/').'/';

    return response()->json([
        'apiBaseUrl' => $apiBaseUrl,
        'googleClientId' => env('GOOGLE_CLIENT_ID'),
        'googleRedirectUri' => $redirectUri,
    ]);
});

<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Jenssegers\Mongodb\Eloquent\Model;

class RefreshToken extends Model
{
    use HasFactory;

    protected $connection = 'mongodb';

    protected $collection = 'refresh_tokens';

    protected $fillable = [
        'user_id',
        'jti',
        'expires_at',
        'revoked',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'revoked' => 'boolean',
    ];

    public function scopeActive($query)
    {
        return $query->where('revoked', false)
            ->where('expires_at', '>', CarbonImmutable::now());
    }
}

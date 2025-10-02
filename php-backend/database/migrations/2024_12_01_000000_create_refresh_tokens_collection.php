<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::connection('mongodb')->create('refresh_tokens', function ($collection) {
            $collection->index('user_id');
            $collection->index('jti', ['unique' => true]);
            $collection->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::connection('mongodb')->dropIfExists('refresh_tokens');
    }
};

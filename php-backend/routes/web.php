<?php

use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "web" middleware group. Make something great!
|
*/

Route::view('/', 'frontend.index')->name('frontend.home');
Route::view('/index.html', 'frontend.index');

Route::view('/about', 'frontend.about')->name('frontend.about');
Route::view('/about.html', 'frontend.about');

Route::view('/collection', 'frontend.collection')->name('frontend.collection');
Route::view('/collection.html', 'frontend.collection');

Route::view('/contact', 'frontend.contact')->name('frontend.contact');
Route::view('/contact.html', 'frontend.contact');

Route::view('/gallery', 'frontend.gallery')->name('frontend.gallery');
Route::view('/gallery.html', 'frontend.gallery');

Route::view('/preorder', 'frontend.preorder')->name('frontend.preorder');
Route::view('/preorder.html', 'frontend.preorder');

Route::view('/wellness', 'frontend.wellness')->name('frontend.wellness');
Route::view('/wellness.html', 'frontend.wellness');

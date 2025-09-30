"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path
from rest_framework import routers

from accounts.views import GoogleAuthView, UserViewSet
from payments.views import PaymentOrderView
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView


router = routers.DefaultRouter()
router.register('users', UserViewSet, basename='user')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/google/', GoogleAuthView.as_view(), name='google-auth'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token-refresh'),
    path('api/auth/token/verify/', TokenVerifyView.as_view(), name='token-verify'),
    path('api/payments/order/', PaymentOrderView.as_view(), name='payment-order'),
    path('api/', include(router.urls)),
]

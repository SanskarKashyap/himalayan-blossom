from rest_framework import permissions


class IsAdminUserRole(permissions.BasePermission):
  message = 'Admin role required'

  def has_permission(self, request, view):
    user = request.user
    return bool(user and user.is_authenticated and getattr(user, 'role', None) == 'Admin')


class IsAdminOrConsumerRole(permissions.BasePermission):
  message = 'Admin or Consumer role required'

  def has_permission(self, request, view):
    user = request.user
    if not user or not user.is_authenticated:
      return False
    return getattr(user, 'role', None) in {'Admin', 'Consumer'}

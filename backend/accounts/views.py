from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import status, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from .serializers import UserSerializer
from .permissions import IsAdminUserRole

User = get_user_model()


def resolve_role(email: str, existing_role: str | None) -> str:
  if existing_role == User.Roles.ADMIN:
    return existing_role

  admin_emails = getattr(settings, 'ADMIN_EMAILS', [])
  if email and email.lower() in admin_emails:
    return User.Roles.ADMIN
  return User.Roles.CONSUMER


class GoogleAuthView(APIView):
  permission_classes = [permissions.AllowAny]

  def post(self, request, *args, **kwargs):
    credential = request.data.get('credential')
    if not credential:
      return Response({'message': 'Missing Google credential'}, status=status.HTTP_400_BAD_REQUEST)

    client_id = getattr(settings, 'GOOGLE_CLIENT_ID', None)
    if not client_id:
      return Response({'message': 'Google client ID is not configured'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
      payload = id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        audience=client_id,
      )
    except ValueError as exc:
      return Response({'message': f'Invalid Google credential: {exc}'}, status=status.HTTP_401_UNAUTHORIZED)

    email = payload.get('email')
    if not email:
      return Response({'message': 'Google account is missing an email address'}, status=status.HTTP_401_UNAUTHORIZED)

    defaults = {
      'username': email,
      'email': email,
      'first_name': payload.get('given_name') or '',
      'last_name': payload.get('family_name') or '',
      'picture': payload.get('picture'),
    }

    try:
      with transaction.atomic():
        user, created = User.objects.get_or_create(email=email, defaults=defaults)
        if not created:
          for field, value in defaults.items():
            setattr(user, field, value)
        user.google_sub = payload.get('sub')
        user.role = resolve_role(email, user.role)
        user.save()
    except Exception as exc:
      return Response({'message': f'Unable to process Google sign-in: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    refresh = RefreshToken.for_user(user)
    data = {
      'user': UserSerializer(user).data,
      'access': str(refresh.access_token),
      'refresh': str(refresh),
    }
    return Response(data, status=status.HTTP_200_OK)


class UserViewSet(viewsets.ReadOnlyModelViewSet):
  serializer_class = UserSerializer
  queryset = User.objects.all().order_by('-date_joined')
  permission_classes = [IsAdminUserRole]

  @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
  def me(self, request):
    serializer = self.get_serializer(request.user)
    return Response(serializer.data)

from decimal import Decimal
from uuid import uuid4

from django.conf import settings
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

import razorpay

from accounts.permissions import IsAdminOrConsumerRole
from .models import PaymentOrder
from .serializers import CreatePaymentOrderSerializer, PaymentOrderSerializer


class PaymentOrderView(APIView):
  permission_classes = [permissions.IsAuthenticated, IsAdminOrConsumerRole]

  def _get_client(self):
    key_id = getattr(settings, 'RAZORPAY_KEY_ID', None)
    key_secret = getattr(settings, 'RAZORPAY_KEY_SECRET', None)
    if not key_id or not key_secret:
      raise ValueError('Razorpay credentials are not configured')
    return razorpay.Client(auth=(key_id, key_secret))

  def post(self, request):
    serializer = CreatePaymentOrderSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    key_id = getattr(settings, 'RAZORPAY_KEY_ID', None)
    currency = serializer.validated_data.get('currency') or getattr(settings, 'RAZORPAY_CURRENCY', 'INR')
    receipt = serializer.validated_data.get('receipt') or f"hb_{uuid4().hex[:12]}"
    notes = serializer.validated_data.get('notes') or {}

    try:
      amount_decimal: Decimal = serializer.validated_data['amount'].quantize(Decimal('0.01'))
      amount_paise = int((amount_decimal * Decimal('100')).to_integral_value())
      client = self._get_client()
      razorpay_order = client.order.create(
        {
          'amount': amount_paise,
          'currency': currency,
          'receipt': receipt,
          'notes': {
            **notes,
            'user_email': request.user.email,
          },
        }
      )
    except ValueError as exc:
      return Response({'message': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except razorpay.errors.BadRequestError as exc:
      return Response({'message': f'Razorpay rejected the request: {exc}'}, status=status.HTTP_400_BAD_REQUEST)
    except razorpay.errors.RazorpayError as exc:
      return Response({'message': f'Unable to create Razorpay order: {exc}'}, status=status.HTTP_502_BAD_GATEWAY)

    order = PaymentOrder.objects.create(
      user=request.user,
      amount=amount_decimal,
      currency=currency,
      razorpay_order_id=razorpay_order['id'],
      receipt=razorpay_order.get('receipt', receipt),
      notes=razorpay_order.get('notes', notes),
      status=razorpay_order.get('status', 'created'),
    )

    response_data = {
      'order': PaymentOrderSerializer(order).data,
      'razorpay_key_id': key_id,
    }
    return Response(response_data, status=status.HTTP_201_CREATED)

from rest_framework import serializers

from .models import PaymentOrder


class PaymentOrderSerializer(serializers.ModelSerializer):
  class Meta:
    model = PaymentOrder
    fields = [
      'id',
      'razorpay_order_id',
      'amount',
      'currency',
      'receipt',
      'notes',
      'status',
      'created_at',
    ]
    read_only_fields = fields


class CreatePaymentOrderSerializer(serializers.Serializer):
  amount = serializers.DecimalField(max_digits=10, decimal_places=2)
  currency = serializers.CharField(required=False, max_length=10)
  receipt = serializers.CharField(required=False, max_length=255)
  notes = serializers.DictField(required=False)

  def validate_amount(self, value):
    if value <= 0:
      raise serializers.ValidationError('Amount must be greater than zero')
    return value

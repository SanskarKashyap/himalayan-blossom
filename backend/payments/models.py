from django.conf import settings
from django.db import models


class PaymentOrder(models.Model):
  STATUS_CHOICES = [
    ('created', 'Created'),
    ('paid', 'Paid'),
    ('failed', 'Failed'),
  ]

  user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='payment_orders')
  amount = models.DecimalField(max_digits=10, decimal_places=2)
  currency = models.CharField(max_length=10, default='INR')
  razorpay_order_id = models.CharField(max_length=255, unique=True)
  receipt = models.CharField(max_length=255, blank=True)
  notes = models.JSONField(default=dict, blank=True)
  status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='created')
  created_at = models.DateTimeField(auto_now_add=True)
  updated_at = models.DateTimeField(auto_now=True)

  class Meta:
    ordering = ['-created_at']

  def __str__(self):
    return f"{self.razorpay_order_id} ({self.status})"

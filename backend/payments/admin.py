from django.contrib import admin

from .models import PaymentOrder


@admin.register(PaymentOrder)
class PaymentOrderAdmin(admin.ModelAdmin):
  list_display = ('razorpay_order_id', 'user', 'amount', 'currency', 'status', 'created_at')
  search_fields = ('razorpay_order_id', 'user__email')
  list_filter = ('status', 'currency', 'created_at')

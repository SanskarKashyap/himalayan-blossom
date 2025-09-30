from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
  email = models.EmailField('email address', unique=True)
  class Roles(models.TextChoices):
    ADMIN = 'Admin', 'Admin'
    CONSUMER = 'Consumer', 'Consumer'

  role = models.CharField(
    max_length=20,
    choices=Roles.choices,
    default=Roles.CONSUMER,
    db_index=True,
  )

  google_sub = models.CharField(
    max_length=255,
    unique=True,
    null=True,
    blank=True,
  )

  picture = models.URLField(blank=True, null=True)

  def is_admin(self):
    return self.role == self.Roles.ADMIN

  def is_consumer(self):
    return self.role == self.Roles.CONSUMER

  def __str__(self):
    return f"{self.username} ({self.role})"
